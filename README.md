# BriefBooth

Consultation booking for independent consultants. Built with Next.js, React, TypeScript, and Supabase; exported as a static Cloudflare Pages application.

## Hosting and cost

The live site is [briefbooth.pages.dev](https://briefbooth.pages.dev). The custom domain [briefbooth.com](https://briefbooth.com) is also serving the app from Cloudflare over HTTPS. Hosting uses **Cloudflare Pages Free + Supabase Free**. There are no payment, AI, SMS, paid calendar, or server-runtime dependencies. No paid fallback is configured. Free services have quotas and may limit or pause service when limits are reached.

The existing Vercel team was already on Pro. BriefBooth's Vercel project is paused, preview deployments disabled, and Git builds ignored to prevent this app using that paid hosting. Other projects and the team's subscription were not changed. Do not resume Vercel deployment for this app under the strict free-only requirement.

The Supabase Free database is connected and its schema has been applied and tested. Public consultant email registration/recovery is connected through Brevo Free SMTP. Live signup, confirmation delivery, login, profile creation, sign-out, and password recovery were verified on October 16, 2026. Keep email verification enabled. Google sign-in is optional and disabled until configured. Booking confirmations are queued for both the client and consultant through the same Brevo Free account. Each includes intake, appointment time/timezone, and only the selected Zoom link or in-person address. Clients can also save their private link and download a calendar event.

## What works

- Consultant profile, public booking address, private meeting URL, publish/hide controls.
- Consultation types and weekly availability in the consultant's timezone.
- Account-free client booking: consultant’s questionnaire → consultation → meeting format and available time → confirmation.
- Consultants offer in-person appointments, Zoom, or both. Clients choose during intake; the address or Zoom link appears only after booking.
- Times are displayed in the client's timezone.
- Database-enforced overlap prevention, two-hour notice, and a 60-day window.
- Private confirmation links, calendar downloads, and cancellation that reopens the slot.
- Consultant booking list protected by row-level security.
- `/book/demo` demonstrates booking without creating an appointment.

## Cloudflare Pages deployment

Use the [official static Next.js deployment guide](https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/).

1. Sign in to Cloudflare and select **Workers & Pages → Create application → Pages → Import existing Git repository**.
2. Connect `taylordrew4u2/BriefBooth.com`, branch `codex/briefbooth-booking` until merged. Select **Next.js (Static HTML Export)**.
3. Build command: `npm run build`; output directory: `out`; Node.js: 22 or later. Keep the account on Free; no Workers paid subscription is needed.
4. Set only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the existing resource. These two values are public browser configuration. Never upload `.env.local`, database passwords, service-role keys, or Vercel tokens.
5. Deploy and verify the resulting `pages.dev` URL. Add its exact `/studio/` and `/account/?mode=password` URLs in Supabase Authentication URL Configuration.
6. Add your existing domain through **Custom domains**. For an apex domain, Cloudflare requires its nameservers; copy existing DNS records before changing nameservers at the registrar. Do not buy or transfer the domain. Follow the exact records shown by Cloudflare, then update Supabase Site URL and redirect allowlist to the final HTTPS address.

For direct upload with an already authenticated Wrangler CLI:

```sh
npm ci
npm run build
wrangler pages deploy out --project-name briefbooth
```

Direct Upload and Git-integrated projects have different management workflows; choose one when creating the project. The `out` directory is the complete deployable site. The build copies the two route shells outside their rewritten URL prefixes to avoid redirect loops. `public/_redirects` provides static shells for arbitrary `/book/SLUG` and `/manage/TOKEN` URLs. The client reads the actual URL and retrieves authorized data from Supabase. Dynamic booking links deliberately use document navigation so unknown slugs do not depend on prebuilt Next.js navigation payloads. `public/_headers` supplies security headers on Pages. No Pages Functions or Workers are deployed.

## Local development

Use Node.js 22 or later. Copy `.env.example` to `.env.local` and supply the two public Supabase values (the connected local checkout already has them).

```sh
npm ci
npm run dev
```

Next development supports the prebuilt demo route. To verify arbitrary consultant/private URLs with Cloudflare's rewrites, build and preview the exported site:

```sh
npm run build
wrangler pages dev out --port 3000
```

## Database and authentication

`supabase/schema.sql` is the canonical schema for a new empty Supabase project; do not rerun it against the connected database without a migration. All tables use RLS. Public booking functions deliberately expose constrained operations while private client details and meeting settings remain protected. Schedule edits require an authenticated owner.

For public email signup/recovery, configure a free SMTP provider in Supabase Authentication. See [Supabase SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp). Do not disable confirmation to bypass email restrictions. For optional Google authentication, follow [Supabase's Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google), then set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` and rebuild. This does not sync Google Calendar.

Allow exact final HTTPS URLs for `/studio/` and `/account/?mode=password` plus local equivalents when needed. The app may produce URLs without trailing slashes; allow those exact forms too if the provider checks them before the host redirects.

## Set up a consultant

Sign in at `/account/`, open `/studio/`, save a profile and page address, add a consultation, save your timezone and weekly hours, then publish. Share `/book/YOUR_SLUG`. Verify a booking, calendar download, studio entry, cancellation, and reopened slot before sharing widely.

## Validation

```sh
npm run lint
npm test
npm run build
# With npm start running in another terminal:
npm run test:pages
```

Database tests execute PostgreSQL booking logic and verify overlap rejection, input validation, cancellation, private data protection, consultant isolation, schedule permissions, timezone/DST behavior, and retry idempotency. A disposable account was also used to verify live profile publication, service creation, schedule saving, public booking, owner visibility, duplicate rejection, and cancellation.

## Boundaries

No payment collection, reminders, generated video rooms, calendar sync, date-specific schedule overrides, or holiday exceptions. Consultants should only publish hours they can honor. The private management link is a capability: anyone holding it can view basic appointment details and cancel before the start. Keep it private.

Basic abuse controls include validation, a form honeypot, and five bookings per email per consultant per hour. A larger public launch should add stronger bot protection. Free services' quotas remain in effect; do not enable automatic paid upgrades.

## Design

The exact brand palette is `#137FEC`, `#B4B4B4`, `#676767`, and `#333333`, with white surfaces and derived neutral/blue tints. The design focuses on consultation booking. The rejected outdoorsy direction is not used.

## Booking confirmation emails

After `supabase/schema.sql` in a new project, apply `supabase/migrations/20261016160059_booking_confirmation_emails.sql`, `supabase/booking-email-worker.sql`, and `supabase/migrations/20261016162000_custom_intake.sql`. The connected project already has these updates. Store the Brevo REST API key as `briefbooth_brevo_api_key` in Supabase Vault; never place it in browser configuration or source control. The existing verified sender is `no-reply@briefbooth.com`.

An insert trigger queues two private snapshots atomically with each booking. A private cron job runs every minute and submits up to three messages through Brevo. Retrying a booking does not enqueue another pair. Provider idempotency keys provide additional protection. Cancelled/past bookings are skipped before sending. Rate limits wait without a paid fallback; authentication failures wait for credential repair. Unknown network/server outcomes are marked `uncertain` for provider-log review instead of blindly resending. `accepted` means Brevo accepted the email, not a delivery guarantee. Delivery records are retained for 30 days; all booking data remains subject to existing account retention.

Brevo Free's 300-email daily allowance is shared with signup/recovery and other use of this existing account. At limits, delivery may be delayed; never enable automatic upgrades or purchase credits. API-key expiry must be maintained in Brevo/Vault. Inspect `briefbooth_private.booking_emails` and `cron.job_run_details` using administrator access when diagnosing failures; neither is available through public booking RPCs.

## Shareable intake questionnaire

Each consultant has `/book/YOUR_SLUG`, suitable for a website button or a direct message. In Studio → Questionnaire, create up to 10 short/long text questions, mark required answers, and reorder or remove questions. Name and email are always requested. Save the questionnaire and publish the profile. Clients answer one question at a time with a progress bar, Back controls, and a Skip option for optional questions, then choose a consultation, meeting format, and available time. No client account is required.

Answers are submitted when the booking is confirmed, saved with question labels in the private booking record, and included in both confirmation emails. Unfinished questionnaires are not saved as leads. The server validates required answers and rejects outdated question IDs; the legacy booking endpoint is no longer public.

Questionnaire templates are available for business, marketing, career coaching, technology, design/branding, operations, leadership, and events. Preview four questions, replace the draft or append them (up to 10 total), and undo template changes before saving. Existing bookings retain their original answers. Templates add no external service or cost.

### Direct payment preferences (Stripe paused)

Booking is free on BriefBooth. Studio → Consultations lets consultants select Cash App, Venmo, PayPal, Zelle, bank transfer, cash, or Other and save optional public instructions. Clients see “Negotiate with consultant” before confirming. Any fee is arranged directly; BriefBooth does not collect or verify payment.

Apply `supabase/migrations/20261018200000_free_booking_preferences.sql` after the payment migrations for the current free-only release. See `PAYMENT-SETUP.md` for the paused integration status.
