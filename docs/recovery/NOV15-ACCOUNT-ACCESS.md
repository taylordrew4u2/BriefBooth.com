# Account access restored alongside 4u Digital bookings

Prepared November 15, 2026. This note describes the local candidate; publication and live verification are separate steps.

## Cause and source

Supabase Auth now responds successfully, but the recovery build still compiled account and consultant routes to outage-only views and omitted the existing public Supabase client configuration. That prevented the already-existing reviewer accounts from reaching sign-in and their own Google connection.

The exact source for production deployment `a8bca9d1-6c7a-4276-bb8b-0e1ab9a30679` was located in `/Users/taylordrew/Documents/Codex/BriefBooth-dead-code`, commit `4920ffc6a0347b62ad3571df0733ba6d55c97e26`. Its preserved account and Studio HTML artifacts match the immutable deployment byte-for-byte. The candidate is based on that commit in branch `fix/reviewer-access-nov15`, not the older November 10 checkout.

## Behavior

- `/account/sign-in/` exposes existing password login and existing account controls. The default `/account/` page retains private 4u Digital booking-link guidance and links to account access.
- Consultants enter `/studio/?workspace=consultant`; Google and Zoom callback parameters select the same authenticated workspace. Existing `/studio/` notification links also open the consultant workspace when a verified non-owner account is already signed in.
- Default unauthenticated Studio and the existing 4u Digital owner remain on the private recovery controls. The exact recovery owner identity is redirected before legacy profile or connection controls load. `/booking-review/` remains the independent owner page.
- Auth identity changes immediately clear the selected account workspace. Late responses after switching accounts, signing out, or unmounting are ignored.
- `/client/?workspace=account` exposes existing client account records. Current 4u Digital recovery bookings still use private booking links and are not falsely represented as part of that account history.
- Only `/book/4u-digital/` uses the D1 recovery path. Other consultant booking slugs use their existing Supabase data and authorization.
- Owner review can filter already-loaded requests by name, email, or booking ID. Pagination remains explicit; filtering makes no additional requests and does not expand access.
- Privacy wording now distinguishes the operational consultant account integration from the separate 4u Digital recovery service.

Existing email callbacks remain `/account/` and `/account?mode=password`. No Auth redirect allowlist, Google scope, OAuth callback, provider, plan, database binding, server credential, or managed Auth record changes are required.

## Validation and artifact

Full tests passed, including account-role and tenant isolation, recovery write guard, callback routing, failed role lookups, client intent, owner identity gating, sign-out/account-switch races, and request filtering. Targeted lint and the recovery-enabled TypeScript/static build passed. Local Pages checks passed for new and existing account routes, both provider callbacks, consultant booking deep links, assets, no-cache/no-index private routes, and genuine 404s.

Build with `NEXT_PUBLIC_BOOKING_RECOVERY=1 npm run build` and the existing public Supabase URL/publishable key. Those two public build values are held in the ignored `.env.local`; no server secret or service-role JWT is in the browser artifact.

The generated `_worker.js`, `_routes.json`, and `_redirects` remain byte-identical to the preserved current production artifact. `_worker.js` SHA256 is `ae04051f801d851043fee842d4623c71cf7597be4c81bb0d4b443ef26f79a250`. The exact existing `RECOVERY_DB` binding remains in `wrangler.jsonc`. Both existing review MP4s are preserved, including the untracked private-review asset; do not omit them from publication.

The candidate does not remove provider capacity limits or establish OAuth approval. Google's requested new uninterrupted video is still separate required evidence.
