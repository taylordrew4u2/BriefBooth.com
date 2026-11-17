# Account and booking structure repair — November 17, 2026

## Problem

The existing 4u Digital recovery accepted bookings in D1 while normal accounts read the legacy Supabase booking table. Signing in as the owner redirected to a second private-key gate. Legacy Studio settings changed a different data source from the live booking page. Restoring Auth alone did not connect these workflows.

## Intended behavior

- The existing verified owner account opens current requests and booking settings in Studio. The private owner key remains a fallback; no new identity or credential is created.
- The Worker verifies each account session with the existing Supabase Auth project. Only the configured owner ID can administer 4u Digital. Client access is restricted to the verified account email, never an email supplied by the request.
- Client history combines current D1 appointments with earlier account records. Each record retains its original management path. Guest private booking links remain valid.
- A revisioned D1 configuration becomes authoritative for the existing public profile, free Google Meet consultation, weekly hours and scheduling preferences. It is seeded once from the existing production configuration. Saving settings never changes the owner ID, existing appointments, Google credentials, paid-plan settings or legacy write guard.
- Stale settings saves are rejected. New booking submissions must match the configuration the client saw, and booking/reschedule writes also check the current revision atomically. Existing request retries remain idempotent. Rescheduling preserves the appointment's stored duration even if the service length changes.
- Signing out or switching accounts clears private UI state and cancels stale responses.

## Release boundaries

Baseline: production `be956f02-cf1f-42d8-baf0-84f35cb143ee`, source `5b354e11657ad486087e20503370479be063d1c9`, freshly checked before editing. The live D1 aggregate contained ten cancelled recovery bookings, no active bookings and no imported Supabase records.

Apply only the additive `recovery/account-settings-migration.sql` to the existing D1 database before publishing the Worker. It adds configuration storage without altering bookings or Auth. Keep `RECOVERY_DB` bound to `1ea17d0a-a9c3-43d7-8b4c-aa1e9901514d` and retain existing encrypted secrets. Build using the existing public Supabase URL and publishable key; the export step loads the same environment as Next and inlines only those two public values.

Preserve both existing MP4 assets, callback routes and private-route headers. The separately hosted complete Google review recording is unaffected. This repair adds no provider, plan, trial, payment, scope or support request, and does not claim unlimited hosting or Google approval.

## Pre-publication validation

The full test suite passes, including the new account/settings and workspace suites, existing booking/reschedule/provider/legacy-guard suites, and confirmed-email/tenant isolation. ESLint, TypeScript, static export, local Pages deep-link/assets/security-header checks and diff checks pass. Independent read-only review found the stale-client-duration gap; it was corrected and retested before release. Provider behavior in the automated tests is mocked; production verification is separate.

The build reported two existing Next.js cache advisories. Next and its matching ESLint configuration were patched from 16.4.1 to 16.4.5, the minimal same-minor security release; React stays 19.3.0. The successful final build has no corresponding framework security interruption. These cache features are not used by this static-export/custom-Worker deployment. Separate lint/CLI dependency audit findings remain outside the runtime repair; this is not a zero-vulnerability claim.

- https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h
- https://github.com/vercel/next.js/security/advisories/GHSA-vc7v-qv4w-wrv8

Both existing MP4 files match their prior SHA256 values. The Worker contains the configured public Auth project and no unresolved browser build-variable references. No server credentials were moved or printed.

Publication and live verification results will be appended separately.
