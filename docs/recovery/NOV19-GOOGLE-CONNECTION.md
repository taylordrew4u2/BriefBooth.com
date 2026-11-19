# Current booking workspace Google connection

The current owner workspace previously displayed Google configuration but could
not initiate its own consent flow. The legacy connector writes Supabase Vault;
current booking actions read Cloudflare credentials. Recording the legacy flow
therefore did not demonstrate the grant used by current bookings.

This repair adds a verified-owner-session-only reconnect control in Booking
settings. The existing `/studio/?connect=google` intent opens those controls.
Private review keys do not authorize reconnecting. Existing consultant callbacks
and Google workers remain untouched; the owner flow never creates a legacy
Google connection row or calls a legacy Google RPC.

## Connection lifecycle

- The existing callback `/api/google/callback` dispatches only `r1_` states to
  the new handler. Exactly `calendar.events.owned` and `calendar.freebusy` are
  requested, with PKCE S256 and a random browser-bound, single-use state.
- The initial environment grant establishes the existing business Google
  identity through Google's documented tokeninfo endpoint. Subsequent grants
  use that verified, encrypted identity pin, including when repairing a revoked
  refresh token. Missing identity or a different account fails closed; no
  identity scope, new account, marker event or unrelated Calendar data is used.
- The callback verifies the candidate and its refresh, scope set, account,
  free/busy and event-access responses, then stages it. It does not activate it.
- A same-origin request with the current verified owner sign-in and browser
  cookie completes the operation. Atomic generation comparison prevents an
  older attempt from overwriting a newer connection. Repeated completion of
  the same operation reconciles an uncertain response.
- A promoted grant is authoritative for availability and meeting actions.
  Access-token caching is keyed by credential and revision. Disabling the
  reconnect UI never silently restores the old environment credential.

Refresh tokens, state verifiers and identity pins are AES-GCM encrypted before
D1 storage, with owner/purpose-associated data and an HKDF key derived from the
existing server-only capability secret. No new provider or administrative
credential is added. Do not rotate that capability secret without resealing
these records and accounting for existing private booking links. Expired
handshakes are unusable and are removed in bounded batches on new attempts.

## Release order and rollback constraints

1. Inspect current production and retain the existing D1 binding and secrets.
2. Apply `recovery/google-connection-migration.sql` to the existing database.
   The migration is additive and idempotent; it does not seed/copy tokens.
3. Publish the tested build. Enable `RECOVERY_GOOGLE_OAUTH_ENABLED=1` only on
   the existing project. A new grant is not stored until the owner flow runs.
4. Verify the actual owner UI, Google destination, exact permissions, callback
   completion, authoritative revision and real booking behavior before claiming
   a live end-to-end repair or recording corrected review evidence.

Before any promoted credential, the preceding deployment is a valid rollback.
After promotion, rolling back to code that only reads the environment token can
restore a superseded grant. Prefer a forward fix, or disable reconnect while
retaining the authoritative credential reader. Never revoke or overwrite the
working grant simply to make a recording.

## Validation and review limits

Full application tests, lint, TypeScript and production build passed locally.
The new suites exercise owner/origin checks, PKCE, replay/concurrency, staged
completion, wrong-account and scope rejection, encrypted storage, failed
promotion retry, expired-state cleanup, no fallback, revoked-token repair,
and actual availability requests using the new grant after the old access-token
cache was warmed. Frontend tests cover account unmount, failed completion with
a usable retry button, duplicate clicks and strict Google destination checks.
Provider responses in these automated tests are mocked; they do not establish
live Google consent or reviewer approval.

Google's November 19 request also names a different project from the submitted
BriefBooth project. One clarification was sent and provider delivery verified.
The mismatch remains unresolved. This code repair does not withdraw, duplicate,
resubmit or alter the existing verification request. No new evidence recording
has been produced by this change. Existing service capacity remains finite;
no permanently-free/unlimited claim is made.

Official tokeninfo contract: https://www.googleapis.com/discovery/v1/apis/oauth2/v2/rest
