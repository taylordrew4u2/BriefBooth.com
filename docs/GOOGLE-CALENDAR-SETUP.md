# Google Calendar and Meet — work in progress

User authorized Google Meet as a permanent alternative alongside Zoom, with optional consultant-approved busy-time sync. Hard constraint: free services only. Public support contact must be admin@customtechbuilt4u.com; personal Gmail is not approved as consent-screen support contact.

## Implemented locally, NOT deployed or live
- Google Meet meeting choice across studio, intake and management UI.
- Primary Google calendar busy-time cache; five-minute polling design, ten-minute stale guard. This is eventual sync, not guaranteed real-time protection against external calendar changes.
- Single-use OAuth state; encrypted refresh tokens in Vault; callback on verified domain.
- Approval-gated Meet job creation; deterministic Google event IDs; cancellation cleanup; confirmation emails wait for verified meeting URL.
- Service-only worker APIs and dedicated scheduler secret design.
- Disconnect deletes stored credentials/busy intervals and hides affected meeting types. Google-side revocation is user-controlled.
- Privacy disclosure and Google account limits.

Build and full regression suite passed locally, including Google database and provider helper tests. No Google API connection, real Meet event or Google confirmation email has been tested. Do not call the feature complete.

## Google project
Project display name: BriefBooth Calendar.
Project ID: forward-ace-512209-j8.
Created in the existing Google account without attaching billing. No credentials or OAuth branding configured yet. The only support-email dropdown choice was the owner's personal Gmail; user declined. Google requires the support address to be the currently signed-in Google Account or a managed Google Group (https://support.google.com/cloud/answer/15549049).

Signing in with admin@customtechbuilt4u.com returned “Couldn’t find this account.” User corrected that an existing Google login is associated with it and is now signing in. Stop new-account registration and use their existing account. Browser tab returned to project overview for that handoff. Do not create a second project or use personal Gmail as public support.

## Remaining
1. Identify existing business Google account/group. If necessary, obtain action-time confirmation before granting it project access. Confirm exact public support email is available.
2. Enable free Google Calendar API, configure consent branding and two scopes (calendar.events.owned, calendar.freebusy), authorized domain briefbooth.com, app home/privacy/terms, and redirect https://briefbooth.com/api/google/callback. Legal agreement or sensitive access changes require action-time confirmation. New credential creation in browser requires user handoff.
3. Securely store Google client_id/client_secret in Vault using names briefbooth_google_client_id and briefbooth_google_client_secret; no secret disclosure. Configure external testing and verification appropriately before public rollout.
4. Finish review of worker synchronization/refresh races, cancellation races, and payment settlement with newly busy calendar time. Paid checkout must not strand paid reservations on a calendar-guard error.
5. Check worker maximum duration and Google quota/backoff. Worker currently selects ten least-recently-synced connections per run; do not claim unlimited scale. Confirm meeting-creation capability of connected primary calendars and improve failure UI.
6. Apply migrations 20261020170000 and 20261020171000 only after review; verify net.http_post and Vault two-argument create_secret supported. Deploy google edge function with own cron-secret authentication and OAuth state; verify callback gateway and unauthorized rejection.
7. Deploy Cloudflare static release once backend is ready; Vercel stays paused. Test authorized consultant OAuth, busy-time hiding, approval and instant Meet bookings, cancellation and both inboxes. No real charges. Preserve 4u Digital Zoom connection and free consultation.
8. Google Sign-In to BriefBooth was discussed, not implemented; current feature connects Calendar/Meet after normal BriefBooth login. Outlook/iCloud automatic sync is not implemented. Existing ICS download remains.

## October 20 deployment update
- Business Google account admin@customtechbuilt4u.com created by user; name 4u Digital, padded white logo saved. Existing email delivery unchanged.
- OAuth Config Editor granted to business account with explicit approval. Owner remains original account; business account does not have overview quota or service-account-list access, so remaining console work uses original owner.
- Branding saved as BriefBooth with business support/developer contact, briefbooth.com home/privacy/terms and authorized domain.
- User created production Web OAuth credential with callback above. Both values stored in Vault with explicit transfer approval and presence verified without exposing secrets.
- User approved scopes, API terms and production switch. Calendar API enabled. Audience now In production; branding and sensitive-scope verification NOT submitted/approved. Google shows 100-user cap before verification.
- Both Google migrations applied; pg_net enabled for scheduler. Google edge function v1 ACTIVE with its own state/cron authentication; unauthenticated sync returns 401. No consultant connected yet.
- Payment settlement guard fixed to preserve existing checkout holds if external sync is stale. Regression test added and full npm test and build pass.
- Callback UI now explains success/expired/cancelled/missing-scope/failure. Worker has 40-second loop budget (individual in-flight network calls may extend it).
- Cloudflare release upload initiated this turn. Verify deployment success and callback before claiming live.
- Still required: actual OAuth consent, real Meet event and both emails, cancellation/busy checks; branding/domain verification and Google review evidence. No Google or all-calendar sync completion claim yet.

## October 20 live validation, 7:13 AM Eastern
This update supersedes the earlier pending deployment/connection notes.
- Google Search Console verified briefbooth.com ownership using public/googleb22df470dfcf9136.html; retain this public verification file in future releases.
- Cloudflare production release is live on briefbooth.com. Google callback completed successfully after the user handled Google's unverified-app warning and granted calendar access to the selected Taylor Drew account.
- 4u Digital Google connection is ready; primary-calendar busy intervals are being synchronized by the active five-minute scheduler. Existing Zoom connection and free Zoom consultation remain intact.
- Added a free 30-minute Google Meet consultation, approval required, and updated the profile to describe both choices.
- Live client intake submitted through the public booking page. Pending request had zero Google jobs and zero confirmation messages before approval. Approved through consultant studio; Google created one event and Meet URL.
- Both distinct confirmation messages arrived in Gmail: client alias at 7:09 AM and consultant at 7:10 AM. Opened and checked both: same Meet URL, correct appointment time, and intake details. These used two recipient addresses delivering to the owner's Gmail, not two independent mailbox providers.
- Fixed Google Meet mislabeled as Zoom in the booking review, confirmation heading, and screen-reader status. Build passed; full test suite passed before final display-only fixes; subsequent production build passed. Correct wording verified on live custom domain.
- Disposable test appointment cancelled after delivery verification; checking worker cleanup separately.
- Google branding verification remains blocked by Google's instruction to wait 24 hours after domain verification before retrying. Sensitive-scope review has not been submitted or approved. Production audience does not equal Google approval; unverified warning/user cap remain.
- No billing, paid plan, platform fee, or real payment added. Vercel remains untouched/paused.
