"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { IntakeQuestion } from "@/lib/intake";

type Service = { id: string; title: string; description?: string; duration: number };
type Config = {
  profile: { name: string; headline?: string; bio?: string; timezone: string; intake_questions?: IntakeQuestion[] };
  services: Service[];
  preferences?: { horizon_days?: number };
};
type Booking = {
  id: string;
  bookingId?: string;
  title?: string;
  service_title?: string;
  starts_at: string;
  ends_at: string;
  status: string;
  client_name?: string;
  client_email?: string;
  notes?: string;
  meeting_url?: string;
  meet_url?: string;
  source?: string;
  timezone?: string;
  email_pending?: boolean;
  email_uncertain?: boolean;
  email_queued?: boolean;
};
const fieldClass = "w-full rounded-xl border border-border bg-white px-4 py-3";
const statusLabels: Record<string, string> = {
  pending_approval: "Awaiting approval", confirming: "Preparing Google Meet", confirmed: "Confirmed",
  declined: "Declined", cancelling: "Cancellation in progress", cancelled: "Cancelled",
};

async function api<T>(path: string, options: { body?: unknown; token?: string; signal?: AbortSignal } = {}): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  const response = await fetch(`/api/recovery/${path}`, {
    method: options.body === undefined ? "GET" : "POST", headers, cache: "no-store",
    body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "We couldn’t complete that request. Please try again.");
  return data as T;
}
function message(error: unknown) { return error instanceof Error ? error.message : "Please try again."; }
function stamp(value: string, timezone?: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", ...(timezone ? { timeZone: timezone } : {}) });
}
function safeMeet(booking: Booking) {
  const value = booking.meeting_url || booking.meet_url || "";
  return /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(value) ? value : null;
}
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return <><header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-6"><Logo /><Link href="/" className="text-sm underline underline-offset-4">Home</Link></header>
    <main id="main" className="mx-auto max-w-3xl px-5 pb-16 pt-6"><p className="mb-2 text-sm font-semibold tracking-wide">4u Digital</p><h1 className="mb-6 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>{children}</main>
    <footer className="mx-auto flex max-w-3xl flex-wrap gap-5 px-5 pb-8 text-sm"><Link href="/privacy/" className="underline">Privacy</Link><a href="mailto:admin@customtechbuilt4u.com" className="underline">Contact 4u Digital</a></footer></>;
}
function Notice({ text }: { text: string }) { return text ? <p role="alert" className="my-4 rounded-xl border border-border bg-secondary p-4 text-sm">{text}</p> : null; }

