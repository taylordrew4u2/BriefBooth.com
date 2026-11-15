"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { bookingMatchesSearch } from "@/lib/booking-search";

type Service = { id: string; title: string; description?: string; duration: number };
type Config = {
  profile: { timezone: string; intake_questions?: { id: string; options?: string[] }[] };
  services: Service[];
  preferences?: { horizon_days?: number };
};
const projectTypeLabels: Record<string, string> = {
  Website: "Website",
  "Web application": "Web app",
  "Mobile application": "Mobile app",
  Software: "Custom software",
  "Automation & integrations": "Automation or integrations",
  "Fixes & improvements": "Improve something I already have",
  "Other / not sure yet": "Something else / not sure yet",
};
type Booking = {
  id: string;
  title?: string;
  service_title?: string;
  starts_at: string;
  status: string;
  client_name?: string;
  client_email?: string;
  notes?: string;
  meeting_url?: string;
  meeting_error?: string | null;
  meet_url?: string;
  source?: string;
  timezone?: string;
  email_pending?: boolean;
  email_uncertain?: boolean;
  email_queued?: boolean;
  email_failed?: boolean;
  reschedule?: { operation_id: string; starts_at: string } | null;
};
type EmailStatus = Pick<Booking, "email_pending" | "email_uncertain" | "email_queued" | "email_failed">;
function clientEmailStatus(value: EmailStatus) {
  if (value.email_failed) return "The email notification could not be delivered.";
  if (value.email_uncertain) return "Email delivery could not be verified. Check your inbox and spam folder.";
  return "The email notification is still pending.";
}
type ReviewPage = { bookings: Booking[]; next_cursor: string | null };
const fieldClass = "w-full rounded-xl border border-border bg-white px-4 py-3";
const statusLabels: Record<string, string> = {
  pending_approval: "Awaiting approval", confirming: "Preparing Google Meet", confirmed: "Confirmed",
  declined: "Declined", cancelling: "Cancellation in progress", cancelled: "Cancelled",
};
function bookingStatus(booking: Booking) {
  if (booking.reschedule && booking.status === "confirmed") return "Time change in progress";
  return booking.status === "confirming" && booking.meeting_error === "google_meet_failed"
    ? "Google Meet setup failed" : statusLabels[booking.status] || "Status unavailable";
}

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
function dateBounds(timezone: string, horizonDays = 60) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const min = `${parts.year}-${parts.month}-${parts.day}`;
  const max = new Date(Date.parse(`${min}T12:00:00Z`) + horizonDays * 86_400_000).toISOString().slice(0, 10);
  return { min, max };
}
function safeMeet(booking: Booking) {
  const value = booking.meeting_url || booking.meet_url || "";
  return /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(value) ? value : null;
}
function Frame({ title, children }: { title: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [title]);
  return <><header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-6"><Logo /><Link href="/" className="text-sm underline underline-offset-4">Home</Link></header>
    <main id="main" className="mx-auto max-w-3xl px-5 pb-16 pt-6"><p className="mb-2 text-sm font-semibold tracking-wide">4u Digital</p><h1 ref={heading} tabIndex={-1} className="mb-6 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>{children}</main>
    <footer className="mx-auto flex max-w-3xl flex-wrap gap-5 px-5 pb-8 text-sm"><Link href="/privacy/" className="underline">Privacy</Link><a href="mailto:admin@customtechbuilt4u.com" className="underline">Contact 4u Digital</a></footer></>;
}
function Notice({ text }: { text: string }) {
  const notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (text) notice.current?.focus(); }, [text]);
  return text ? <p ref={notice} tabIndex={-1} role="alert" className="my-4 rounded-xl border border-border bg-secondary p-4 text-sm">{text}</p> : null;
}

