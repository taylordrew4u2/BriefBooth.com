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
