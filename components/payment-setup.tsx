"use client";
import { useEffect, useRef, useState } from "react";
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js/pure";
import { ConnectComponentsProvider, ConnectAccountOnboarding, ConnectAccountManagement, ConnectNotificationBanner } from "@stripe/react-connect-js";
import { paymentAction } from "@/lib/payments";
import { Button } from "@/components/ui/button";

export function PaymentSetup() {
  const [instance, setInstance] = useState<StripeConnectInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Set up once, then accept payments for your consultations.");
  const active = useRef<StripeConnectInstance | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void active.current?.logout(); active.current = null; };
  }, []);
  async function check() {
    const result = await paymentAction("account");
    if (!mounted.current) return;
    const complete = result.ready === true && result.live === true;
    setReady(complete);
    setStatus(complete ? "Ready to accept payments." : "Finish the details below to accept payments. Free bookings remain available.");
  }
  async function start() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const configuration = await paymentAction("embedded-config");
      const connection = loadConnectAndInitialize({
        publishableKey: configuration.publishable_key,
        fetchClientSecret: async () => {
          try {
            const session = await paymentAction("embedded-session");
            return session.client_secret;
          } catch (e) {
            if (mounted.current) setError(e instanceof Error ? e.message : "Payment setup could not load.");
            throw e;
          }
        },
        appearance: { variables: { colorPrimary: "#137FEC", colorText: "#333333", borderRadius: "12px" } },
      });
      if (!mounted.current) { void connection.logout(); return; }
      active.current = connection; setInstance(connection);
      await check();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Payment setup could not load.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await check(); }
    catch { if (mounted.current) setError("We couldn’t check your payment status. Please try again."); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function loadError() { setError("The secure payment form could not load. Please reload this page and try again. Your free bookings are still available."); }
  return <section className="inset-form" aria-labelledby="payment-setup-heading">
    <h3 id="payment-setup-heading">Get paid for your expertise</h3>
    <p role="status">{status}</p>
    <p>Add your business and payout details here. Stripe securely verifies your information and sends payments to your bank. Some steps may ask you to sign in to Stripe.</p>
    <p>No BriefBooth subscription or commission. Stripe deducts processing fees from your payments. US consultants and USD payments are supported.</p>
    {error && <p role="alert">{error}</p>}
    <div className="form-row">
      {!instance && <Button disabled={busy} onClick={start}>{busy ? "Opening secure setup…" : "Set up payments"}</Button>}
      <Button variant="outline" disabled={busy} onClick={refresh}>Check payment status</Button>
    </div>
    {instance && <ConnectComponentsProvider connectInstance={instance}>
      <ConnectNotificationBanner onLoadError={loadError} />
      {ready ? <ConnectAccountManagement onLoadError={loadError} /> : <ConnectAccountOnboarding collectionOptions={{fields:"currently_due"}} onExit={() => { void refresh(); }} onLoadError={loadError} />}
    </ConnectComponentsProvider>}
    <p>For bookings that need approval, clients pay before your review. If you decline or cancel, arrange their refund in Stripe.</p>
    <a className="text-link" href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer">Manage refunds and payment history ↗</a>
  </section>;
}
