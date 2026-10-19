import { db } from "./supabase";
export async function paymentAction(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await db().functions.invoke("payments", { body: { action, ...payload } });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || "Payments are unavailable right now. Please try again later.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function stripeRedirect(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid Stripe response.");
  const url = new URL(value);
  if (url.protocol !== "https:" || !["checkout.stripe.com", "connect.stripe.com"].includes(url.hostname) || url.username || url.password) throw new Error("Invalid Stripe link.");
  window.location.assign(url.href);
}
