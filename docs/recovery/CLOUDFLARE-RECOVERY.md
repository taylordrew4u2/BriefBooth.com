# No-charge recovery preparation — November 6, 2026

## Scope
Prepared, not activated. Restore 4u Digital's existing free Google Meet consultation inside BriefBooth while Supabase remains restricted. Retain approval-required mode, weekly hours, 1-hour notice, 60-minute buffers, 60-day horizon and intake requirements. Other consultants and historical bookings are not migrated by this narrow recovery path. Full Studio remains dependent on Supabase.

## Cost boundary
Existing Cloudflare account verified Workers Free, $0, with no D1 databases used. D1 Free has 5 million rows read/day, 100,000 written/day and 5GB total; Workers Free100,000 requests/day and10ms CPU per request. No unlimited or no-interruption claim. Do not enable a paid plan or auto-upgrade. User must accept this finite-capacity alternative before activation given their prior unlimited requirement.

## Activation prerequisites
- Test isolated code with mock provider responses and local SQLite.
- Verify latest production deployment before any replacement; preserve Google review movie and existing Google/Zoom callback routes.
- Explicit approval before granting the Cloudflare backend ongoing access to the existing Google Calendar connection and email credentials. Browser security policy requires per-action consent for configuring credentials for ongoing access. Do not put secret values in files tracked by Git, UI URLs, logs or frontend code.
- Existing Google client ID/secret, owner refresh token and Brevo email key must be installed privately as encrypted server-side secrets; no additional Google scopes requested.
- Owner approval capability is private, hashed in runtime configuration. Client status capability remains in URL fragment and Authorization headers, never public logs.
- Create D1 database/binding only on current free plan. Configure server-only public schedule JSON and secret values; activate NEXT_PUBLIC_BOOKING_RECOVERY only after checks.
- Recheck upcoming reservations at cutover and import blocking intervals, not private historical data. Previous read found no upcoming owner reservations, but must refresh.
- End-to-end test disposable request, duplicate retry, competing slot, owner approval, actual Google Calendar/Meet creation, confirmations and cancellation. No real payments.
- Prevent old backend and recovery backend from independently accepting bookings after quota resets; recovery routing remains authoritative for4u Digital until records reconciled. No silent fallback writes.

## Known limitations
This does not remove Google quotas, Cloudflare daily limits, domain renewal, internet dependency or existing third-party plan terms. It does not satisfy an unlimited/free-forever guarantee. No support request sent; no new provider account created.

## Prepared verification
November6 local checks passed: full existing npm test suite, lint, recovery SQLite-backed tests (fresh Calendar availability, atomic competing reservations, idempotency, required multi-choice intake, capability authorization, stale/expired leases, approval/Meet failure retries, cancellation, stale notification suppression and uncertain-delivery handling), full Next static build with NEXT_PUBLIC_BOOKING_RECOVERY=1, final bundled Worker generation. Browser preview at localhost:3106 showed the booking form/intake in-app; preview server refuses all writes and uses no Google credentials. Screenshot /tmp/briefbooth-recovery-form-preview.png; current Cloudflare free-plan proof /tmp/briefbooth-cloudflare-free-plan.png.

NOT live verified: Google refresh token usability, actual Meet creation, Brevo delivery, deployed Cloudflare D1/Worker execution, production end-to-end. No D1 database, binding, new credentials, or production deployment created during preparation. Existing frontend recovery deployment613a185 remains production.
