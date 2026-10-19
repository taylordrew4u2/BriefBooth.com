"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/supabase";
import { pollSequentially } from "@/lib/polling";
import { paymentAction, stripeRedirect } from "@/lib/payments";
import { PriceBreakdown } from "./price-breakdown";
import { calendarFile } from "@/lib/calendar";
type Details = {
  client_name: string;
  title: string;
  consultant: string;
  starts_at: string;
  ends_at: string;
  status: string;
  meeting_url: string;
  meeting_mode: string;
  in_person_address: string;
};
export default function Manage() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    Promise.resolve().then(() =>
      setToken(window.location.pathname.split("/")[2] || ""),
    );
  }, []);
  const [booking, setBooking] = useState<Details | null>(null);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [payment, setPayment] = useState<{amount:number;total:number;paid:boolean;status:string;url:string|null}|null>(null);
  const [paymentError, setPaymentError] = useState("");
  useEffect(() => {
    if (!token) return;
    return pollSequentially(async () => paymentAction("status", {token}), result => {
      setPayment(result.payment); setPaymentError("");
    }, () => setPaymentError("Payment status could not be verified. If you paid, do not pay again; refresh this page or contact your consultant."));
  }, [token]);
  useEffect(() => {
    if (!token || busy) return;
    return pollSequentially(async () => {
      const { data, error } = await db().rpc("booking_details", { p_token: token });
      if(error) throw new Error("We couldn’t refresh this booking. Check your connection; this page will retry automatically.");
      if(!data?.length) throw new Error("This booking link is invalid or no longer available.");
      return data[0];
    }, value => {
      setBooking(value); setLoadError(""); setLoading(false);
    }, error => {
      setLoadError(error instanceof Error ? error.message : "Unable to load booking."); setLoading(false);
    });
  }, [token, busy]);
  async function cancel() {
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await db().rpc("cancel_booking", { p_token: token! });
      if (error || !data) {
        setMessage("This booking could not be cancelled. It may have already started or been cancelled. Refresh the page to check its status.");
      } else {
        setBooking({ ...booking!, status: "cancelled" });
        setConfirm(false);
        setMessage("Your booking has been cancelled.");
      }
    } catch {
      setMessage("Connection interrupted. Refresh to check whether cancellation went through before trying again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="simple-header">
        <Logo />
        <Link href="/">Home ↗</Link>
      </header>
      <main id="main" className="manage-card">
        <p className="sr-only" role="status" aria-atomic="true">{booking ? `Booking status: ${booking.status.replaceAll("_", " ")}.${booking.status === "confirmed" && booking.meeting_url ? " Your Zoom meeting link is ready." : ""}` : ""}</p>
        {loading ? (
          <p role="status">Loading your booking…</p>
        ) : booking ? (
          <>
            <div className="confirmation-check">
              {booking.status === "confirmed" ? "✓" : booking.status === "pending_approval" ? "…" : "×"}
            </div>
            <h1>
              {booking.status === "confirmed"
                ? "You’re on the calendar."
                : booking.status === "pending_approval" ? "Your request is awaiting approval." : booking.status === "declined" ? "Your request was declined." : booking.status === "pending_payment" ? "Your time is held for checkout." : booking.status === "payment_processing" ? "Your payment is processing." : booking.status === "expired" ? "Your checkout has expired." : "Your booking is cancelled."}
            </h1>
            <p>
              {booking.title} with {booking.consultant}
            </p>
            <div className="appointment-summary">
              <strong>
                {new Date(booking.starts_at).toLocaleDateString(undefined, {
                  dateStyle: "full",
                })}
              </strong>
              <span>
                {new Date(booking.starts_at).toLocaleTimeString(undefined, {
                  timeStyle: "short",
                })}{" "}
                –{" "}
                {new Date(booking.ends_at).toLocaleTimeString(undefined, {
                  timeStyle: "short",
                })}
              </span>
              <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
            </div>
            {booking.status === "pending_approval" && <p>Your consultant will review your intake and requested time. Meeting details will be emailed after approval. This is not a confirmed appointment.</p>}
            {payment ? <div className="inset-form">
              <h3>{payment.paid ? "Payment received" : "Your payment"}</h3>
              <PriceBreakdown amount={payment.amount} total={payment.total} />
              {payment.url && !payment.paid && <Button onClick={() => { try { stripeRedirect(payment.url); } catch { setMessage("Unable to open checkout."); } }}>Continue secure checkout</Button>}
              <p>Cancellation or decline does not automatically issue a refund. Contact your consultant about refunds.</p>
            </div> : !paymentError && <div className="inset-form"><h3>Arrange payment directly</h3><p>No online payment is attached to this booking.</p></div>}
            {paymentError && <p role="status">{paymentError}</p>}
            {booking.status === "pending_approval" && <Button disabled={busy} onClick={cancel}>Cancel request</Button>}
            {booking.status === "confirmed" && (
              <>
                <p>
                  Confirmation emails are queued for you and your consultant.
                  Save this private link to view or cancel your booking, and
                  check your spam folder if the email hasn’t arrived.
                </p>
                <p>
                  <strong>
                    {booking.meeting_mode === "in_person"
                      ? "In-person consultation"
                      : "Consultation via Zoom"}
                  </strong>
                </p>
                {booking.meeting_mode === "in_person" ? (
                  <p>
                    {booking.in_person_address ||
                      "Your consultant will confirm the meeting address with you."}
                  </p>
                ) : booking.meeting_url.startsWith("https://") ? (
                  <a
                    className="button"
                    href={booking.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Join Zoom consultation ↗
                  </a>
                ) : (
                  <p>Your meeting link is being prepared. This page updates automatically. Your confirmation email will include the link once it is ready.</p>
                )}
                <div className="manage-actions">
                  <Button
                    onClick={() =>
                      calendarFile(
                        booking.title + " with " + booking.consultant,
                        booking.starts_at,
                        booking.ends_at,
                        booking.meeting_mode === "in_person"
                          ? booking.in_person_address
                          : booking.meeting_url,
                      )
                    }
                  >
                    Add to calendar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(location.href);
                        setMessage("Private link copied.");
                      } catch {
                        setMessage(
                          "Copy this page’s address from your browser.",
                        );
                      }
                    }}
                  >
                    Copy private link
                  </Button>
                </div>
                {new Date(booking.starts_at) > new Date() &&
                  (confirm ? (
                    <div className="notice">
                      <p>
                        Cancel this appointment? The time will become available
                        to other clients.
                      </p>
                      <Button onClick={cancel} disabled={busy}>
                        {busy ? "Cancelling…" : "Yes, cancel booking"}
                      </Button>
                      <button
                        className="back-button"
                        onClick={() => setConfirm(false)}
                      >
                        Keep booking
                      </button>
                    </div>
                  ) : (
                    <button
                      className="cancel-link"
                      onClick={() => setConfirm(true)}
                    >
                      Cancel booking
                    </button>
                  ))}
              </>
            )}
          </>
        ) : (
          <h1>Booking unavailable</h1>
        )}
        {loadError && <div className="notice" role="status">{loadError}</div>}
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
      </main>
    </>
  );
}
