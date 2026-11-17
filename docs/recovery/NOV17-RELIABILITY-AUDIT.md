# Reliability corrections — November 17, 2026

Baseline production was independently checked as `ff98bad1-53c5-42ba-90aa-a6cf29bcae21`, source `c290b775023ed0edbc137abe211185d7b2a6a574`. This work follows the unified account/booking repair, without replacing its architecture.

## Reproduced failures and corrections

- A Google availability lookup could cross the selected time or required-notice boundary before a booking was inserted. The booking flow now revalidates the schedule after awaited availability/capability work and before reservation.
- Google could create an event while its approval response was lost. A later retry after the appointment start previously failed before looking up that event. An already-started uncertain approval can now reconcile the same verified event; it never dispatches a new creation after the start.
- Cancellation could enter its in-progress state before the appointment started, then encounter a provider failure. A retry after the start was rejected. Already-started cancellation now remains retryable, including through signed-in client history. Fresh past-start cancellations retain their existing restriction. Uncertain provider absence never releases a reservation on guesswork.
- The public controlled date input sent partial native date values such as year0002 to the availability endpoint. Native partial segments are now preserved without requesting slots; complete valid dates within the published bounds load availability, while invalidated selection and stale responses are cleared.
- Signup confirmation and optional Google sign-in callbacks kept Zoom connection intent but dropped Google intent. A shared allowlisted callback path now preserves both intents and rejects arbitrary redirect parameters.

## Notification finding

One legitimate client request notice from the prior structural test appeared in business Gmail Spam. Gmail stated similarity to previously classified spam. The original message summary independently showed SPF PASS, DKIM PASS for customtechbuilt4u.com, and DMARC PASS. The exact notice was marked Not spam; Gmail confirmed it moved to Inbox. No sender DNS, provider, account, global filter, secret or SMTP configuration was changed. This is one mailbox's classification outcome, not a guarantee for other recipients. No extra notification was sent.

## Google review

The authenticated detailed review still showed four completed checks and the same Google-data privacy disclosure issue dated November1. The live privacy page contains both scope names, the Google-data section, and Limited Use disclosure. No new reviewer request or paused label was observed. The completed evidence reply was delivered November16; no duplicate reply or submission was made. Google review is not approved.

## Validation and publication

The full test suite, ESLint, TypeScript, production export, local Pages route/asset/header checks and independent review passed. Native production date entry and release verification remain pending publication. No real bookings or calendar events are needed to reproduce the failure cases: the new boundary tests use isolated in-memory data and fully mocked external providers.
