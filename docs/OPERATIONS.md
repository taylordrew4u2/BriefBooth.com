# Deployment and operations

This document describes the current static Cloudflare deployment and its managed backend. The product overview, screenshots, and engineering rationale are in the [README](../README.md).

## Hosting model

- **Frontend:** Cloudflare Pages Free; `briefbooth.com` and `briefbooth.pages.dev`.
- **Authentication/database:** Supabase Free.
- **Email:** Brevo Free SMTP for Supabase Auth; Brevo REST API for booking notifications.
- **Zoom:** Supabase Edge Function plus private scheduled meeting work. The initial consultant is connected; wider distribution awaits approval.
- **Public Zoom gateway:** a Pages Worker runs only for `/api/zoom/*` and forwards the two supported callback/deauthorization endpoints.

Free tiers have quotas. The application has no automatic paid fallback. The existing Vercel project is paused and must not be resumed as the deployment path under the current free-only requirement. Do not change other projects or the account’s subscription.

## Frontend configuration

Use Node.js 22 or later. Copy `.env.example` to `.env.local` and configure:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
```

These are public browser settings. SMTP passwords, service-role keys, Brevo API keys, and Zoom credentials must never be exposed through `NEXT_PUBLIC_` variables or committed files. Google authentication is optional, disabled by default, and does not provide calendar synchronization.

```sh
npm ci
npm run lint
npm test
npm run build
```

The complete deployable directory is `out`. `scripts/prepare-pages.mjs` adds route shells, `_worker.js`, and `_routes.json`. Preserve the Zoom verification HTML file in `public` when rebuilding.

## Backend provisioning

The connected production database is already provisioned. Do **not** replay its base schema or use these instructions as a production reset procedure.

For a separate empty Supabase project:

1. Review and apply `supabase/schema.sql`.
2. Review and apply the dated SQL files in `supabase/migrations` in timestamp order. The historical meeting-mode migration is retained alongside the schema; inspect its idempotent changes before applying. Do not skip the payment migrations merely because payments are paused: subsequent migrations refer to their objects.
3. Apply `supabase/booking-email-worker.sql` after the email migration. Inspect the later Zoom/approval migrations, which update the notification and meeting worker behavior.
4. Enable the Supabase extensions required by those SQL files, including cron, network requests, and Vault, as appropriate for the project.
5. Configure Supabase Auth email confirmation and SMTP. Keep verification enabled.
6. Set the Auth Site URL and exact redirects for `/studio/` and `/account/?mode=password`, including the trailing-slash variants and local preview addresses you actually use.
7. Store the Brevo REST API key in Vault under `briefbooth_brevo_api_key`. Configure a verified sender for your domain.
8. If enabling Zoom, deploy `supabase/functions/zoom` and follow [the Zoom release guide](../ZOOM-PUBLIC-RELEASE.md). Keep public authorization gated until distribution requirements are satisfied.
9. Verify with disposable accounts and a controlled booking before inviting real clients.

The SQL and Edge Function files are the source of truth for required secrets, permissions, and worker schedules. PGlite test stubs are not provisioning instructions for hosted Supabase.

## Static routes and deployment

`public/_redirects` sends arbitrary `/book/SLUG` and `/manage/TOKEN` requests to exported shells outside those URL prefixes. The client reads the requested URL and retrieves authorized data. Keep document navigation for these dynamic URLs; do not assume a Next.js payload exists for every consultant slug.

The active Cloudflare project uses Direct Upload. With an authenticated Wrangler CLI:

```sh
npm run build
npx wrangler pages deploy out --project-name briefbooth
```

The Cloudflare dashboard can also upload a ZIP containing the **contents** of `out`, not an enclosing parent directory. Deploy to the existing Free project; no new service or paid plan is needed. Direct Upload and Git-integrated Pages projects have distinct workflows; changing between them is not part of a routine release.

For a local production-style preview:

```sh
npm run build
npm start
# A second terminal:
npm run test:pages
```

After publishing:

```sh
PAGES_TEST_URL=https://briefbooth.com npm run test:pages
```

Confirm the homepage, account page, consultant studio, an arbitrary booking URL, a private management URL, and a genuine 404. Preserve security headers and private-page no-cache/no-index behavior. Check Zoom gateway responses separately when its code or configuration changes.

## Consultant setup

1. Sign up and verify the email address.
2. Open **Studio → Profile & Zoom**. Set the display name, booking address, introduction, and meeting details.
3. Choose **instant confirmation** or **request approval**.
4. In **Intake questions**, choose a template or edit questions, then save. Template previews modify drafts; they do not publish automatically.
5. In **Meeting types**, add an active consultation and duration. Any direct-payment preferences are informational only.
6. In **Availability**, save the timezone and weekly hours.
7. Publish the profile and copy the booking link from **Overview**.

Clients answer intake questions before scheduling. Pending approval requests reserve their selected slot. Consultant approval triggers the confirmed flow; a required Zoom meeting must be ready before its confirmation emails can be sent.

## Email delivery and failure handling

Booking-related messages are private snapshots queued for both parties. They include intake context, appointment time/timezone, and only the selected meeting format’s details. The worker runs on a private schedule and sends bounded batches through Brevo.

- Booking retries must not enqueue duplicate message pairs.
- Known rate limits wait; no paid fallback is enabled.
- Credential failures require credential repair.
- Ambiguous network/server outcomes are marked uncertain for provider-log review rather than blindly retried.
- `accepted` means the provider accepted the request; it does not guarantee delivery to an inbox.
- Cancellation and past-booking checks prevent inappropriate queued confirmations from being sent.
- Delivery records are retained for 30 days under the implemented cleanup behavior.

The configured Brevo Free allowance is shared between signup/recovery and booking emails, as well as other use of that account. Inspect the provider dashboard for current quotas before increasing volume. Never purchase credits or enable paid upgrades to work around a quota.

For diagnosis, an authorized administrator can inspect `briefbooth_private.booking_emails`, scheduled job results in `cron.job_run_details`, and the provider’s delivery logs. Keep these private; do not attach client intake, credentials, or management tokens to public issues.

## Zoom lifecycle

- Each consultant connection has its own identity, tokens, and environment.
- Vault holds provider credentials and connection secrets; browsers receive connection status, not tokens.
- OAuth state is expiring and single-use.
- Confirmed Zoom bookings create meetings through private scheduled work.
- Signed deauthorization requests remove the applicable saved connection.
- Cancelling a booking does not delete a Zoom meeting already created; manual removal remains necessary.

As of October 19, 2026, the app is submitted for Zoom functional review with unlisted, outside-EU distribution and manual activation. Submission is not approval. Keep the existing owner's working development connection and production credentials separate, and complete two-account validation before opening public production authorization.

## Release checklist

- Run lint, domain tests, and the production build.
- Check desktop and narrow-phone layouts through the actual UI.
- Confirm assets contain no credentials or private screenshots.
- Upload the generated static release, retaining route shells, headers, Zoom verification, and gateway files.
- Run deployed Pages checks and inspect the changed user flow.
- Record the commit and any unfinished integration requirements.

See [payment setup](../PAYMENT-SETUP.md) for the paused Stripe work. Live bookings currently collect no payments; consultants and clients arrange any fee directly.
