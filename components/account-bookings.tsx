"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Logo } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccountSession } from "@/components/use-account-session";
import { recoveryApi } from "@/lib/recovery-api";
import { db, configured } from "@/lib/supabase";
import { IntakeEditor } from "@/app/client/intake-editor";

type Booking = { id: string; title: string; consultant?: string; consultant_name?: string; starts_at: string; ends_at?: string; status: string; manage_token?: string; meeting_url?: string | null; notes?: string; reschedule?: { starts_at: string } | null; source: "recovery" | "supabase" };
type Page = { bookings: Booking[]; next_cursor: string | null };
const labels: Record<string, string> = { pending_approval: "Awaiting approval", confirming: "Preparing Google Meet", confirmed: "Confirmed", cancelling: "Cancellation in progress", cancelled: "Cancelled", declined: "Declined", expired: "Expired", pending_payment: "Payment pending", payment_processing: "Payment processing" };
function date(value: string) { return new Date(value).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }); }

export function AccountBookings() {
  const session = useAccountSession();
  return <><header className="simple-header"><Logo /><Link href="/studio/">Studio</Link></header><main id="main" className="mx-auto max-w-4xl space-y-6 px-5 py-10"><h1 className="text-3xl font-semibold">Your consultations</h1>
    {!session.checked ? <p role="status">Checking your account…</p> : session.userId ? <ClientBookings key={session.userId + ":" + session.accessToken} token={session.accessToken} email={session.email} /> : <ClientSignIn key="signed-out" />}
  </main></>;
}
function ClientSignIn() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !configured) return;
    setBusy(true); setMessage("");
    try {
      localStorage.setItem("briefbooth_client_login", String(Date.now()));
      const { error } = await db().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin + "/account/", data: { account_type: "client" } } });
      if (error) throw error;
      if (mounted.current) setMessage("Check your email for your secure sign-in link. Use the same email you used to book.");
    } catch { if (mounted.current) setMessage("Could not send the sign-in link. Please wait a moment and try again."); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="space-y-5 rounded-2xl border p-6"><h2 className="text-xl font-semibold">Sign in to view your bookings</h2><p>Use the email address from your booking to see current 4u Digital requests and your earlier account bookings.</p><p><Link className="underline" href="/account/sign-in/">Sign in with your existing password</Link></p><form onSubmit={login} className="space-y-4"><label className="block space-y-2"><span>Booking email address</span><Input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><Button type="submit" disabled={busy || !configured}>{busy ? "Sending…" : "Email me a sign-in link"}</Button></form>{message && <p role="status">{message}</p>}<p className="text-sm">You can also open the private link saved after your request or sent by email. New client accounts are created under our <Link className="underline" href="/terms/">terms</Link> and <Link className="underline" href="/privacy/">privacy notice</Link>.</p></section>;
}
function ClientBookings({ token, email }: { token: string; email: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const action = useRef<AbortController | null>(null);
  const lock = useRef(false);
  useEffect(() => () => action.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => { if (!controller.signal.aborted) { setLoading(true); setError(""); setConfirm(null); setNow(Date.now()); } });
    Promise.allSettled([
      recoveryApi<Page>("client-bookings", { token, signal: controller.signal }),
      Promise.resolve(db().rpc("client_bookings").abortSignal(controller.signal)).then(result => { if (result.error) throw result.error; return result.data as Omit<Booking, "source">[]; }),
    ]).then(([current, earlier]) => {
      if (controller.signal.aborted) return;
      const values: Booking[] = [];
      if (current.status === "fulfilled") { values.push(...current.value.bookings.map(booking => ({ ...booking, source: "recovery" as const }))); setNextCursor(current.value.next_cursor); } else setNextCursor(null);
      if (earlier.status === "fulfilled") values.push(...earlier.value.map(booking => ({ ...booking, source: "supabase" as const })));
      setBookings(values); setLoading(false);
      const errors = [current.status === "rejected" ? "Current 4u Digital bookings could not be loaded." : "", earlier.status === "rejected" ? "Earlier account bookings could not be loaded." : ""].filter(Boolean);
      setError(errors.join(" "));
    });
    return () => controller.abort();
  }, [token, refresh]);
  async function loadMore() {
    if (!nextCursor || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const controller = new AbortController(); action.current = controller;
    try {
      const page = await recoveryApi<Page>("client-bookings?cursor=" + encodeURIComponent(nextCursor), { token, signal: controller.signal });
      if (controller.signal.aborted) return;
      setBookings(current => [...new Map([...current, ...page.bookings.map(booking => ({ ...booking, source: "recovery" as const }))].map(booking => [booking.source + ":" + booking.id, booking])).values()]);
      setNextCursor(page.next_cursor);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load more bookings."); }
    finally { lock.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function cancel(bookingId: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(); action.current = controller;
    try {
      const result = await recoveryApi<{ booking: Booking }>("cancel", { token, body: { bookingId }, signal: controller.signal });
      if (controller.signal.aborted) return;
      setBookings(current => current.map(booking => booking.source === "recovery" && booking.id === bookingId ? { ...booking, ...result.booking, source: "recovery" } : booking));
      setConfirm(null); setNotice(result.booking.status === "cancelled" ? "Your booking is cancelled." : "Cancellation is being checked. Refresh your bookings shortly to see its status.");
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not cancel this booking. Refresh to check its current status."); }
    finally { lock.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  const sorted = [...bookings].sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return <><div className="flex flex-wrap items-center gap-4"><span>{email}</span><Button variant="outline" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}>Refresh bookings</Button><Link className="underline" href="/logout/">Sign out</Link></div><p>Bookings are shown in your device’s time zone. Only bookings linked to your verified account email appear here.</p>{error && <p role="alert" className="rounded-xl border p-4">{error} Use Refresh bookings to try again.</p>}{notice && <p role="status" className="rounded-xl bg-secondary p-4">{notice}</p>}
    {loading ? <p role="status">Loading your consultations…</p> : !bookings.length ? !error && <section className="space-y-3 rounded-2xl border p-6"><h2 className="text-xl font-semibold">No bookings for this email yet</h2><p>Make sure this is the email address you used to request your consultation.</p><Link className="underline" href="/book/4u-digital/">Request a consultation</Link></section> : <div className="space-y-5">{sorted.map(booking => {
      const meet = booking.status === "confirmed" && /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(booking.meeting_url || "") ? booking.meeting_url : null;
      const cancellable = booking.source === "recovery" && ["pending_approval", "confirming", "confirmed", "cancelling"].includes(booking.status) && (Date.parse(booking.starts_at) > now || Boolean(booking.reschedule));
      return <article key={booking.source + ":" + booking.id} className="space-y-3 rounded-2xl border p-6"><p className="text-sm font-semibold">{booking.reschedule ? "Time change in progress" : labels[booking.status] || booking.status.replaceAll("_", " ")}</p><h2 className="text-xl font-semibold">{booking.title}</h2><p>With {booking.consultant_name || booking.consultant || "4u Digital"}</p><p>{date(booking.starts_at)}</p>{booking.reschedule && <p>Your consultant is confirming a change to {date(booking.reschedule.starts_at)}. Refresh to check the final time.</p>}
        {booking.source === "supabase" ? <><Link className="underline" href={`/manage/${encodeURIComponent(booking.manage_token || "")}/`}>Open original booking details</Link><IntakeEditor booking={booking.id} /></> : <>{meet && <a className="inline-block underline" href={meet} target="_blank" rel="noopener noreferrer">Join Google Meet</a>}{booking.status === "pending_approval" && <p>Your consultant must approve this request before it is confirmed.</p>}{booking.notes && <details><summary className="cursor-pointer underline">Your project details</summary><p className="mt-3 whitespace-pre-wrap">{booking.notes}</p></details>}{cancellable && (confirm === booking.id ? <div className="space-y-3 rounded-xl bg-secondary p-4"><p>Cancel this booking and remove its Calendar event?</p><div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void cancel(booking.id)}>Yes, cancel booking</Button><Button disabled={busy} variant="outline" onClick={() => setConfirm(null)}>Keep booking</Button></div></div> : <Button variant="outline" disabled={busy} onClick={() => setConfirm(booking.id)}>{booking.status === "cancelling" ? "Retry cancellation" : "Cancel booking"}</Button>)}</>}
      </article>;
    })}</div>}{nextCursor && <Button variant="outline" disabled={busy || loading} onClick={() => void loadMore()}>{busy ? "Loading…" : "Load more current bookings"}</Button>}
  </>;
}
