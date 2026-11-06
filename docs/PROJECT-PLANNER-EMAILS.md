# 4u Digital planner emails

In Studio → Bookings, each client booking belonging to the 4u Digital consultant has a **Send planner** button. It opens a read-only recipient, From, subject and message preview. Only **Send planner email** queues the email; opening, cancelling or refreshing never sends anything. The existing overview copy/share tools remain available.

The fixed planner URL is https://customtechbuilt4u.com/project-brief/. Both From and Reply-To are `4u Digital <admin@customtechbuilt4u.com>`. The preview and server templates match. Plain-text and HTML alternatives are supplied.

## Access and delivery

`send_4u_project_planner(p_booking, p_request)` accepts only an owned booking ID and a client-generated UUID. The server derives the recipient from that booking. Both public RPCs require the fixed 4u Digital owner, a verified email, and the existing private consultant role. No caller can choose an arbitrary recipient, sender, link, subject or body. The outbox and worker are private, RLS enabled, and inaccessible to browser roles.

The public RPC commits a queued request; a separate minute cron delivers it. The planner worker waits up to ten seconds for the existing shared email lock, preventing repeated skips when the booking worker starts first. It restores the caller's lock timeout and leaves the queue untouched if that bounded wait expires. Delivery states distinguish pending, provider accepted, uncertain and failed. Provider acceptance requires a message ID and does not imply Inbox placement or that the client read it. Refresh delivery reads the current state.

The browser retains a request UUID across interrupted retries and reloads. The database serializes duplicate/quota checks. Identical retries return the original request. Requests to the same recipient across different bookings have a 24-hour cooldown; unresolved pending/uncertain deliveries block another copy. This is individual client follow-up, not a bulk campaign.

## Existing Free infrastructure

Uses the existing Supabase database/cron, Brevo API key in Vault, and Cloudflare Pages deployment. No new paid product, upgrade or fallback is configured. Planner invitations are capped at ten queued and ten accepted per UTC day, with a conservative shared-budget check and the existing provider lock. A quota-blocked preview explains when sending becomes available; the copy/share tools remain usable.

Provider 401/403/429 responses retain the queue for a one-hour retry. Timeouts, 5xx responses or malformed success responses become uncertain and are never blindly resent. Inspect the private row and Brevo transactional log by its request reference before reconciling an uncertain result. Do not simply create a new request: the provider may already have sent it. Delivery rows expire after 30 days; unsent queued rows stop after seven days.

## Sender authentication

The existing Brevo account now has a verified `4u Digital` sender for `admin@customtechbuilt4u.com` and an authenticated `customtechbuilt4u.com` domain. Vercel DNS received the provider's root verification TXT and two DKIM CNAMEs. The existing DMARC `p=none` policy was retained and its required aggregate-report destination added. Website, MX, SPF, forwarding and other sender records were preserved. No credentials are stored in source.

Existing booking and project-brief worker definitions were compared before/after migration and are unchanged.

## Validation

Automated PostgreSQL tests execute the actual migration and cover authorization, private permissions, recipient derivation, queue-only RPCs, duplicate/replay handling, recipient changes, quota windows, provider outcomes, retention and preservation of existing workers. Browser checks stub all outbound mutations and cover explicit confirmation, interrupted retry IDs, mobile layouts, keyboard use, and delivery-state truthfulness.

On October 23, 2026 at 20:03 UTC, the scheduled worker accepted the single owner-controlled test message on its first provider attempt. Gmail placed it in Inbox. Full MIME inspection confirmed From and Reply-To `4u Digital <admin@customtechbuilt4u.com>`, matching HTML/plain-text planner links, SPF pass, aligned DKIM pass for `customtechbuilt4u.com`, and DMARC pass. No real client received a test message. This sample verifies this route; it cannot guarantee Inbox placement for every recipient.

References: [Brevo domain authentication](https://developers.brevo.com/reference/authenticate-domain), [sender verification](https://developers.brevo.com/reference/validate-sender-by-otp), [transactional API](https://developers.brevo.com/reference/send-transac-email).
