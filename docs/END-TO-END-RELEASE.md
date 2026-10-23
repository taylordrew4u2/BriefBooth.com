# End-to-end release — October 22, 2026

Released to https://briefbooth.com on the existing Cloudflare Pages project. Supabase migrations through `20261022125000` are applied; Google worker and calendar subscription worker are deployed. No paid plans, real payment charges, platform fees, or Vercel deployments were added.

## Delivered

- Editable consultation types; historical booking title and duration preserved.
- Notice period, booking horizon, buffers, days off and date-specific hours.
- Client rescheduling retains the same booking/intake/payment record, releases the old slot and requires approval of the new time. Google events update after approval.
- Reminder queue and cancellation notifications for both recipients; 240/day booking-email budget with existing free provider limits, one send per minute, duplicate/revision guards. Reminders require an accepted confirmation older than one hour and a confirmed meeting 1–24 hours away.
- Owner-only meeting/email status, known-failure retry, manual refund review and Zoom cleanup guidance. Unknown delivery outcomes are deliberately not retried blindly.
- Completed/no-show outcomes, private notes and email follow-up alongside searchable bookings.
- Private data export; guarded self-service account deletion. Upcoming appointments and paid records require resolution/support review. External provider accounts and already-sent emails are not deleted.
- Aggregate 30-day intake funnel, no client answers/emails/IP in event records, Do Not Track respected.
- Revocable private calendar subscriptions for Apple/Outlook. These are one-way feeds of appointment title/time/status, not busy-time imports; refresh timing belongs to the subscribing calendar.
- Public copy and privacy disclosures updated to reflect actual features.

## Verification

- Lint, production build and full automated suite passed. Additional lifecycle tests passed for reminder deduplication/cancellation, schedule overrides/horizon, ownership isolation, exports, deletion guards, feed rotation, rescheduling/replay and revision handling.
- Production deep-link, asset, security-header, no-cache/no-index and true-404 checks passed. Studio asset references match the final local release. Unknown calendar token returns 404 with no-store.
- Live disposable free booking: created pending approval with no meeting link; rescheduled; approved using the owner-authorized backend RPC; Google Meet created. Both client and consultant confirmations arrived in Gmail with matching link, date and intake.
- Confirmed appointment rescheduled again: returned to approval, then Google event updated and both new confirmations arrived for the new date.
- QA appointment cancelled; Google worker confirmed cancelled with no error. No real consultation left booked.
- Demo intake through confirmation completed at 390×844 phone emulation with no horizontal overflow and correct step-heading focus. This is browser emulation, not a physical-device or VoiceOver certification.
- Security advisor reports only intentional private-table deny-all RLS, security-definer entry points and existing unavailable leaked-password protection. No upgrades enabled. Owner checks and anonymous denial are covered by tests. Guidance: https://supabase.com/docs/guides/database/database-linter and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Remaining work / external dependencies

- Signed-in admin verification completed after the user signed in: booking-link copy, activity report, private export download, saving existing booking rules, consultation edit/save, and approval through the admin button all passed. The new free test created a Google Meet; client and consultant confirmations arrived in Gmail at 18:42 and 18:43 UTC. Cancellation through the client UI succeeded afterward. Admin Overview and Bookings fit a 390-pixel phone viewport. Fresh signup was not retested in this release.
- Google branding is verified and published. Calendar scope verification is not submitted/completed: portal requires a genuine YouTube authorization/scope-usage video before saving the prepared justification. No invented video or approval claim.
- Zoom public review remains external. Current grant lacks meeting deletion, so old Zoom meetings require manual removal; the UI exposes the cleanup link. No scope expansion or review withdrawal performed.
- Stripe merchant onboarding and actual checkout/refund verification remain incomplete. Local payment-state tests pass; no real charge was attempted. Refund action leads to Stripe, not automatic refunds.
- Apple/Outlook busy-time reading and full two-way synchronization are not implemented; subscriptions provide one-way confirmed-booking updates.
- Searchable booking history with notes/outcomes is available; a separate grouped CRM/client-detail view is not added.
- Account deletion with paid records deliberately requires support review. Existing signup email quota is shared with the provider's free allowance; the booking-mail cap cannot guarantee unlimited free sending.

## Reproduction

Run `npm run lint`, `npm test`, `npm run build`, then `PAGES_TEST_URL=https://briefbooth.com npm run test:pages`.

Deploy `out/` to the existing Cloudflare Pages production project. The calendar Edge Function includes `index.ts`, `format.mjs`, and `deno.json`; its own unguessable subscription token is the access control. Never commit live QA management tokens, provider credentials, or user email bodies.
