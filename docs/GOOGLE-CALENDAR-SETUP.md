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
