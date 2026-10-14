# BriefBooth

A consultation booking app for independent consultants, built with Next.js, React, TypeScript, and Supabase. Deployable to Vercel. No paid scheduling, payment, email, analytics, or calendar service is required by the app.

## What works

- Consultant accounts: email/password, password recovery, optional Google sign-in.
- Public profiles with a unique shareable URL, publish/unpublish controls, and a private meeting link.
- Consultation types with 15/30/45/60/90-minute durations and visibility controls.
- Weekly availability in the consultant’s IANA timezone, adjusted for daylight saving time.
- Clients book without accounts, see times in their own timezone, and leave optional notes.
- Database-enforced overlap prevention across all consultation types, two-hour notice, and a 60-day booking window.
- Private confirmation/management links, cancellation, and downloadable calendar events.
- Consultant view of their bookings and client contact details.
- A clearly labeled interactive demo at `/book/demo`; it never saves a real booking.

## Before going live

The repository contains the complete application and database schema. **Live authentication and bookings stay disabled until you connect your own Supabase project.** No project or deployment has been provisioned automatically.

### 1. Create the free database

1. Create a Free project at [Supabase](https://supabase.com/dashboard). Free plans have limits and can pause inactive projects; check [current limits](https://supabase.com/pricing).
2. Open **SQL Editor** and run `supabase/schema.sql` once in a fresh project. It creates tables, access policies, and booking functions. Do not rerun it against an existing installation without a migration.
3. In the project’s **Connect** dialog, copy the project URL and publishable key. The publishable key is intended for browser use; row-level security protects private records. Never use a service-role or secret key here.
4. Copy `.env.example` to `.env.local` and fill in these values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
```

### 2. Configure sign-in

For public consultant registration without an email delivery provider, enable **Google** in Supabase **Authentication → Sign In / Providers** and follow the [official Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google). Use only the basic profile/email/openid scopes. Set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` after the provider is configured. This uses Google for identity only; it does not read or sync Google Calendar.

Email/password registration and password recovery are also implemented. **Supabase’s built-in email sender is intended for testing and only sends to authorized team addresses.** To offer email confirmation/recovery to the public, configure your own SMTP sender, with a free plan if desired. See [Supabase’s SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp). Do not disable email verification merely to bypass this restriction.

In Supabase **Authentication → URL Configuration**:

- Set **Site URL** to your final HTTPS domain.
- Allow `https://YOUR_DOMAIN/studio` for Google sign-in.
- Allow `https://YOUR_DOMAIN/account?mode=password` for recovery.
- During local development also allow the equivalent `http://localhost:3000` URLs.
- Add the exact URLs for any Vercel preview where you intend to test authentication.

### 3. Run locally

Use Node.js 22 or later.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. The home page and interactive demo work before connecting Supabase. Restart the server after editing environment variables.

### 4. Deploy to Vercel

1. Import this GitHub repository into Vercel and choose the branch containing the app. Framework: **Next.js**; root directory: repository root. Standard build command: `npm run build`.
2. Add the environment variables above for Production (and Preview if needed), then deploy.
3. In **Project → Settings → Domains**, add the domain you already own and apply the exact DNS records Vercel shows at your registrar. Domain ownership does not eliminate hosting costs.
4. Update the Supabase sign-in URLs to match the final domain and test sign-in after DNS is live.

**Cost constraint:** [Vercel Hobby restricts usage to personal, non-commercial projects](https://vercel.com/docs/plans/hobby). A commercial consultation platform may require a paid Vercel plan. This app has no paid-service dependency, but cannot guarantee free commercial hosting on Vercel. No paid plan has been selected or purchased.

### 5. Set up a consultant

1. Sign in and open `/studio`.
2. Enter your name, profile, unique page address, and optional meeting URL. Save the profile.
3. Add at least one consultation.
4. Select your schedule timezone and save it; enable the weekdays and hours you offer and save weekly hours.
5. Publish your profile and share `/book/YOUR_SLUG`.
6. Make a real test booking in another browser, verify it in your studio, download the event, and cancel using the private link. Confirm that the time becomes available again.

## Validation

```sh
npm run lint
npm test
npm run build
```

`npm test` runs the real migration and booking functions in an embedded PostgreSQL database with the `btree_gist` extension. It verifies time-slot calculation, overlapping booking rejection, invalid input rejection, cancellation reopening a time, private meeting links, client data protection, consultant isolation, transactional availability saves, timezone validation, daylight saving, and idempotent booking retries.

With the local server running, `npm run test:browser` checks responsive layouts and the full demo flow in installed Chrome. Tests do not substitute for a live Supabase authentication/deployment smoke test.

## Boundaries

- No payment collection, booking emails, reminders, automatic video room creation, or external calendar sync. The UI states these limitations where relevant.
- Clients must save the private management link shown after booking. It acts as a secret capability: anyone with it can view basic booking details and cancel an upcoming appointment. Private pages request no indexing and send no referrer.
- The weekly schedule repeats; date-specific overrides, holidays, and external calendar conflicts are not implemented. Consultants should publish only hours they can honor and hide their page when away.
- Basic booking abuse controls include validation, an app-form honeypot, and a database limit of five new bookings per client email per consultant per hour. This is not a strong bot defense; a public launch with significant traffic should add a server-verified CAPTCHA and stronger rate limiting before wider promotion.
- The app does not use a service-role key. Ownership is enforced by PostgreSQL row-level security; public bookings go through constrained database functions.
- Free services have usage quotas and availability limits. No usage-based paid fallback is enabled.

## Design

The implemented direction is a crisp white/slate/blue booking interface. It uses Better Design’s installed React primitives and Instrument Sans, with a product-specific token override. The earlier outdoor/architectural brand exploration is not used in the application. No generated imagery, invented testimonials, customer counts, or trademark registration claims are included.