export default function RecoveryBooking() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [serviceId, setServiceId] = useState("");
  const [day, setDay] = useState("");
  const [slot, setSlot] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [slotsRefresh, setSlotsRefresh] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<({ token: string; status: string } & EmailStatus) | null>(null);
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
    Promise.resolve().then(() => { if (!controller.signal.aborted) { setSlots([]); setSlot(""); setSlotsError(""); setChecking(Boolean(serviceId && day)); } });
    if (serviceId && day) api<{ slots: string[] }>(`slots?service=${encodeURIComponent(serviceId)}&day=${encodeURIComponent(day)}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setSlots(value.slots); })
      .catch(e => { if (!controller.signal.aborted) setSlotsError(message(e)); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [serviceId, day, slotsRefresh]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || !config || !slot) return;
    const data = new FormData(event.currentTarget);
    if (data.get("website")) return;
    const selectedProject = String(data.get("project-type") || "");
    const body = { serviceId, startsAt: slot, name: String(data.get("name") || "").trim(), email: String(data.get("email") || "").trim(), notes: String(data.get("notes") || "").trim(), ...(projectQuestion && selectedProject ? { answers: { [projectQuestion.id]: selectedProject } } : {}) };
    const key = JSON.stringify(body);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    submitLock.current = true; setSubmitting(true); setError("");
    try { setResult(await api("book", { body: { ...body, requestId: request.current.id } })); }
    catch (e) { setError(message(e)); }
    finally { submitLock.current = false; setSubmitting(false); }
  }
  const service = config?.services.find(s => s.id === serviceId);
  const projectQuestion = config?.profile.intake_questions?.find(q => q.id === "project-types" && q.options?.length);
  const projectTypes = [...(projectQuestion?.options || [])].sort((a, b) => Number(b === "Website") - Number(a === "Website"));
  const dates = config ? dateBounds(config.profile.timezone, config.preferences?.horizon_days) : undefined;
  if (result) return <Frame title="Your request is saved"><div className="space-y-5 rounded-2xl border border-border p-6"><p className="text-lg font-semibold">{statusLabels[result.status] || "Check your booking status"}</p><p>{stamp(slot, config?.profile.timezone)}</p><p>{result.status === "pending_approval" ? "This time is requested, not confirmed yet. Once approved, your booking page will show your Google Meet link." : "Open your private booking page to see the current status and any Google Meet link."}</p>{result.email_pending && <p role="status" className="rounded-xl bg-secondary p-4 text-sm">{clientEmailStatus(result)} Your request is saved. Keep the private booking link below and use it to check your status.</p>}<Button asChild><a href={`/booking-status/#token=${encodeURIComponent(result.token)}`}>View your booking</a></Button><p className="text-sm">Save the private booking link. It lets you check the status or cancel your request.</p></div></Frame>;
  return <Frame title="Need a website built?"><Notice text={error} />{loading ? <p role="status">Loading consultation details…</p> : !config ? <Button onClick={() => setReload(v => v + 1)}>Try again</Button> : !config.services.length ? <p>No consultations are available right now. Please contact 4u Digital to arrange a time.</p> : <>
    <div className="mb-7 space-y-3"><p>{service?.description || "I build websites for businesses and people. I also build apps and custom software."}</p><div className="flex flex-wrap gap-2"><span className="rounded-full bg-secondary px-3 py-1 text-sm">Free</span><span className="rounded-full bg-secondary px-3 py-1 text-sm">{service?.duration || 30} minutes</span><span className="rounded-full bg-accent px-3 py-1 text-sm">Google Meet</span></div></div>
    <form onSubmit={submit} className="space-y-7 rounded-2xl border border-border p-5 sm:p-7" aria-busy={submitting}>
      <fieldset disabled={submitting} className="space-y-5"><legend className="mb-4 text-xl font-semibold">Choose a time</legend>
        {config.services.length > 1 && <label className="block space-y-2"><span>Consultation</span><select className={fieldClass} value={serviceId} onChange={e => { setSlot(""); setServiceId(e.target.value); }} required>{config.services.map(s => <option key={s.id} value={s.id}>{s.title} · {s.duration} minutes</option>)}</select></label>}
        <label className="block space-y-2"><span>Preferred date</span><Input type="date" value={day} min={dates?.min} max={dates?.max} onChange={e => { setSlot(""); setDay(e.target.value); }} required /></label>
        <p className="text-sm">Times below are shown in {config.profile.timezone.replaceAll("_", " ")}. Your appointment needs approval.</p>
        {checking ? <p role="status">Checking available times…</p> : slotsError ? <Notice text={slotsError} /> : day && <label className="block space-y-2"><span>Available time</span><select className={fieldClass} value={slot} onChange={e => setSlot(e.target.value)} required disabled={!slots.length}><option value="">{slots.length ? "Choose a time" : "No available times — choose another date"}</option>{slots.map(s => <option key={s} value={s}>{stamp(s, config.profile.timezone)}</option>)}</select></label>}
        {day && <Button type="button" variant="outline" disabled={checking} onClick={() => { setSlot(""); setSlotsRefresh(v => v + 1); }}>{slotsError ? "Try checking times again" : "Refresh available times"}</Button>}
      </fieldset>
      <fieldset disabled={submitting} className="space-y-5"><legend className="mb-4 text-xl font-semibold">Your details</legend><label className="block space-y-2"><span>Your name</span><Input name="name" autoComplete="name" maxLength={100} required /></label><label className="block space-y-2"><span>Email</span><Input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        {projectQuestion && <label className="block space-y-2"><span>What can I help you with?</span><select className={fieldClass} name="project-type" defaultValue="" required><option value="" disabled>Choose one</option>{projectTypes.map(type => <option key={type} value={type}>{projectTypeLabels[type] || type}</option>)}</select></label>}
        <div className="space-y-2"><label className="block" htmlFor="consultation-note">What would you like it to do? <span className="text-sm text-muted-foreground">(optional)</span></label><Textarea id="consultation-note" name="notes" maxLength={2000} rows={3} aria-describedby="consultation-note-help" /><p id="consultation-note-help" className="text-sm text-muted-foreground">A sentence is plenty. For example, “I’d like customers to book appointments online.”</p></div>
        <div hidden aria-hidden="true"><label>Website<Input name="website" autoComplete="off" tabIndex={-1} /></label></div>
      </fieldset>
      <p className="text-sm">No payment is required. 4u Digital will review your request before confirming the time.</p><Button type="submit" disabled={submitting || checking || !slot} size="lg">{submitting ? "Saving your request…" : "Request this time"}</Button>
    </form></>}</Frame>;
}

