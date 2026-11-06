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


## November 6 final preparation and verification

The user again instructed us to make bookings work without any payment. Nothing in this preparation enables billing, a trial, a new provider account, or support outreach. Production has not been replaced by this recovery.

Read-only account checks:
- Cloudflare remains Workers Free ($0). Production deployment observed: `55f16fbb-fb28-4a89-bbee-a335edbdda7d`, branch `main`; live `/book/4u-digital/` still reports the blocked booking backend.
- Google project `forward-ace-512209-j8` has no billing account linked. The existing owner refresh credential was verified in its existing private environment: refresh HTTP 200, with exactly `calendar.events.owned` and `calendar.freebusy`. No token was printed or moved to Cloudflare.
- Existing Brevo key was checked against its account endpoint from its existing private environment. HTTP 200, plan `free`, active, 300 sends/day, email relay enabled. No messages were sent by this check.
- Supabase remains a Free organization. Latest owner snapshot showed one active free Meet service, approval required, and zero future pending/confirmed reservations. Recheck after activating the old-write guard at actual cutover.

Prepared changes now include a recovery homepage pointing to the real consultation page; clear disclosure that full account/Studio functions are unavailable; accessible booking errors and retry controls; owner pagination; safe cancellation across an ambiguous Google creation; conditional privacy disclosures for Cloudflare secret and database processing. The recovery stores no live Google busy-time response and sends no client intake or email address to Google Calendar.

### Controlled cutover and rollback

1. Obtain the outstanding specific approval to configure existing Google and Brevo credentials for ongoing access in the existing Cloudflare project, generate the private owner review key, and activate this finite-capacity, single-business alternative. Browser security rules require confirmation for that persistent access. Broad permission to fix the app is not the specific credential transfer confirmation.
2. Recheck production and provider plans; stop if billing, a trial, an expanded permission, or unrelated production changes would be required.
3. Configure the private D1 schema/binding and encrypted secrets. Do not write secret values to source, screenshots, URLs, logs, or deployment assets.
4. Apply `supabase/migrations/20261106230000_recovery_booking_guard.sql`, which is disabled by default. At cutover run `recovery/activate-supabase-owner-guard.sql`. It serializes against in-flight legacy writes for this owner.
5. After the guard commits, take the final upcoming-reservation snapshot and import blocking intervals if any. Only then enable recovery intake. Do not allow two independent write paths.
6. Deploy the reviewable recovery artifact, preserve callback routes and the review MP4, then test a disposable real request, approval, Calendar event and Meet creation, confirmation delivery, cancellation, and slot release. Mock tests do not substitute for these live checks.
7. To roll back, stop NEW recovery requests first; retain private status/cancellation access and reconcile active recovery records before running `recovery/rollback-supabase-owner-guard.sql`. Do not delete bookings, the D1 database, or retained integration data. Returning to the old frontend alone does not restore a quota-blocked database.

The prepared connection settings form has an empty secret field; nothing has been saved. Evidence: `/tmp/briefbooth-recovery-connection-approval.jpg` and `/tmp/briefbooth-recovery-free-plan.jpg`.


Independent readiness review fixes are complete: definite first-attempt Google rejections return to a cancellable pending request, ambiguous creates retain a reservation until reconciled, terminal Meet failures are explicit and support owner cancellation, and the old-system guard covers rescheduling/reassignment/reactivation as well as inserts. Owner history uses bounded cursor pagination so older pending requests remain accessible. Same-tab private-link changes clear stale client/owner data. Backend and guard regression suites passed after these fixes.

Final recovery-enabled build/typecheck/static export, full lint, diff checks and mobile mocked browser suite passed. Provider calls were mocked in UI/backend tests. Reviewed artifacts are saved outside the temporary checkout in `/Users/taylordrew/Documents/Codex/BriefBooth-recovery-2026-11-06/`; public bundle secret-pattern scan passed and the Google review MP4 checksum is unchanged. No live recovery was activated.