export default function RecoveryBooking() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [serviceId, setServiceId] = useState("");
  const [day, setDay] = useState("");
  const [slot, setSlot] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ token: string; status: string; email_pending?: boolean; email_uncertain?: boolean } | null>(null);
  const submitLock = useRef(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => { setLoading(true); setError(""); });
    api<Config>("config", { signal: controller.signal }).then(value => {
      setConfig(value); setServiceId(value.services[0]?.id || "");
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => { if (!controller.signal.aborted) { setSlots([]); setSlot(""); setChecking(Boolean(serviceId && day)); } });
    if (serviceId && day) api<{ slots: string[] }>(`slots?service=${encodeURIComponent(serviceId)}&day=${encodeURIComponent(day)}`, { signal: controller.signal })
      .then(value => { setSlots(value.slots); setError(""); })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [serviceId, day]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || !config || !slot) return;
    const data = new FormData(event.currentTarget);
    if (data.get("website")) return;
    const answers: Record<string, string> = {};
    for (const question of config.profile.intake_questions || []) {
      const answer = data.getAll(`question-${question.id}`).map(String).map(s => s.trim()).filter(Boolean).join("\n");
      if (question.required && !answer) { setError(`Please answer: ${question.label}`); return; }
      answers[question.id] = answer;
    }
    const body = { serviceId, startsAt: slot, name: String(data.get("name") || "").trim(), email: String(data.get("email") || "").trim(), notes: String(data.get("notes") || "").trim(), answers };
    const key = JSON.stringify(body);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    submitLock.current = true; setSubmitting(true); setError("");
    try { setResult(await api("book", { body: { ...body, requestId: request.current.id } })); }
    catch (e) { setError(message(e)); }
    finally { submitLock.current = false; setSubmitting(false); }
  }
  const service = config?.services.find(s => s.id === serviceId);
  if (result) return <Frame title="Your request is saved"><div className="space-y-5 rounded-2xl border border-border p-6"><p className="text-lg font-semibold">{statusLabels[result.status] || "Check your booking status"}</p><p>{stamp(slot, config?.profile.timezone)}</p><p>{result.status === "pending_approval" ? "This time is requested, not confirmed yet. Once approved, your booking page will show your Google Meet link." : "Open your private booking page to see the current status and any Google Meet link."}</p>{result.email_pending && <p role="status" className="rounded-xl bg-secondary p-4 text-sm">{result.email_uncertain ? "Email delivery could not be confirmed. Check your inbox before requesting another message." : "Email notification is still pending."} Your request is saved. Keep the private booking link below and use it to check your status.</p>}<Button asChild><a href={`/booking-status/#token=${encodeURIComponent(result.token)}`}>View your booking</a></Button><p className="text-sm">Save the private booking link. It lets you check the status or cancel your request.</p></div></Frame>;
  return <Frame title="Let’s talk about your project"><Notice text={error} />{loading ? <p role="status">Loading consultation details…</p> : !config ? <Button onClick={() => setReload(v => v + 1)}>Try again</Button> : <>
    <div className="mb-7 space-y-3"><p>{config.profile.headline}</p><p>{service?.description || "Book a free first consultation with 4u Digital."}</p><div className="flex flex-wrap gap-2"><span className="rounded-full bg-secondary px-3 py-1 text-sm">Free</span><span className="rounded-full bg-secondary px-3 py-1 text-sm">{service?.duration || 30} minutes</span><span className="rounded-full bg-accent px-3 py-1 text-sm">Google Meet</span></div></div>
    <form onSubmit={submit} className="space-y-7 rounded-2xl border border-border p-5 sm:p-7" aria-busy={submitting}>
      <fieldset disabled={submitting} className="space-y-5"><legend className="mb-4 text-xl font-semibold">Choose a time</legend>
        {config.services.length > 1 && <label className="block space-y-2"><span>Consultation</span><select className={fieldClass} value={serviceId} onChange={e => { setSlot(""); setServiceId(e.target.value); }} required>{config.services.map(s => <option key={s.id} value={s.id}>{s.title} · {s.duration} minutes</option>)}</select></label>}
        <label className="block space-y-2"><span>Preferred date</span><Input type="date" value={day} onChange={e => { setSlot(""); setDay(e.target.value); }} required /></label>
        <p className="text-sm">Times below are shown in {config.profile.timezone.replaceAll("_", " ")}. Your appointment needs approval.</p>
        {checking ? <p role="status">Checking available times…</p> : day && <label className="block space-y-2"><span>Available time</span><select className={fieldClass} value={slot} onChange={e => setSlot(e.target.value)} required disabled={!slots.length}><option value="">{slots.length ? "Choose a time" : "No available times — choose another date"}</option>{slots.map(s => <option key={s} value={s}>{stamp(s, config.profile.timezone)}</option>)}</select></label>}
      </fieldset>
      <fieldset disabled={submitting} className="space-y-5"><legend className="mb-4 text-xl font-semibold">A little about you</legend><label className="block space-y-2"><span>Your name</span><Input name="name" autoComplete="name" maxLength={100} required /></label><label className="block space-y-2"><span>Email</span><Input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        {(config.profile.intake_questions || []).map(q => <fieldset key={q.id} className="space-y-2"><legend className="mb-2 font-medium">{q.label}{!q.required && <span className="ml-1 text-sm font-normal text-muted-foreground">(optional)</span>}</legend>{q.type === "multiple" ? <div className="grid gap-2">{(q.options || []).map(option => <label key={option} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" name={`question-${q.id}`} value={option} /><span>{option}</span></label>)}</div> : q.type === "long" ? <Textarea name={`question-${q.id}`} aria-label={q.label} required={q.required} maxLength={1000} rows={3} /> : <Input name={`question-${q.id}`} aria-label={q.label} required={q.required} maxLength={500} />}</fieldset>)}
        <label className="block space-y-2"><span>Anything else? <span className="text-sm text-muted-foreground">(optional)</span></span><Textarea name="notes" maxLength={2000} rows={3} placeholder="Please don’t include passwords or other private account details." /></label>
        <div hidden aria-hidden="true"><label>Website<Input name="website" autoComplete="off" tabIndex={-1} /></label></div>
      </fieldset>
      <p className="text-sm">No payment is required. 4u Digital will review your request before confirming the time.</p><Button type="submit" disabled={submitting || checking || !slot} size="lg">{submitting ? "Saving your request…" : "Request this time"}</Button>
    </form></>}</Frame>;
}

export function RecoveryStatus() {
  const [token, setToken] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [emailPending, setEmailPending] = useState(false);
  const [emailUncertain, setEmailUncertain] = useState(false);
  const lock = useRef(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    Promise.resolve().then(() => { setToken(value); setReady(true); });
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    Promise.resolve().then(() => { setBusy(true); setError(""); });
    api<Booking | { booking: Booking; email_pending?: boolean; email_uncertain?: boolean }>("manage", { token, signal: controller.signal }).then(value => { setBooking("booking" in value ? value.booking : value); setEmailPending("booking" in value && Boolean(value.email_pending)); setEmailUncertain("booking" in value && Boolean(value.email_uncertain)); })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [token, refresh]);
  async function cancel() {
    if (lock.current || !token) return;
    lock.current = true; setBusy(true); setError("");
    try { await api("cancel", { token, body: {} }); setConfirmCancel(false); setRefresh(v => v + 1); }
    catch (e) { setError(message(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const meeting = booking ? safeMeet(booking) : null;
  return <Frame title="Your booking"><Notice text={error} />{!ready || (busy && !booking) ? <p role="status">Loading your booking…</p> : !token ? <p>Open the private booking link you received after submitting your request.</p> : <>
    {booking && <div className="space-y-5 rounded-2xl border border-border p-6"><p className="inline-block rounded-full bg-accent px-3 py-1 text-sm font-medium">{statusLabels[booking.status] || "Status unavailable"}</p><h2 className="text-xl font-semibold">{booking.title || booking.service_title || "Consultation with 4u Digital"}</h2><p>{stamp(booking.starts_at, booking.timezone)}</p>
      {emailPending && <p className="text-sm">{emailUncertain ? "Email delivery could not be confirmed. Check your inbox before requesting another message." : "An email notification is still pending."} Your saved booking status is shown here; keep this private link.</p>}
      {booking.status === "pending_approval" && <p>Your time has been requested. Wait for approval before joining a call.</p>}
      {booking.status === "confirming" && <p>Your consultant is preparing your Google Meet call. Refresh this page to check for the confirmation.</p>}
      {booking.status === "confirmed" && (meeting ? <Button asChild><a href={meeting} target="_blank" rel="noopener noreferrer">Join Google Meet</a></Button> : <p>The Google Meet link is not available yet. Contact 4u Digital before your appointment.</p>)}
      {booking.status === "cancelling" && <p>We’re removing the calendar event. Refresh to check when cancellation is complete.</p>}
      {booking.status === "declined" && <p>This time was not approved. You can request another time below.</p>}
      {booking.status === "cancelled" && <p>This booking is cancelled.</p>}
      {["pending_approval", "confirmed", "confirming", "cancelling"].includes(booking.status) && (confirmCancel ? <div className="space-y-3 rounded-xl bg-secondary p-4"><p>Cancel this appointment request?</p><div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={cancel}>{busy ? "Cancelling…" : "Yes, cancel booking"}</Button><Button disabled={busy} variant="outline" onClick={() => setConfirmCancel(false)}>Keep booking</Button></div></div> : <Button disabled={busy} variant="outline" onClick={() => setConfirmCancel(true)}>{booking.status === "cancelling" ? "Retry cancellation" : "Cancel booking"}</Button>)}
    </div>}
    <div className="mt-5 flex flex-wrap gap-4"><Button disabled={busy} variant="outline" onClick={() => setRefresh(v => v + 1)}>{busy ? "Refreshing…" : "Refresh status"}</Button><Button asChild variant="ghost"><Link href="/book/4u-digital/">Request another time</Link></Button></div>
  </>}</Frame>;
}

export function RecoveryReview() {
  const [token, setToken] = useState("");
  const [entry, setEntry] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [notificationNotice, setNotificationNotice] = useState("");
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (value) Promise.resolve().then(() => setToken(value));
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    Promise.resolve().then(() => { setBusy(true); });
    api<{ bookings: Booking[] }>("admin", { token, signal: controller.signal }).then(value => { setBookings(value.bookings); setLoaded(true); })
      .catch(e => { if (!controller.signal.aborted) { setError(message(e)); setLoaded(false); } })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [token, refresh]);
  async function review(bookingId: string, approve: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotificationNotice("");
    try { const response = await api<{ email_pending?: boolean; email_uncertain?: boolean }>("review", { token, body: { bookingId, approve } }); if (response.email_pending) setNotificationNotice(response.email_uncertain ? "The booking was updated, but email delivery could not be confirmed. Check your inbox before sending another message." : "The booking was updated. Email notifications are still pending; you can retry queued emails below."); setDeclineId(null); setRefresh(v => v + 1); }
    catch (e) { setError(message(e)); setRefresh(v => v + 1); }
    finally { lock.current = false; setBusy(false); }
  }
  async function retryNotifications(bookingId: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotificationNotice("");
    try { const response = await api<{ email_pending?: boolean; email_uncertain?: boolean }>("notifications", { token, body: { bookingId } }); setNotificationNotice(response.email_uncertain ? "Delivery could not be confirmed for some messages. Check your inbox before sending another message; those messages were not resent." : response.email_pending ? "Some emails are still queued. Please try again later." : "Queued notifications were accepted by the email service. Check your inbox for delivery."); setRefresh(v => v + 1); }
    catch (e) { setError(message(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Frame title="Review booking requests"><p className="mb-5">Approve a request to confirm the time and create its Google Meet link.</p><Notice text={error} />{notificationNotice && <p role="status" className="mb-5 rounded-xl bg-secondary p-4 text-sm">{notificationNotice}</p>}{!token ? <form className="space-y-4 rounded-2xl border border-border p-6" onSubmit={e => { e.preventDefault(); if (entry.trim()) { setToken(entry.trim()); setEntry(""); } }}><label className="block space-y-2"><span>Private access key</span><Input type="password" value={entry} onChange={e => setEntry(e.target.value)} autoComplete="off" required /></label><p className="text-sm">Use your private owner key. Don’t share it with clients.</p><Button type="submit">Open requests</Button></form> : <>
    <div className="mb-5 flex flex-wrap gap-3"><Button disabled={busy} variant="outline" onClick={() => setRefresh(v => v + 1)}>{busy ? "Refreshing…" : "Refresh requests"}</Button><Button variant="ghost" disabled={busy} onClick={() => { setToken(""); setBookings([]); setLoaded(false); setError(""); setNotificationNotice(""); }}>Lock page</Button></div>
    {busy && !loaded && <p role="status">Loading requests…</p>}{loaded && !bookings.length && <p>No booking requests yet.</p>}
    <div className="space-y-5">{bookings.map(booking => <article key={booking.id} className="space-y-3 rounded-2xl border border-border p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{booking.client_name || "Reserved time"}</h2><span className="rounded-full bg-accent px-3 py-1 text-sm">{statusLabels[booking.status] || booking.status}</span></div>{booking.client_email && <p className="break-all">{booking.client_email}</p>}<p>{booking.title || booking.service_title || "Consultation"} · {stamp(booking.starts_at)}</p>{booking.notes && <details><summary className="cursor-pointer underline underline-offset-4">Project details</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm">{booking.notes}</p></details>}
      {booking.source === "supabase" ? <p className="text-sm">Existing reservation. Manage this appointment through its original booking record.</p> : <>
        {booking.email_pending && <div className="space-y-3 rounded-xl bg-secondary p-4"><p className="text-sm">{booking.email_uncertain ? "Delivery could not be confirmed for some messages. Check your inbox before sending another message." : "Email notifications are still queued."}</p>{(booking.email_queued ?? (booking.email_pending && !booking.email_uncertain)) && <Button variant="outline" disabled={busy} onClick={() => retryNotifications(booking.id)}>Retry queued emails</Button>}</div>}
        {["pending_approval", "confirming"].includes(booking.status) && <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => review(booking.id, true)}>{booking.status === "confirming" ? "Retry Google Meet setup" : "Approve & create Google Meet"}</Button>{booking.status === "pending_approval" && <Button disabled={busy} variant="outline" onClick={() => setDeclineId(booking.id)}>Decline</Button>}</div>}
        {declineId === booking.id && <div className="space-y-3 rounded-xl bg-secondary p-4"><p>Decline this request?</p><div className="flex gap-3"><Button disabled={busy} onClick={() => review(booking.id, false)}>Yes, decline</Button><Button disabled={busy} variant="outline" onClick={() => setDeclineId(null)}>Keep request</Button></div></div>}
        {booking.status === "confirmed" && safeMeet(booking) && <a className="inline-block underline underline-offset-4" href={safeMeet(booking)!} target="_blank" rel="noopener noreferrer">Open Google Meet</a>}
      </>}
    </article>)}</div>
  </>}</Frame>;
}