export function RecoveryStatus() {
  const [token, setToken] = useState("");
  const activeToken = useRef("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailStatus>({});
  const lock = useRef(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    function readToken() {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
      activeToken.current = value; setToken(value); setBooking(null); setBusy(false); setConfirmCancel(false); setError(""); setReady(true); setRefresh(v => v + 1);
    }
    Promise.resolve().then(readToken);
    window.addEventListener("hashchange", readToken);
    return () => window.removeEventListener("hashchange", readToken);
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    Promise.resolve().then(() => { setBusy(true); setError(""); });
    api<{ booking: Booking } & EmailStatus>("manage", { token, signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setBooking(value.booking);
      setEmailStatus(value);
    })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [token, refresh]);
  async function cancel() {
    if (lock.current || !token || activeToken.current !== token) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await api<{ booking: Booking } & EmailStatus>("cancel", { token, body: {} });
      if (activeToken.current !== token) return;
      setBooking(response.booking); setEmailStatus(response); setConfirmCancel(false);
    }
    catch (e) { if (activeToken.current === token) setError(message(e)); }
    finally { lock.current = false; if (activeToken.current === token) { setBusy(false); setConfirmCancel(false); setRefresh(v => v + 1); } }
  }
  const meeting = booking ? safeMeet(booking) : null;
  return <Frame title="Your booking"><Notice text={error} />{!ready || (busy && !booking) ? <p role="status">Loading your booking…</p> : !token ? <p>Open the private booking link you received after submitting your request.</p> : <>
    {booking && <div className="space-y-5 rounded-2xl border border-border p-6"><p className="inline-block rounded-full bg-accent px-3 py-1 text-sm font-medium">{bookingStatus(booking)}</p><h2 className="text-xl font-semibold">{booking.title || booking.service_title || "Consultation with 4u Digital"}</h2><p>{stamp(booking.starts_at, booking.timezone)}</p>
      {emailStatus.email_pending && <p className="text-sm">{clientEmailStatus(emailStatus)} Your saved booking status is shown here; keep this private link.</p>}
      {booking.status === "pending_approval" && <p>Your time has been requested. Wait for approval before joining a call.</p>}
      {booking.reschedule && booking.status === "confirmed" && <p role="status">A change to {stamp(booking.reschedule.starts_at, booking.timezone)} is being checked. The time above is the last confirmed time. Please wait for the updated confirmation; contact 4u Digital if you need help.</p>}
      {booking.status === "confirming" && <p>{booking.meeting_error === "google_meet_failed" ? "Google could not create the Meet link. Cancel this request and request another time. This appointment is not confirmed." : "Your consultant is preparing your Google Meet call. Refresh this page to check for the confirmation."}</p>}
      {booking.status === "confirmed" && (meeting ? <Button asChild><a href={meeting} target="_blank" rel="noopener noreferrer">Join Google Meet</a></Button> : <p>The Google Meet link is not available yet. Contact 4u Digital before your appointment.</p>)}
      {booking.status === "cancelling" && <p>Cancellation is not complete yet. Retry cancellation to finish checking and removing the calendar event.</p>}
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
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const visiblePages = useRef(1);
  const lock = useRef(false);
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [notificationNotice, setNotificationNotice] = useState("");
  useEffect(() => {
    function readToken() {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
      if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
      if (value) { visiblePages.current = 1; setNextCursor(null); setBookings([]); setLoaded(false); setError(""); setActionError(""); setNotificationNotice(""); setToken(value); setRefresh(v => v + 1); }
    }
    Promise.resolve().then(readToken);
    window.addEventListener("hashchange", readToken);
    return () => window.removeEventListener("hashchange", readToken);
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    Promise.resolve().then(() => { setBusy(true); });
    async function readVisiblePages() {
      const rows = new Map<string, Booking>();
      let cursor: string | null = null;
      let pagesRead = 0;
      const pageCount = visiblePages.current;
      do {
        const page: ReviewPage = await api<ReviewPage>(cursor ? `admin?cursor=${encodeURIComponent(cursor)}` : "admin", { token, signal: controller.signal });
        for (const booking of page.bookings) rows.set(booking.id, booking);
        cursor = page.next_cursor || null;
        pagesRead += 1;
      } while (cursor && pagesRead < pageCount);
      return { bookings: [...rows.values()], next_cursor: cursor, pagesRead };
    }
    readVisiblePages().then(value => {
      if (controller.signal.aborted) return;
      setBookings(value.bookings); setNextCursor(value.next_cursor); visiblePages.current = value.pagesRead; setLoaded(true); setError("");
    })
      .catch(e => { if (!controller.signal.aborted) { setError(message(e)); setLoaded(false); } })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [token, refresh]);
  async function loadMore() {
    if (lock.current || busy || !token || !nextCursor) return;
    lock.current = true; setBusy(true); setLoadingMore(true); setError("");
    try {
      const page = await api<ReviewPage>(`admin?cursor=${encodeURIComponent(nextCursor)}`, { token });
      setBookings(current => [...new Map([...current, ...page.bookings].map(booking => [booking.id, booking])).values()]);
      setNextCursor(page.next_cursor || null); visiblePages.current += 1;
    } catch (e) { setError(message(e)); }
    finally { lock.current = false; setBusy(false); setLoadingMore(false); }
  }
  function notificationStatus(value: EmailStatus) {
    if (value.email_failed) return "Some email notifications could not be delivered. The booking is still saved.";
    if (value.email_uncertain) return "Some deliveries could not be verified. Check your inbox before sending another message.";
    if (value.email_queued) return "Some email notifications are queued to retry.";
    if (value.email_pending) return "Waiting for the email service to confirm delivery.";
    return "No outstanding email notifications for this booking status.";
  }
  async function review(bookingId: string, approve: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setActionError(""); setNotificationNotice("");
    try { const response = await api<EmailStatus>("review", { token, body: { bookingId, approve } }); if (response.email_pending) setNotificationNotice(notificationStatus(response)); setDeclineId(null); setRefresh(v => v + 1); }
    catch (e) { setActionError(message(e)); setRefresh(v => v + 1); }
    finally { lock.current = false; setBusy(false); }
  }
  async function checkNotifications(bookingId: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setActionError(""); setNotificationNotice("");
    try { const response = await api<EmailStatus>("notifications", { token, body: { bookingId } }); setNotificationNotice(notificationStatus(response)); setRefresh(v => v + 1); }
    catch (e) { setActionError(message(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function reschedule(bookingId: string, startsAt: string, operationId: string) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(""); setActionError(""); setNotificationNotice("");
    try {
      const response = await api<{ booking: Booking } & EmailStatus>("reschedule", { token, body: { bookingId, startsAt, operationId } });
      setBookings(current => current.map(booking => booking.id === bookingId ? {
        ...booking,
        ...response.booking,
        ...(response.email_pending !== undefined ? { email_pending: response.email_pending } : {}),
        ...(response.email_uncertain !== undefined ? { email_uncertain: response.email_uncertain } : {}),
        ...(response.email_queued !== undefined ? { email_queued: response.email_queued } : {}),
        ...(response.email_failed !== undefined ? { email_failed: response.email_failed } : {}),
      } : booking));
      if (response.email_pending) setNotificationNotice(notificationStatus(response));
      return true;
    } catch (e) { setActionError(message(e)); return false; }
    finally { lock.current = false; setBusy(false); setRefresh(v => v + 1); }
  }
  const matches = bookings.filter(booking => bookingMatchesSearch(booking, search));
  return <Frame title="Review booking requests"><p className="mb-5">Approve a request to confirm the time and create its Google Meet link.</p><p className="mb-5 text-sm"><Link className="underline underline-offset-4" href="/account/sign-in/">Consultant or client account? Sign in here.</Link></p><Notice text={actionError || error} />{notificationNotice && <p role="status" className="mb-5 rounded-xl bg-secondary p-4 text-sm">{notificationNotice}</p>}{!token ? <form className="space-y-4 rounded-2xl border border-border p-6" onSubmit={e => { e.preventDefault(); if (entry.trim()) { setActionError(""); setToken(entry.trim()); setEntry(""); } }}><label className="block space-y-2"><span>Private access key</span><Input type="password" value={entry} onChange={e => setEntry(e.target.value)} autoComplete="off" required /></label><p className="text-sm">Use your private owner key. Don’t share it with clients.</p><Button type="submit">Open requests</Button></form> : <>
    <div className="mb-5 flex flex-wrap gap-3"><Button disabled={busy} variant="outline" onClick={() => setRefresh(v => v + 1)}>{busy && !loadingMore ? "Refreshing…" : "Refresh requests"}</Button><Button variant="ghost" disabled={busy} onClick={() => { setToken(""); setSearch(""); setBookings([]); setLoaded(false); setNextCursor(null); visiblePages.current = 1; setError(""); setActionError(""); setNotificationNotice(""); }}>Lock page</Button></div>
    <label className="mb-5 block space-y-2"><span>Search loaded requests</span><Input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, email, or booking ID" autoComplete="off" /></label>
    {loaded && search.trim() && !matches.length && <p role="status">No matching requests in the loaded results.{nextCursor ? " Load more requests to search earlier bookings." : ""}</p>}
    {busy && !loaded && <p role="status">Loading requests…</p>}{loaded && !bookings.length && <p>No booking requests yet.</p>}
    <div className="space-y-5">{matches.map(booking => <article key={booking.id} className="space-y-3 rounded-2xl border border-border p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{booking.client_name || "Reserved time"}</h2><span className="rounded-full bg-accent px-3 py-1 text-sm">{bookingStatus(booking)}</span></div>{booking.client_email && <p className="break-all">{booking.client_email}</p>}<p>{booking.title || booking.service_title || "Consultation"} · {stamp(booking.starts_at, booking.timezone)}</p>{booking.notes && <details><summary className="cursor-pointer underline underline-offset-4">Project details</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm">{booking.notes}</p></details>}
      {booking.source === "supabase" ? <p className="text-sm">Existing reservation. Manage this appointment through its original booking record.</p> : <>
        {booking.email_pending && <div className="space-y-3 rounded-xl bg-secondary p-4"><p className="text-sm">{notificationStatus(booking)}</p><Button variant="outline" disabled={busy} onClick={() => checkNotifications(booking.id)}>{booking.email_queued ? "Retry queued emails" : "Check email delivery"}</Button></div>}
        {booking.status === "confirming" && booking.meeting_error === "google_meet_failed" && <p className="text-sm">Google could not create the Meet link. Cancel this request and ask the client to request another time.</p>}
        {["pending_approval", "confirming"].includes(booking.status) && <div className="flex flex-wrap gap-3">{(booking.status === "pending_approval" || booking.meeting_error !== "google_meet_failed") && <Button disabled={busy} onClick={() => review(booking.id, true)}>{booking.status === "confirming" ? "Retry Google Meet setup" : "Approve & create Google Meet"}</Button>}<Button disabled={busy} variant="outline" onClick={() => setDeclineId(booking.id)}>{booking.status === "pending_approval" ? "Decline" : "Cancel request"}</Button></div>}
        {booking.status === "cancelling" && <><p className="text-sm">Cancellation is not complete yet. Retry to finish checking and removing the calendar event.</p><Button disabled={busy} variant="outline" onClick={() => review(booking.id, false)}>Retry cancellation</Button></>}
        {declineId === booking.id && <div className="space-y-3 rounded-xl bg-secondary p-4"><p>{booking.status === "pending_approval" ? "Decline this request?" : "Cancel this request and remove any Google Calendar event?"}</p><div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => review(booking.id, false)}>{booking.status === "pending_approval" ? "Yes, decline" : "Yes, cancel request"}</Button><Button disabled={busy} variant="outline" onClick={() => setDeclineId(null)}>Keep request</Button></div></div>}
        {booking.status === "confirmed" && <><div className="flex flex-wrap items-center gap-3">{safeMeet(booking) && <a className="inline-block underline underline-offset-4" href={safeMeet(booking)!} target="_blank" rel="noopener noreferrer">Open Google Meet</a>}<Button disabled={busy} variant="outline" onClick={() => setDeclineId(booking.id)}>Cancel booking</Button></div><RecoveryReschedule booking={booking} token={token} busy={busy} apply={(startsAt, operationId) => reschedule(booking.id, startsAt, operationId)} /></>}
      </>}
    </article>)}</div>
    {bookings.length > 0 && <p className="mt-5 text-sm" role="status">Showing {matches.length} of {bookings.length} loaded {bookings.length === 1 ? "request" : "requests"}{nextCursor ? ". More requests are available." : "."}</p>}
    {nextCursor && <Button className="mt-4" variant="outline" disabled={busy} onClick={loadMore}>{loadingMore ? "Loading more requests…" : "Load more requests"}</Button>}
  </>}</Frame>;
}

function RecoveryReschedule({ booking, token, busy, apply }: { booking: Booking; token: string; busy: boolean; apply: (startsAt: string, operationId: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const operation = useRef<{ startsAt: string; id: string } | null>(null);
  const timezone = booking.timezone || "America/New_York";
  const bounds = dateBounds(timezone);
  useEffect(() => {
    if (!open || !day || booking.reschedule) return;
    const controller = new AbortController();
    Promise.resolve().then(() => { if (!controller.signal.aborted) { setLoading(true); setSlots([]); setSlot(""); setError(""); } });
    api<{ slots: string[] }>(`reschedule-slots?bookingId=${encodeURIComponent(booking.id)}&day=${encodeURIComponent(day)}`, { token, signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setSlots(value.slots); })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, day, booking.id, booking.reschedule, token, refresh]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || loading || !slot) return;
    if (operation.current?.startsAt !== slot) operation.current = { startsAt: slot, id: crypto.randomUUID() };
    if (await apply(slot, operation.current.id)) { setOpen(false); setDay(""); setSlot(""); operation.current = null; }
  }
  if (booking.reschedule) return <div className="space-y-3 rounded-xl bg-secondary p-4"><p role="status">A change to {stamp(booking.reschedule.starts_at, timezone)} is being checked. The time above is the last confirmed time. Wait for the updated confirmation before joining.</p><Button disabled={busy} variant="outline" onClick={() => apply(booking.reschedule!.starts_at, booking.reschedule!.operation_id)}>Finish time change</Button></div>;
  if (!open) return <Button disabled={busy} variant="outline" onClick={() => setOpen(true)}>Change appointment time</Button>;
  return <form onSubmit={submit} className="space-y-4 rounded-xl bg-secondary p-4"><h3 className="font-semibold">Change appointment time</h3><p className="text-sm">Choose a time agreed with the client. BriefBooth will update the existing Google Calendar event and send a new confirmation. The Google Meet link stays the same.</p><label className="block space-y-2"><span>New appointment date</span><Input type="date" value={day} min={bounds.min} max={bounds.max} disabled={busy} required onChange={e => { setDay(e.target.value); setSlot(""); operation.current = null; }} /></label><Notice text={error} />{loading ? <p role="status">Checking available times…</p> : day && !error && <label className="block space-y-2"><span>New appointment time</span><select className={fieldClass} value={slot} disabled={busy || !slots.length} required onChange={e => { setSlot(e.target.value); operation.current = null; }}><option value="">{slots.length ? "Choose a time" : "No available times — choose another date"}</option>{slots.map(value => <option key={value} value={value}>{stamp(value, timezone)}</option>)}</select></label>}<div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || loading || !slot}>Confirm new time</Button>{error && <Button type="button" variant="outline" disabled={busy || loading} onClick={() => setRefresh(v => v + 1)}>Check times again</Button>}<Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Keep current time</Button></div></form>;
}
