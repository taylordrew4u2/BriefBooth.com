import Stripe from "npm:stripe@22.6.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const { data: loadedConfig, error: configError } = await db.rpc("payments_config");
const config = configError ? {} : (loadedConfig || {});
config.secret_key = config.production_key || config.secret_key;
config.webhook_secret = config.production_webhook_secret || config.webhook_secret;
const enabled = config.enabled === "true" && config.live === "true" && /^[sr]k_live_/.test(config.secret_key || "") && !!config.webhook_secret;
const origin = config.origin || "https://briefbooth.com";
const live = config.live === "true";
const stripe = new Stripe(config.secret_key || "missing", { apiVersion: "2026-08-26.dahlia", maxNetworkRetries: 2 });
const allowed = new Set([origin, "https://briefbooth.pages.dev", ...(live ? [] : ["http://localhost:3000"])]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
async function account(owner: string) { return await rpc("payments_account", { p_owner: owner }); }
async function syncAccount(owner: string, id: string) {
  const a = await stripe.v2.core.accounts.retrieve(id, { include: ["configuration.merchant", "defaults"] });
  const ready = a.configuration?.merchant?.capabilities?.card_payments?.status === "active"
    && a.defaults?.responsibilities?.fees_collector === "stripe"
    && a.defaults?.responsibilities?.losses_collector === "stripe" && a.dashboard === "full";
  await rpc("payments_account", { p_owner: owner, p_account: id, p_ready: ready, p_live: live });
  return ready;
}
async function settle(session: Stripe.Checkout.Session, accountId: string, failed = false) {
  if (session.metadata?.app !== "briefbooth" || !uuid.test(session.metadata?.booking_id || "")) return;
  if (session.livemode !== live || session.mode !== "payment" || session.currency !== "usd") throw new Error("Payment environment mismatch.");
  const state = session.payment_status === "paid" ? "paid" : failed ? "failed" : session.status === "expired" ? "expired" : session.status === "complete" ? "processing" : null;
  if (!state) return;
  await rpc("payments_settle", { p_booking: session.metadata!.booking_id, p_account: accountId, p_session: session.id, p_total: session.amount_total, p_live: live, p_state: state, p_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null });
}
async function readSession(id: string, accountId: string) { return await stripe.checkout.sessions.retrieve(id, {}, { stripeAccount: accountId }); }

Deno.serve(async req => {
  const requestOrigin = req.headers.get("origin") || "";
  const headers = { "Access-Control-Allow-Origin": allowed.has(requestOrigin) ? requestOrigin : origin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (Number(req.headers.get("content-length") || 0) > 90000) return json({ error: "Request too large." }, 413);
  try {
    const raw = await req.text();
    if (raw.length > 90000) return json({ error: "Request too large." }, 413);
    if (new URL(req.url).pathname.endsWith("/webhook")) {
      if (!enabled) return json({ error: "Live payments are not activated yet." }, 503);
      let event: Stripe.Event;
      try { event = await stripe.webhooks.constructEventAsync(raw, req.headers.get("stripe-signature") || "", config.webhook_secret, undefined, Stripe.createSubtleCryptoProvider()); }
      catch { return json({ error: "Invalid webhook signature." }, 400); }
      if (event.livemode !== live) return json({ error: "Wrong payment environment." }, 400);
      if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"].includes(event.type)) {
        if (!event.account) throw new Error("Connected account is required.");
        const session = event.data.object as Stripe.Checkout.Session;
        // Retrieve current Stripe state so stale/out-of-order webhook payloads cannot undo payment.
        await settle(await readSession(session.id, event.account), event.account, event.type === "checkout.session.async_payment_failed");
      }
      return json({ received: true });
    }
    if (requestOrigin && !allowed.has(requestOrigin)) return json({ error: "Origin not allowed." }, 403);
    const body = JSON.parse(raw);
    if (body.action !== "status" && !enabled) return json({ error: "Live Stripe setup is awaiting activation. Free bookings remain available." }, 503);
    if (body.action === "reconcile") {
      if (!config.cron_secret || req.headers.get("authorization") !== "Bearer " + config.cron_secret) return json({ error: "Unauthorized." }, 401);
      let checked = 0;
      for (const p of await rpc("payments_pending")) {
        if (p.livemode !== live) continue;
        if (p.session_id) await settle(await readSession(p.session_id, p.account_id), p.account_id);
        else if (new Date(p.expires_at).getTime() + 60000 < Date.now()) {
          // Recover a Stripe success followed by a database/network failure before session attachment.
          const sessions = await stripe.checkout.sessions.list({ limit: 100, created: { gte: Math.floor(new Date(p.created_at).getTime()/1000)-2 } }, { stripeAccount: p.account_id });
          const found = sessions.data.find(s=>s.metadata?.app === "briefbooth" && s.metadata?.booking_id === p.booking_id);
          if (found) {
            await rpc("payments_attach", {p_booking:p.booking_id,p_account:p.account_id,p_session:found.id});
            await settle(found,p.account_id);
          } else if (!sessions.has_more) await rpc("payments_checked",{p_booking:p.booking_id,p_abandon:true});
          // If the bounded list is incomplete, retain the hold for operator review; never risk a double booking.
        }
        await rpc("payments_checked",{p_booking:p.booking_id});
        checked++;
      }
      return json({ checked });
    }
    if (body.action === "checkout") {
      const b = body.booking;
      if (!b || !uuid.test(b.p_service) || !uuid.test(b.p_request)) return json({ error: "Invalid booking request." }, 400);
      const { data: service } = await db.from("services").select("owner_id").eq("id", b.p_service).single();
      if (!live && service?.owner_id !== config.sandbox_owner) throw new Error("Payments are being tested. Please contact your consultant.");
      const a = service && await account(service.owner_id);
      if (!a || a.livemode !== live || !await syncAccount(service.owner_id, a.account_id)) throw new Error("This consultant has not enabled payments yet.");
      const p = await rpc("payments_reserve", { p_service: b.p_service, p_start: b.p_start, p_name: b.p_name, p_email: b.p_email, p_answers: b.p_answers, p_request: b.p_request, p_meeting_mode: b.p_meeting_mode, p_expected_total: body.expected_total, p_live: live });
      let session: Stripe.Checkout.Session;
      if (p.session_id) session = await readSession(p.session_id, p.account_id);
      else {
        session = await stripe.checkout.sessions.create({
          integration_identifier: "briefbooth_consultations_qxvjnrka",
          mode: "payment", customer_email: p.email, client_reference_id: p.booking_id,
          expires_at: Math.floor(new Date(p.expires_at).getTime() / 1000),
          line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: p.total_cents, product_data: { name: p.title, description: `Consultation $${(p.amount_cents/100).toFixed(2)} + included estimated processing $${((p.total_cents-p.amount_cents)/100).toFixed(2)}. Actual Stripe fees may vary.` } } }],
          metadata: { app: "briefbooth", booking_id: p.booking_id },
          payment_intent_data: { metadata: { app: "briefbooth", booking_id: p.booking_id } },
          success_url: `${origin}/manage/${p.manage_token}/?checkout=returned`,
          cancel_url: `${origin}/manage/${p.manage_token}/?checkout=cancelled`,
          custom_text: { submit: { message: `Consultation $${(p.amount_cents/100).toFixed(2)} + included estimated processing $${((p.total_cents-p.amount_cents)/100).toFixed(2)} = $${(p.total_cents/100).toFixed(2)} total. Actual Stripe fees vary. Contact your consultant for refunds.` } },
          // No platform fee, subscription, tax product, or paid add-on.
        }, { stripeAccount: p.account_id, idempotencyKey: `briefbooth-checkout-${p.booking_id}` });
        await rpc("payments_attach", { p_booking: p.booking_id, p_account: p.account_id, p_session: session.id });
      }
      if (!session.url || session.status !== "open") throw new Error("This checkout is no longer open. Use your booking link to check its status.");
      return json({ url: session.url });
    }
    if (body.action === "status") {
      if (!uuid.test(body.token || "")) return json({ error: "Invalid booking link." }, 400);
      const p = await rpc("payments_lookup", { p_token: body.token });
      if (!p) return json({ payment: null });
      if (!enabled || p.livemode !== live) throw new Error("Payment status needs consultant review. Do not pay again.");
      let session = p.session_id ? await readSession(p.session_id, p.account_id) : null;
      if (session) {
        await settle(session, p.account_id);
        if (body.cancel === true && session.status === "open") {
          session = await stripe.checkout.sessions.expire(session.id, {}, { stripeAccount: p.account_id });
          await settle(session, p.account_id);
        }
      }
      const latest = await rpc("payments_lookup", { p_token: body.token });
      return json({ payment: { amount: p.amount_cents, total: p.total_cents, paid: !!latest.paid_at, status: latest.status, url: session?.status === "open" ? session.url : null } });
    }
    const token = req.headers.get("authorization")?.replace(/^Bearer /i, "") || "";
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user) return json({ error: "Sign in first." }, 401);
    if (!live && user.id !== config.sandbox_owner) throw new Error("Payments are being tested. Free consultations remain available.");
    if (!["connect", "account"].includes(body.action)) return json({ error: "Unknown action." }, 400);
    const { data: profile } = await db.from("profiles").select("id,name").eq("id", user.id).single();
    if (!profile) throw new Error("Save your profile first.");
    let a = await account(user.id);
    if (a && a.livemode !== live) a = null;
    if (body.action === "account") return json({ connected: !!a, ready: a ? await syncAccount(user.id, a.account_id) : false, live });
    if (!a) {
      const created = await stripe.v2.core.accounts.create({ contact_email: user.email, display_name: profile.name, dashboard: "full", identity: { country: "us" }, defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } }, configuration: { merchant: { capabilities: { card_payments: { requested: true } } } } }, { idempotencyKey: `briefbooth-account-${user.id}` });
      a = await rpc("payments_account", { p_owner: user.id, p_account: created.id, p_ready: false, p_live: live });
    }
    const link = await stripe.v2.core.accountLinks.create({ account: a.account_id, use_case: { type: "account_onboarding", account_onboarding: { configurations: ["merchant"], refresh_url: `${origin}/studio/?stripe=refresh`, return_url: `${origin}/studio/?stripe=return` } } });
    return json({ url: link.url });
  } catch (error) {
    // Do not log intake, credentials, Stripe payloads, or payment data.
    const safe = error instanceof Error && !('type' in error) ? error.message : "Stripe could not complete this request. Please try again.";
    return json({ error: safe }, 400);
  }
});
