# BriefBooth: public Zoom release preparation

Status: not submitted. Existing development connection remains live for 4u Digital. Do not set `briefbooth_zoom_public=true` or replace current credentials before production authorization is approved and tested.

## Prepared listing copy

Name: BriefBooth

Short description: Collect client intake, approve consultation requests, and automatically create a Zoom meeting for each confirmed consultation.

Description: BriefBooth gives independent consultants a shareable intake and booking page. Clients answer a short questionnaire and request an available time. Consultants choose automatic confirmation or review each request. Connected Zoom accounts create a meeting only when a Zoom consultation is confirmed; BriefBooth emails the meeting link and intake to the consultant and client. Clients do not need a BriefBooth account. BriefBooth does not record meetings, read recordings, or synchronize calendars. Zoom account limits apply.

Installation: Sign up and verify your BriefBooth email. Save your consultant profile, consultation type, and hours. In Studio → Profile, select Connect Zoom and authorize meeting creation. Publish and share your booking link.

Use: Select Zoom for the consultation. Instant bookings create the meeting after submission. Approval-mode bookings create it after the consultant approves in Studio → Bookings. Both participants receive the unique join link by email.

Removal: Remove BriefBooth from Zoom Marketplace → Manage → Added Apps. Existing Zoom meetings must be managed in Zoom. The signed deauthorization handler has been deployed but still needs the production webhook secret and Zoom endpoint validation before public release.

## Technical design / review notes

- User-managed OAuth; minimum scope `meeting:write:meeting`.
- A signed-in consultant starts OAuth. Expiring single-use state binds the callback to that consultant. Tokens are encrypted in Supabase Vault, excluded from client APIs, and refreshed under an owner-specific lock.
- Each confirmed booking queues an owner-specific Zoom meeting. Approval-mode requests do not create meetings before approval. Meeting IDs/join links are associated with the booking. Email waits until the meeting is ready.
- Intake is held in private booking records and confirmation-email snapshots; it is not sent as a Zoom meeting agenda. Zoom receives the generic consultation title, start time, duration, and meeting settings.
- Postgres row-level security restricts consultant records. Public RPCs validate booking inputs and use unguessable management tokens. Tests cover cross-owner access, replay, pending requests, confirmation gating and cancellation.
- Cloudflare Pages hosts the frontend. Supabase handles auth, data, OAuth callback and scheduled jobs; Brevo delivers email. No paid infrastructure is required by this configuration.

## Remaining requirements

1. DONE: Operator 4u Digital and support admin@customtechbuilt4u.com confirmed. Published /privacy/, /terms/, /support/ and /zoom/ with actual retention and manual deletion practices.
2. Supply BriefBooth app icon, category and company information; complete Zoom's EU/trader declarations truthfully with the owner. These cannot be inferred from a display name.
3. DONE: Production contacts, meeting-creation scope, strict callback matching, listing text, Scheduling category, unlisted distribution and public URLs are saved. Production callback is the Supabase `/functions/v1/zoom/callback` endpoint.
4. Handler and cleanup deployed in Edge Function v3. Local tests cover signed challenges, invalid signatures, stale requests, wrong client IDs, delayed/duplicate events, token deletion, link redaction and consultant isolation. Still requires production webhook secret and Zoom validation; actual public deauthorization has not been exercised.
5. DONE: Per-connection and OAuth-state environments are deployed, and the meeting worker refreshes each connection with its own environment credentials. Production Vault credentials are still pending; do not replace development credentials. Tests cover existing-owner preservation, production state binding, refresh preservation and credential isolation.
6. Provide review test instructions and any requested demo/account. Submit for Zoom's functional/security review; outside-account distribution requires its approval.
7. After approval, enable the public production flow, verify two independently owned consultant accounts, and retain the owner's working connection throughout migration.

No review approval, external-account authorization, or production cutover has been claimed or completed.

## Deployment verification — October 19, 2026

Small-avatar feature and the 3,190-byte 4u Digital logo are live. Support/privacy/terms/Zoom guide are deployed on Cloudflare Pages; all four routes return HTTP 200. Lint, static build and production Pages route checks passed. No paid subscription was selected. Public Zoom activation remains off. EU release choice is awaiting the owner’s reply; no business identity, banking details or security certifications have been invented.

Environment-isolation migration and Zoom Edge Function v2 are deployed. Live 4u Digital connection remains ready=true in development; public_enabled=false. Invalid OAuth state returns the expected safe expired redirect. `node tests/zoom.mjs` passes including isolation regressions. No new authorization, test meeting or email was created during this verification.

The owner approved user:read:user; the production scope is saved alongside meeting:write:meeting. The production callback fetches /users/me and retains only its ID. Production secrets remain unset, so the webhook returns 503 without processing requests. The owner’s development connection remains ready. Awaiting authorization to transfer existing production secrets to Supabase Vault and the EU release choice.
