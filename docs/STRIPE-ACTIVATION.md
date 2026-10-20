# Optional Stripe payments — October 19, 2026

## Implemented

- Clean Portal Studio is the approved platform account; consultants connect their own US Stripe merchant accounts.
- Direct charges, full Stripe dashboards, Stripe collecting fees and bearing negative-balance responsibility. No BriefBooth commission or subscription is added.
- Consultation amounts remain $0 until a consultant explicitly adds a paid service. Publishing paid services requires an active live connected account and the server activation flag.
- Checkout displays the consultation amount, included estimated processing, and total. The estimate uses standard US domestic card pricing, 2.9% + $0.30; other methods/cards and custom pricing can differ. Sources: https://stripe.com/pricing and https://stripe.com/connect/pricing.
- Hosted Checkout handles card data. Signed webhook verification and server-side session retrieval drive settlement; browser return is not proof of payment.
- Request IDs, amount/account/environment validation, slot holds and idempotent settlement prevent duplicate fulfillment.
- Approval-required paid bookings collect payment before review. Approval mode is snapshotted when the booking is made. Payment transitions to pending approval; only consultant approval triggers Zoom/confirmation. UI explains this before checkout.
- Refunds are managed by the consultant in Stripe. Cancelling or declining does not automatically refund. Both client and admin surfaces state this.

## Activation requirements

Connect final details were submitted in the Stripe dashboard; review was in progress. Live connected-account creation was disabled during that review.

The existing live webhook is `we_1UREhiLON2mfUoQ25QroEs0p`, for `/functions/v1/payments/webhook`, with the four Checkout completion/success/failure/expiry events. It was disabled when Stripe was paused. Preserve unrelated endpoints.

Prepared a restricted key form named `BriefBooth live payments`; creation and secure entry require user handoff. Store it in Vault as `briefbooth_stripe_production_key`. Keep old sandbox entries intact. Store the matching live endpoint signing secret as `briefbooth_stripe_production_webhook_secret`.

Before activating: verify Stripe review approval, restricted-key access to Accounts v2 merchant creation/retrieval and account links, and connected Checkout creation/read/expiry. Enable the existing webhook and validate signed delivery. Set `briefbooth_stripe_live=true` and `briefbooth_stripe_enabled=true` only after the credentials and endpoint are ready, then redeploy the function (configuration is loaded at cold start). Restore the existing reconciliation cron from `supabase/payment-reconciliation.sql`, checking for an existing job first. Complete consultant onboarding and verify merchant card-payments capability before offering a paid service.

Do not report live payments as working until activation and provider verification finish. No real charge was made in this session. Do not invent a successful payment test.

## Validation

Production build, lint, full existing regression suite and new local payment/approval tests pass. New checks cover approval snapshot across profile changes, no Zoom before approval, exactly one Zoom job after payment replay, sandbox-to-live account mapping, publishing gate, checkout duplicate-click guard, expected totals, stable retry IDs and Stripe-only redirect URLs. All test payment records are local fixtures, not live Stripe transactions.

Cloudflare and Supabase remain on the existing free setup; Vercel and unrelated projects are unchanged. Stripe transaction fees are the user-approved exception.

## End-of-session evidence

The app interface and guarded payment server are deployed. The user authorized storing the existing live webhook secret, and `briefbooth_stripe_production_webhook_secret` is now present in encrypted Vault (format checked without printing it). The live API key is still awaiting the user credential handoff; the prepared Stripe form is at `/apikeys/create`, and the separate Vault form is named `briefbooth_stripe_production_key`. Do not toggle activation before it is saved and verified.

Live admin previews displayed $5 + $0.46 = $5.46 and $500 + $15.24 = $515.24. The example form was closed without saving; the existing 4u Digital consultation remains $0. Live Pages route/security checks passed. The webhook endpoint remains disabled until the credential/configuration prerequisites are complete.

## October 20 activation update

Stripe's review banner cleared, final details show Complete, and live connected-account creation is available. The full restricted production key is saved in encrypted Vault and authenticated successfully against both v1 and v2 account-list endpoints (HTTP 200). The matching production webhook secret is stored.

Enabled only BriefBooth endpoint `we_1UREhiLON2mfUoQ25QroEs0p`, set live/enabled flags, and redeployed payments v6. Restored the single five-minute reconciliation job. An authenticated reconciliation call returned HTTP 200 with zero pending records. A signed, non-payment diagnostic event returned HTTP 200; unsigned input returned HTTP 400. This verifies signature handling, not a real Stripe payment or provider-originated delivery.

Consultants must finish their own live Stripe onboarding before paid services can be published. No live connected merchant currently exists; merchant readiness, live Checkout creation, and a real payment remain unverified until onboarding is completed. No real charge was made and existing consultation prices were not changed. The fee-breakdown interface was already deployed and is unchanged. Other hosting/services remain on their existing free setup and Vercel remains paused.
