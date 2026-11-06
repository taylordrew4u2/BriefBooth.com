"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/supabase";
import type { ProjectPlannerDelivery } from "@/lib/database.types";

const plannerOwnerId = "adc53778-f007-4c58-bd47-ba7a675abb29";
const sender = "admin@customtechbuilt4u.com";
const plannerUrl = "https://customtechbuilt4u.com/project-brief/";
const subject = "Your 4u Digital project planner";
const body = `Hi,

You can share your website, app or software ideas with 4u Digital here:

${plannerUrl}

Start with what you know and skip anything you haven’t decided. You can explore styles, make your own color palette, add references and files, then review everything before sending it to me.

There’s no need for a finished plan. Your answers are a starting point for our conversation.

4u Digital`;

type Props = { ownerId: string; bookingId: string; clientName: string; clientEmail: string };
const states = new Set(["not_sent", "accepted", "pending", "uncertain", "failed"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deliveryResult(value: unknown): ProjectPlannerDelivery | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<ProjectPlannerDelivery>;
  if (!data.status || !states.has(data.status) || typeof data.can_send !== "boolean" || typeof data.recipient !== "string" || !data.recipient.trim()) return null;
  if (data.status !== "not_sent" && (typeof data.request_id !== "string" || !uuid.test(data.request_id))) return null;
  return { ...data, cooldown_until: typeof data.cooldown_until === "string" ? data.cooldown_until : null } as ProjectPlannerDelivery;
}

function friendlyError(error: unknown): string {
  const data = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
  if (["42501", "PGRST301", "PGRST302"].includes(data.code || "")) return "Check that you are signed into the 4u Digital consultant account, then refresh your studio.";
  if (data.message && !/failed to fetch|network|load failed|timeout/i.test(data.message)) return data.message.slice(0, 500);
  return "The connection was interrupted. We could not confirm whether the request was saved. Retry this same request or refresh its status; another copy will not be queued for an identical retry.";
}

function timeLabel(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SendProjectPlanner({ ownerId, bookingId, clientName, clientEmail }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<ProjectPlannerDelivery | null>(null);
  const [feedback, setFeedback] = useState("");
  const [unconfirmedRequest, setUnconfirmedRequest] = useState(false);
  const sendLock = useRef(false);
  const readLock = useRef(false);
  const requestId = useRef<string | null>(null);
  const alive = useRef(true);
  const draftHeading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const storageKey = `briefbooth-planner-request-v1:${ownerId}:${bookingId}`;

  function rememberRequest(value: string | null) {
    requestId.current = value;
    try {
      if (value) sessionStorage.setItem(storageKey, value);
      else sessionStorage.removeItem(storageKey);
    } catch { /* A disabled session store must not prevent an in-memory safe retry. */ }
  }

  function applyDelivery(value: ProjectPlannerDelivery) {
    setDelivery(value);
    if (["accepted", "failed"].includes(value.status)) {
      rememberRequest(null);
      setUnconfirmedRequest(false);
    } else if (["pending", "uncertain"].includes(value.status) && value.booking_id === bookingId && value.request_id) {
      rememberRequest(value.request_id);
      setUnconfirmedRequest(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    let active = true;
    if (ownerId !== plannerOwnerId) return () => { alive.current = false; };
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored && uuid.test(stored)) requestId.current = stored;
    } catch { /* The current tab can still retain its request ID in memory. */ }
    readLock.current = true;
    void Promise.resolve(db().rpc("get_4u_project_planner_status", { p_booking: bookingId })).then(({ data, error }) => {
      if (!active) return;
      if (error) throw error;
      const value = deliveryResult(data);
      if (!value) throw new Error("The delivery status could not be read. Refresh its status before sending.");
      applyDelivery(value);
    }).catch((error: unknown) => {
      if (active) setFeedback(friendlyError(error));
    }).finally(() => {
      if (active) { readLock.current = false; setChecking(false); }
    });
    return () => { active = false; alive.current = false; };
    // Each component is keyed by its booking and owner in the studio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, ownerId, storageKey]);

  useEffect(() => {
    if (open) draftHeading.current?.focus({ preventScroll: true });
  }, [open]);

  if (ownerId !== plannerOwnerId) return null;

  const recipient = delivery?.recipient || clientEmail;
  const allowed = delivery?.can_send === true && !["pending", "uncertain"].includes(delivery.status);
  const cooldown = timeLabel(delivery?.cooldown_until);
  const accepted = timeLabel(delivery?.accepted_at);
  const queued = timeLabel(delivery?.created_at);
  const label = { not_sent: "Not sent yet", accepted: "Sent to email service", pending: "Queued for delivery", uncertain: "Delivery needs checking", failed: "Not accepted by email service" }[delivery?.status || "not_sent"];

  async function refreshStatus() {
    if (readLock.current || sendLock.current) return;
    readLock.current = true;
    setChecking(true);
    setFeedback("");
    try {
      const { data, error } = await db().rpc("get_4u_project_planner_status", { p_booking: bookingId });
      if (error) throw error;
      const value = deliveryResult(data);
      if (!value) throw new Error("The delivery status could not be read. Refresh its status before sending.");
      if (alive.current) applyDelivery(value);
    } catch (error) {
      if (alive.current) setFeedback(friendlyError(error));
    } finally {
      readLock.current = false;
      if (alive.current) setChecking(false);
    }
  }

  async function send() {
    if (sendLock.current || readLock.current || !allowed) return;
    sendLock.current = true;
    setBusy(true);
    setFeedback("");
    const attempt = requestId.current || crypto.randomUUID();
    rememberRequest(attempt);
    try {
      const { data, error } = await db().rpc("send_4u_project_planner", { p_booking: bookingId, p_request: attempt });
      if (error) throw error;
      const value = deliveryResult(data);
      if (!value || value.status === "not_sent" || value.request_id !== attempt) throw new Error("We could not confirm the saved request. Refresh its status or retry the same request before sending another message.");
      if (!alive.current) return;
      applyDelivery(value);
      if (value.status === "accepted") {
        setFeedback(`The email service accepted your planner email for delivery to ${value.recipient}. This is not confirmation that the client has read it.`);
        setOpen(false);
      } else if (value.status === "pending") {
        setFeedback(`Your planner email to ${value.recipient} is queued. It has not been sent yet. Delivery runs in the background; refresh its status to check progress.`);
        setOpen(false);
      } else if (value.status === "uncertain") {
        setFeedback("The email service did not confirm its response. The message may already have been accepted, so another copy is blocked. Refresh its status and check the email service’s delivery log.");
      } else setFeedback("The email service did not accept the message. Check the delivery details and the resend availability below before trying again.");
    } catch (error) {
      if (alive.current) { setUnconfirmedRequest(true); setFeedback(friendlyError(error)); }
    } finally {
      sendLock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return <section className="planner-client-send" aria-label={`Project planner for ${clientName}`}>
    <div className="planner-client-toolbar">
      <Button ref={trigger} type="button" variant="outline" disabled={busy || checking} aria-label={`Send planner to ${clientName}`} onClick={() => { setOpen(true); void refreshStatus(); }}>Send planner</Button>
      <span className="planner-client-state">{checking ? "Checking planner delivery…" : delivery ? label : "Status unavailable"}</span>
      <button type="button" className="text-link planner-status-refresh" disabled={busy || checking} onClick={() => void refreshStatus()}>Refresh delivery</button>
    </div>
    {delivery?.status === "accepted" && <p className="planner-client-helper">Email accepted for delivery{accepted ? ` ${accepted}` : ""}. Inbox placement and whether it has been read are not confirmed.</p>}
    {delivery?.status === "pending" && <p className="planner-client-helper">Queued{queued ? ` ${queued}` : ""}; not sent yet. Delivery happens in the background. Do not send another copy while this is pending.</p>}
    {delivery?.status === "uncertain" && <p className="planner-client-helper">Delivery is unconfirmed. Another copy is blocked until the earlier attempt has been checked.</p>}
    {delivery?.status === "failed" && <p className="planner-client-helper">The email service rejected this attempt.{delivery.last_error ? ` ${delivery.last_error}` : ""}</p>}
    {delivery?.last_error && ["not_sent", "accepted"].includes(delivery.status) && <p className="planner-client-helper">{delivery.last_error}</p>}
    {delivery && !delivery.can_send && !["pending", "uncertain"].includes(delivery.status) && <p className="planner-client-helper">{cooldown ? `Another planner email to this address is available after ${cooldown}. Refresh delivery after that time.` : "Another planner email is not available yet. Refresh delivery to check."}</p>}
    {feedback && <p className="planner-client-feedback" role="status" aria-live="polite">{feedback}</p>}
    {open && <section className="planner-client-draft" aria-labelledby={`${id}-heading`} aria-busy={busy || checking}>
      <h4 id={`${id}-heading`} ref={draftHeading} tabIndex={-1}>Review the planner email</h4>
      <p>This sends one email to this client. Review the details, then choose Send planner email.</p>
      <dl className="planner-email-addresses"><div><dt>From</dt><dd>{sender}</dd></div><div><dt>To</dt><dd>{recipient}</dd></div></dl>
      <label htmlFor={`${id}-subject`}>Subject</label><Input id={`${id}-subject`} readOnly value={subject} onFocus={event => event.target.select()} />
      <label htmlFor={`${id}-body`}>Message</label><Textarea id={`${id}-body`} readOnly rows={11} value={body} onFocus={event => event.target.select()} />
      <p className="planner-client-helper">Planner link: <span>{plannerUrl}</span></p>
      {!allowed && !checking && <p className="planner-client-helper">{["pending", "uncertain"].includes(delivery?.status || "") ? "The earlier delivery needs to finish or be checked before another email can be sent." : "Sending is unavailable right now. Refresh delivery to check the current status."}</p>}
      <div className="planner-client-draft-actions"><Button type="button" disabled={busy || checking || !allowed} aria-label={`${unconfirmedRequest ? "Retry same planner request" : "Send planner email"} to ${recipient}`} onClick={() => void send()}>{busy ? "Saving email request…" : unconfirmedRequest ? "Retry same request" : "Send planner email"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); trigger.current?.focus(); }}>Cancel</Button></div>
      <p className="planner-client-helper">No bulk sending. Recent or unresolved emails to the same client are blocked to prevent duplicates.</p>
    </section>}
  </section>;
}
