# Accessibility and phone audit — October 19, 2026

## Scope and method

Reviewed the live app with browser accessibility-tree inspection, DOM checks, keyboard interaction and phone viewport emulation at 320 and 390 CSS pixels. Public coverage: home, sign in, sign up, demo intake, 4u Digital intake, booking management, support, privacy, terms and Zoom information. Signed-in coverage: Overview, Bookings, Profile & Zoom, Intake questions, Meeting types and Availability at both widths.

Checked horizontal overflow, main landmarks, document language, input labels, referenced accessible descriptions, small standalone controls, question focus and step changes. Completed the demo intake through consultation selection, date/time selection and confirmation at 320 pixels without creating an appointment. Inspected existing live booking management without modifying it.

## Corrections

- Account form changes focus the new form heading.
- Repeated admin booking actions identify the client; question controls identify the question.
- Available-time loading/count and booking-status changes have polite status announcements.
- Help navigation and booking disclosure/management links have larger touch areas.
- Admin/account fields retain 16-pixel text on phones to avoid focus zoom.
- Custom not-found page supplies a main landmark and working skip-link destination.
- Very narrow booking progress uses stacked rows so labels do not break mid-word.
- Demo completion focuses its confirmation heading.

These complement the prior release's stronger intake contrast, visible keyboard focus, associated field help, progress descriptions, selected-time text indicators and reduced-motion support.

## Verification

Production build, lint, asynchronous action regressions and Pages routing/security checks passed. Public pages and all six admin panels had no document horizontal overflow or missing visible input labels in the sampled phone states. Cloudflare production deployment used the existing project; no new service, plan or billing setting was added. Vercel remains untouched.

## Limits

Browser accessibility-tree and keyboard inspection is not a substitute for listening to VoiceOver/TalkBack on a physical device. Spoken output, mobile screen-reader gestures and physical touch were not verified. This is a focused audit, not a claim of full WCAG conformance or coverage of every error, data combination and third-party authentication screen. Existing live email/Zoom delivery evidence is documented separately; this UI audit did not send new emails or create new meetings.
