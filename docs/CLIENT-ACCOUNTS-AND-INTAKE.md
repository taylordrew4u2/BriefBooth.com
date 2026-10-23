# Client accounts and project checkboxes

Released October 23, 2026 on the existing free Cloudflare, Supabase and Brevo services.

The software-development intake template starts with a native checkbox group: Software, Website, Web application, Mobile application, Automation & integrations, Fixes & improvements, and Other / not sure yet. Any number of options may be chosen. Only the first question is required. Consultants can edit choices and add checkbox questions in the studio. Answers retain their readable text representation in booking snapshots and notifications. Server validation rejects unknown or duplicate choices.

4u Digital now offers one free 30-minute Google Meet consultation. Its previous Zoom service is inactive, preserving existing bookings. The live questionnaire includes project choices and preserves the existing follow-up questions and business-visit information.

Clients can open `/client/` or My bookings. A secure emailed sign-in link creates an optional account for new clients and authenticates existing clients. No password is required. Booking without an account remains available. New client accounts return to the client dashboard; an existing consultant can also access their client bookings. The email sign-in return intent lasts 15 minutes in browser storage.

`client_bookings()` requires an authenticated user whose email is verified in auth.users. It matches only that verified email to booking.client_email, never editable metadata. It returns up to 100 recent bookings with status and the existing private management link. Private notes and other clients' details are not listed. Changes and cancellations continue through existing management controls. Client data/account requests use the published support channel.

Validation: lint/build/full automated suite passed; live checkbox selection and back-navigation retained three selections; live client dashboard loaded; a secure sign-in email reached the inbox and authenticated the existing account. Database tests cover unverified email, cross-client isolation and anonymous denial. No new test appointment or real payment was created.
