# Optional consultation payments

Status: implemented for sandbox testing, not enabled for real payments. The public Cloudflare frontend still runs the earlier free-booking release. Do not treat database/unit checks as proof of a completed Stripe checkout.

Consultants can set a free consultation or a USD amount of at least $0.50. The client sees an inclusive total with the consultation amount and estimated processing shown separately. Examples: $5 + $0.46 = $5.46; $500 + $15.24 = $515.24. Estimates use standard US domestic-card pricing of 2.9% + $0.30, rounded to cents. Actual fees vary; the amount received is not guaranteed.

Connect uses Accounts v2, full Stripe dashboards, direct consultant charges, and Stripe as fee/loss collector. No platform application fee, subscription, Stripe Tax, or paid infrastructure upgrade is configured. Each consultant completes their own Stripe onboarding and handles refunds in Stripe.

## Deployment

Apply the consultation payment and minimum-price migrations after the existing intake/email migrations. Deploy `supabase/functions/payments/index.ts` with platform JWT verification disabled: the handler verifies consultant JWTs itself, booking management uses an unguessable capability token, and webhooks verify Stripe signatures against the raw request body.

Store configuration in Supabase Vault with the prefix `briefbooth_stripe_`: `secret_key`, `webhook_secret`, `origin`, `live` (`true` or `false`), `sandbox_owner` (the only consultant allowed to use sandbox payments), and a random `cron_secret`. The service-role-only `payments_config` RPC reads these values. Redeploy/restart the function when changing configuration because it loads at startup. Never include secrets in the frontend or Git.

Register a connected-account webhook at `/functions/v1/payments/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. Apply `supabase/payment-reconciliation.sql` once to schedule recovery every five minutes. Existing booking-email delivery continues through the private outbox.

The server snapshots the price and reserves the time before creating Checkout. Successful payment confirms the booking and queues both emails. Processing payments retain the slot. Expired/failed payments release it. Retries are idempotent; reconciliation recovers missed notifications and a successful Checkout creation followed by an interrupted database write. Canceling a paid booking does not refund it automatically.

## Current verification and remaining work

- Local build, lint, database/payment tests and deployed handler authentication/signature checks pass.
- The sandbox Connect agreement is accepted, and the application's hosted consultant-onboarding link works.
- Test consultant activation is waiting at Stripe's password creation screen; the user must complete that browser credential step.
- Still required: sandbox successful/declined/canceled Checkout, actual webhook and confirmation delivery tests; live Connect configuration and credentials; production frontend publication.
- Never switch the sandbox account mapping to live. Live mode requires a new live consultant account mapping and a separate live webhook/key. Retire the disposable sandbox fixture after verification.

Cloudflare, Supabase, and Brevo remain on their existing free setup. Free quotas still apply; no automatic paid fallback is configured.
