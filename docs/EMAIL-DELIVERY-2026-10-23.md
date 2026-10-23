# Booking request email delivery

## Observed issue

The earlier 4u Digital mobile-test request receipt reached Spam after forwarding through the business mailbox; its approved confirmation reached Inbox. SPF, DKIM, DMARC and ARC passed. The receipt was HTML-only and repeated the full intake questionnaire, including unanswered optional questions. One sample does not establish the cause of a spam verdict.

## Change

- Preserve the existing authenticated sender, Brevo Free account and DNS authentication.
- Supply matching `textContent` and `htmlContent` using Brevo's supported transactional API fields.
- Give pending clients a concise status, requested appointment details, meeting format and private request button; retain full intake for the consultant.
- Escape submitted text and build action links from trusted booking records.
- Route replies to the existing public BriefBooth support address, `admin@customtechbuilt4u.com`.
- Replace only the worker payload assignment, preserving the independent queue cleanup, revision checks, advisory lock, one-message batch, 240/day booking budget and safe retry rules.
- No paid upgrades, new providers, tracking workarounds, DNS weakening or Gmail filtering changes.

## Validation

The full automated suite passed. Focused PostgreSQL tests covered both message alternatives, pending/confirmed status, all nine notification types, hostile input, private helper permissions, immutable snapshots, exact worker preservation, duplicate protection, rate limits, ambiguous timeouts and the free daily cap. The same focused tests passed against a copy of the actual live worker with the concurrent queue cleanup applied.

The production function was checked before and after application: only the payload statement changed. The helper remains inaccessible to anonymous and authenticated API roles. Security advisory findings were unchanged.

## Live result

On October 23, 2026, four labeled test notifications were sent by the existing scheduled worker, one per minute, without bypassing the free-plan limits:

| UTC time | Test route | Observed Gmail folder |
| --- | --- | --- |
| 17:20 | Client receipt forwarded from admin@customtechbuilt4u.com through ImprovMX | Inbox |
| 17:21 | Consultant request notification to an owned Gmail alias | Inbox |
| 17:22 | Client receipt directly to an owned Gmail alias | Inbox |
| 17:23 | Second consultant request notification to an owned Gmail alias | Inbox |

The forwarded and direct client receipts, plus the first consultant notification, were inspected as full MIME messages. Each contained `multipart/alternative` with `text/plain` and `text/html`; SPF, DKIM and DMARC passed. The reply address was the public support email. Client receipts omitted the questionnaire dump and correctly stated that approval was pending; the consultant retained the submitted intake.

The disposable consultant account, both pending test bookings, intake and associated outbox records were removed after delivery. No real consultation, Zoom meeting, Google event, client message or Gmail filter was modified. Test emails remain in the owner's mailbox as evidence.

These samples show successful Inbox delivery through both routes after the update. They do not prove the earlier spam verdict's cause or guarantee future inbox placement across providers.

## References

- [Brevo transactional email API](https://developers.brevo.com/reference/send-transac-email)
- [Gmail email sender guidelines](https://support.google.com/mail/answer/81126?hl=en)
- [Brevo list-unsubscribe policy](https://help.brevo.com/hc/en-us/articles/19100260472850-FAQs-About-list-unsubscribe-and-list-help-headers-in-emails)

Brevo's automatically inserted tracking or list-unsubscribe headers are not proven causes of the observed Spam placement. Unsupported tracking headers were not added, and an Enterprise-only header change was not used.
