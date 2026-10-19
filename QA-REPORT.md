# Production journey verification — October 18, 2026 (America/New_York)

Verified on https://briefbooth.com using isolated test consultants and Gmail aliases belonging to the project owner. No paid service was activated and no payment was processed.

| Journey | Result |
| --- | --- |
| Signup | Public signup accepted; sign-in blocked before verification; verification email arrived in inbox. |
| Verification handoff | Fixed the root-page callback and added an explicit account-page redirect. A fresh delivered confirmation link opened the signed-in studio. |
| Login | Verified account signed in with email/password. |
| Consultant setup | Saved profile, private Zoom/address details, Technology & IT questionnaire template, consultation service, and weekly availability through the live UI. |
| Sharing | Copy link produced the correct absolute public URL. Opened the copied URL signed out. Unsaved profile edits now cannot expose a share link. |
| Client intake | One question at a time, required answer saved, optional question skipped, then consultation selection. |
| Zoom booking | Completed through the public UI without a client account; confirmed immediately. |
| In-person booking | Completed through the public booking API; confirmed with the address and no Zoom link. |
| Email delivery | Four emails arrived in the inbox: client and consultant for both meeting modes. Read and checked actual received content for intake, timezone, and the matching Zoom link/address. The normal scheduled worker delivered them. |
| Consultant bookings | Authenticated read returned both bookings and saved intake. Anonymous reads could not access booking or private settings tables. |
| Duplicate protection | Rejected a second booking at the occupied time; identical request retry returned the original booking. |
| Calendar | Downloaded ICS included the correct UTC time, duration, title, and Zoom location. |
| Cancellation | Cancelled through the private management page; exact original time became available again. |
| Setup guidance | Added a checklist for published profile, active consultation, and saved availability. Early service/hours saves direct new consultants to profile setup. |
| Button readability | Fixed a global color rule that overrode white labels on dark action buttons. |
| Static hosting | Public/private deep links, assets, security headers, no-cache/no-index management routes, and 404 checks passed. |

Production build, lint, and database tests pass. Database coverage includes overlap prevention, access isolation, timezone/DST, intake validation, immutable email snapshots, retries, and the paused-payment restrictions.

Stripe remains paused. Cloudflare Pages, Supabase, and Brevo retain their existing free configuration and quotas. No subscription, paid fallback, or infrastructure upgrade was added. Zoom links are provided by consultants; the app does not create Zoom rooms or sync external calendars. Reminder and cancellation emails remain outside this release.

## Phone usability — October 18, 2026

Checked responsive browser viewports at 320px and 390px: homepage, sign-in, consultant profile/questionnaire/availability/preferences, one-question intake, consultation selection, meeting mode, date/time selection, and demo confirmation. Completed the in-person demo journey without creating a real appointment.

Fixed narrow-screen intake overflow, stacked Zoom/in-person choices, increased tap targets, and used 16px form text to prevent phone input zoom. Restored mobile Sign in, wrapped studio tabs so every section stays visible, and shortened the final intake button to “Choose consultation.” Preserved the existing colors and simple question-by-question flow.

Lint, production build, static-route/security-header checks, and diff whitespace checks passed. These are responsive browser checks, not physical iOS/Android device tests. No service plans, billing settings, or backend/payment behavior changed.

## Booking-link discovery and developer template

Moved sharing out of the bottom of Profile into a persistent admin panel: full selectable URL, Copy booking link, client preview, and explicit setup instructions for unpublished profiles. Links use the saved published slug, so unsaved edits do not create invalid links. Verified clipboard output and visibility across admin tabs with the existing QA account. Added the App, web & full-stack development template with four questions (only the first required); verified applying and undoing its draft without changing saved account data. Lint, production build, static-route checks and whitespace checks passed.

## Designly polish across the app

Replaced the homepage calendar mockup with a representative intake-first journey, with a compact stacked preview on phones. Added a three-stage booking guide, refined form focus styles and consultation cards, and simplified the studio to emphasize copying the booking link with preview as a secondary action. Preserved the approved palette, one-question intake, free hosting configuration, and existing backend flows.

Inspected rendered desktop homepage and 390px phone homepage, intake, and authenticated studio; followed intake through consultation selection to scheduling and verified the stage guide advances. Fixed the initially cramped mobile preview after visual review. Production build, lint, and static-route checks passed. No new services or billing changes.

