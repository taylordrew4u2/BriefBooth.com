# Payment preferences — Stripe on hold

As of October 18, 2026, BriefBooth collects no payments. All consultations are free to book. Clients see “Negotiate with consultant” and arrange any consultation fee directly with their consultant.

Consultants can save public payment preferences in Studio → Consultations: Cash App, Venmo, PayPal, Zelle, bank transfer, cash, or another method described in optional instructions. BriefBooth neither processes nor verifies these external payments. Preferences do not block booking, confirmations, or cancellation.

Apply `20261018200000_free_booking_preferences.sql` after the existing migrations. It adds bounded public preferences, resets service prices to zero, prevents nonzero prices, and revokes the payment edge function’s access to payment-only RPCs. The production payment reconciliation job is unscheduled. Booking confirmation emails retain their separate worker and schedule.

The previous Stripe implementation remains dormant for future work. No live server key was activated and no real payment was processed. Re-enabling it requires a new explicit request, a migration to restore the appropriate RPC grants and paid service prices, correctly configured live credentials/webhooks, and verification of the complete flow. Do not run the old activation steps or reconciliation script while Stripe is paused.

Cloudflare, Supabase, and Brevo keep their existing free configuration and quotas. No paid service, subscription, or automatic paid fallback was added.
