# Client accounts and project checkboxes

Released October 23, 2026 on the existing free Cloudflare, Supabase and Brevo services.

The software-development intake template starts with a native checkbox group: Software, Website, Web application, Mobile application, Automation & integrations, Fixes & improvements, and Other / not sure yet. Any number of options may be chosen. Only the first question is required. Consultants can edit choices and add checkbox questions in the studio. Answers retain their readable text representation in booking snapshots and notifications. Server validation rejects unknown or duplicate choices.

4u Digital now offers one free 30-minute Google Meet consultation. Its previous Zoom service is inactive, preserving existing bookings. The live questionnaire includes project choices and preserves the existing follow-up questions and business-visit information.

Clients can open `/client/` or My bookings. A secure emailed sign-in link creates an optional account for new clients and authenticates existing clients. No password is required. Booking without an account remains available. New client accounts return to the client dashboard; an existing consultant can also access their client bookings. The email sign-in return intent lasts 15 minutes in browser storage.

`client_bookings()` requires an authenticated user whose email is verified in auth.users. It matches only that verified email to booking.client_email, never editable metadata. It returns up to 100 recent bookings with status and the existing private management link. Private notes and other clients' details are not listed. Changes and cancellations continue through existing management controls. Client data/account requests use the published support channel.

Validation: lint/build/full automated suite passed; live checkbox selection and back-navigation retained three selections; live client dashboard loaded; a secure sign-in email reached the inbox and authenticated the existing account. Database tests cover unverified email, cross-client isolation and anonymous denial. No new test appointment or real payment was created.

## Live client workflow follow-up — October 23

A subsequent disposable production test selected Software, Website and Mobile application, submitted a free approval-required request, and signed into an existing test client account using the delivered email link. The new browser tab returned directly to `/client/`, showing only that client's request as Awaiting consultant approval. The separate consultant session displayed all three project choices. Approval changed the client dashboard to Confirmed; its management link displayed the correct date, time, timezone and generated Google Meet join link. Confirmation jobs were queued, but final confirmation inbox delivery was not verified in this test. Client cancellation then changed the dashboard/booking to Cancelled, and the Google worker confirmed the associated event canceled. No real charge or paid service was added. No code fix was needed for this workflow.

## Client answer editing and technical background

Clients now have **Edit my answers** on each booking in `/client/`, at any booking status. New bookings preserve their original questionnaire and structured answers, so later consultant template changes cannot reinterpret earlier answers. Older bookings expose their existing full intake text without attempting a lossy reconstruction. Saves update the consultant's existing Client intake view. Previously sent emails and calendar descriptions are not rewritten. Verified-email ownership is enforced server-side, with revision checks to reject stale writes, required-answer and checkbox validation, and no changes to scheduling or approval state.

The developer template and 4u Digital's live questionnaire include an optional technical-background question covering complete beginners, basic familiarity, no-code/developer collaboration, coding experience, and experienced developers. Multiple descriptions may apply.

Validated the editing migration with authenticated ownership/anonymous denial, required values, invalid checkbox choices, legacy edits, persistence, and stale-write tests. Lint, build and production Pages checks passed. Live browser verification saved and reopened an update on the disposable canceled appointment, then confirmed that update in consultant admin. The experience question was also verified on the production booking page. Existing free hosting and services remain unchanged.
