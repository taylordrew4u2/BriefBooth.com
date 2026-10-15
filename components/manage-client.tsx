"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/supabase";
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!token) return;
    async function load() {
      try {
        const { data, error } = await db().rpc("booking_details", {
          p_token: token!,
        });
        if (error || !data?.length)
          throw new Error(
            "This booking link is invalid or no longer available.",
          );
        setBooking(data[0]);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Unable to load booking.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);
  async function cancel() {
    setBusy(true);
    const { data, error } = await db().rpc("cancel_booking", {
      p_token: token!,
    });
    setBusy(false);
    if (error || !data)
      setMessage(
        "This booking could not be cancelled. It may have already started or been cancelled.",
      );
    else {
      setBooking({ ...booking!, status: "cancelled" });
      setConfirm(false);
      setMessage("Your booking has been cancelled.");
    }
  }
  return (
    <>
      <header className="simple-header">
        <Logo />
        <Link href="/">Home ↗</Link>
      </header>
      <main id="main" className="manage-card">
        {loading ? (
          <p role="status">Loading your booking…</p>
        ) : booking ? (
          <>
            <div className="confirmation-check">
              {booking.status === "confirmed" ? "✓" : "×"}
            </div>
            <h1>
              {booking.status === "confirmed"
                ? "You’re on the calendar."
                : "Your booking is cancelled."}
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
            {booking.status === "confirmed" && (
              <>
                <p>
                  Save this private link. It’s how you access and manage your
                  booking. No confirmation email is sent.
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
                  <p>Your consultant will arrange meeting details with you.</p>
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
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
      </main>
    </>
  );
}
