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