## Post-design production journey — October 18, 2026, 10:25 p.m. ET

Created a fresh QA consultant through the public signup API; verification was required and the delivered inbox link opened the studio. Completed profile publication, developer-template selection/save, consultation creation, weekly-hours save, copy-link, and returning password login through the production browser UI. Opened the copied URL signed out, verified required/optional questions, selected a real available time, and completed a Zoom booking through the UI. The consultant Bookings tab showed the saved intake and both meeting modes.

A second in-person booking through the public booking API verified the address email path. Read all four newly delivered Gmail inbox messages (client + consultant for Zoom and in person): correct intake, time, timezone, matching meeting details, and no cross-mode location leakage. The regular worker delivered three messages in one minute and the fourth in the next scheduled batch. Checked occupied-slot removal, duplicate rejection, idempotent retries, and anonymous booking privacy. UI cancellation succeeded and its exact time reopened.

Fixed misleading consultation empty-state guidance: a saved profile now prompts adding a consultation instead of telling the consultant to save the profile again. Lint/build, database/payment-paused checks, and live Pages checks passed. Both QA appointments were cancelled; the QA profile is unpublished and its service inactive. No real customer data was changed, no charge was made, and no paid service or plan was enabled.


## Automatic Zoom links — October 19, 2026
- Deployed encrypted per-consultant OAuth connection, single-use expiring states, meeting creation worker, and admin connection button.
- 4u Digital authorized the development Zoom app. Other consultants remain gated until Zoom approves distribution.
- A clearly labeled production verification booking created Zoom meeting 72171581232. Both consultant and client-alias emails arrived in Gmail with that unique meeting ID and intake details. The BriefBooth verification booking was cancelled afterward; Zoom meetings currently require manual removal after cancellation (create-only scope).
- Database tests cover email gating, two-recipient delivery snapshot, replay safety, private credentials, state consumption, and configuration key parsing. Existing tests, lint and production build passed.
- Weekly availability for 4u Digital is still unset; real booking cannot start until the owner supplies hours.

## Request approval — October 19, 2026
- Added per-consultant instant/approval preference; existing consultants retain instant booking by default.
- Set 4u Digital to approval with Sunday–Saturday 09:00–20:00 America/New_York availability.
- Pending requests hold their slot, notify both participants as requests, and expose no Zoom link. Only the owner can approve or decline. Approval queues Zoom creation and then confirmation emails; decline releases the slot and notifies the client.
- Automated tests passed for cross-owner rejection, repeated approval, pending Zoom/email gating, request messages, approval confirmation and decline slot release. Existing database, email, payment-paused and Zoom checks passed; lint and build passed.

## Live client request and admin approval — October 19, 2026

Completed the published 4u Digital developer intake in the client UI, using an owner-controlled Gmail alias and a clearly labeled test appointment for October 22, 11:15–11:45 a.m. Eastern. The request remained pending with no Zoom meeting. Both request emails arrived in Gmail with the intake answers and approval wording.

Approved that request in the owner's studio Bookings tab. The client page automatically changed to confirmed and then displayed its newly generated Zoom link. Normal scheduled workers delivered both confirmation messages to the consultant and client-alias addresses; read both delivered bodies and verified identical Zoom links, intake answers, duration, and Eastern date/time. No worker was manually invoked. Cancelled the BriefBooth test appointment afterward to release availability. The generated Zoom test meeting remains for manual removal because the connection has create-only permission.

No application fix was required for this flow. No paid plan, upgrade, payment, or additional service was enabled.

## Wiring audit — October 19, 2026

Reran database, custom intake, email-worker, paused-payment, Zoom and approval tests; lint, TypeScript/production build, and live Cloudflare route/asset/security-header checks all passed. Inspected signup/login/recovery callbacks and the studio/client database calls against the implemented endpoints. Live health inspection found both cron jobs active with 30 successful runs each over the preceding 30 minutes, ten recent email records accepted, and both generated Zoom jobs ready. The published 4u Digital profile retains approval mode and its five-question intake. No production changes were needed.

Reviewed security advisories: private tables intentionally deny client access without RLS policies; public booking capability functions and owner-checked functions intentionally use restricted SECURITY DEFINER entry points, covered by access-control tests. Leaked-password protection remains disabled; no paid security upgrade was enabled. Updated README to reflect automatic Zoom/approval functionality and its distribution and cancellation limitations.
