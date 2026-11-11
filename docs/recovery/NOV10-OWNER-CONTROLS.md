# Owner booking controls

This release keeps the existing single-business recovery, free consultation, Google Meet connection, and approval-before-confirmation workflow. It does not restore the quota-blocked legacy account system or introduce a new provider, credential, paid plan, or Google scope.

## Changes

- The Studio route opens the existing private-key booking review. Account/client routes explain the working private booking-link flow instead of presenting blocked sign-in forms.
- Owners can cancel confirmed bookings and change an agreed appointment time. A time change updates the same Google Calendar event and retains the Meet URL.
- A durable reschedule operation reserves both times until the Calendar result is known. Atomic database checks prevent competing requests from taking the target. Conditional Google writes use the saved event ETag, following https://developers.google.com/workspace/calendar/api/guides/version-resources.
- Retries reconcile an already-applied write; they do not issue a new move to a time that has passed. A cancellation deletes the owned event before releasing the reservation.
- Confirmation mail is revisioned. Queued obsolete revisions are suppressed; external provider delivery ordering cannot be guaranteed.
- The latest website-first, two-question intake copy is preserved.

## Deployment

Apply `recovery/reschedule-migration.sql` to the existing recovery database before publishing the worker. It adds two revision columns and an operation journal; it does not delete or rewrite booking records. Verify the current production deployment and binding before any change. Build with `NEXT_PUBLIC_BOOKING_RECOVERY=1` and retain the existing review assets, secrets, and Google/Zoom callback routes.

## Rollback

Do not roll back to a worker that ignores active reschedule reservations. First reconcile or cancel every active reserved/applying operation and verify that no active journal row remains. Keep the additive columns and journal records. Do not delete bookings or disable the existing legacy write guard.

## Verification

Local tests exercise owner authorization, same-event updates, preserved Meet URLs, competing reservations, ambiguous Google results, local commit failure, cancellation races, time-boundary retries, and stale queued mail. Local tests are not live provider evidence. Record deployment and live create/update/delete results separately after publication.
