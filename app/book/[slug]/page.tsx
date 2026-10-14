"use client";
import { use, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/site-header";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  db,
  demoProfile,
  demoServices,
  Profile,
  Service,
} from "@/lib/supabase";
export default function Booking({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const router = useRouter();
  const bookingRequest = useRef<{ key: string; id: string } | null>(null);
  const { slug } = use(params);
  const demo = slug === "demo";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [service, setService] = useState<Service | null>(null);
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState("");
  const [stage, setStage] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  useEffect(() => {
    let live = true;
    async function load() {
      await Promise.resolve();
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      try {
        if (demo) {
          setProfile(demoProfile);
          setServices(demoServices);
        } else {
          const { data: p, error } = await db()
            .from("profiles")
            .select("*")
            .eq("slug", slug)
            .eq("published", true)
            .single();
          if (error)
            throw new Error(
              "This booking page is unavailable. Check the link or contact your consultant.",
            );
          const { data: s, error: se } = await db()
            .from("services")
            .select("*")
            .eq("owner_id", p.id)
            .eq("active", true)
            .order("duration");
          if (se) throw se;
          if (live) {
            setProfile({ ...p, meeting_url: "" });
            setServices(s || []);
          }
        }
      } catch (e) {
        if (live)
          setMessage(
            e instanceof Error ? e.message : "Unable to load booking page.",
          );
      } finally {
        if (live) setLoading(false);
      }
    }
    load();
    return () => {
      live = false;
    };
  }, [slug, demo]);
  useEffect(() => {
    if (!service || !day) return;
    let live = true;
    async function load() {
      await Promise.resolve();
      if (!live) return;
      setSlots([]);
      setSlot("");
      setBusy(true);
      setMessage("");
      try {
        if (demo) {
          const now = Date.now();
          setSlots(
            [9, 10, 11, 13, 14, 15]
              .map((h) =>
                new Date(
                  day + "T" + String(h).padStart(2, "0") + ":00:00",
                ).toISOString(),
              )
              .filter((s) => Date.parse(s) > now + 7200000),
          );
        } else {
          const { data, error } = await db().rpc("available_slots", {
            p_service: service!.id,
            p_day: day,
          });
          if (error) throw error;
          if (live)
            setSlots(
              (data || []).map((r: { starts_at: string }) => r.starts_at),
            );
        }
      } catch (e) {
        if (live)
          setMessage(
            e instanceof Error
              ? e.message
              : "Unable to load times. Please retry.",
          );
      } finally {
        if (live) setBusy(false);
      }
    }
    load();
    return () => {
      live = false;
    };
  }, [service, day, demo]);
  function dates() {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: profile?.timezone || timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return Array.from({ length: 60 }, (_, i) => {
      const date = new Date(today + "T12:00:00Z");
      date.setUTCDate(date.getUTCDate() + i);
      return {
        value: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          weekday: "short",
          timeZone: "UTC",
        }),
      };
    });
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (demo) {
      setConfirmed(true);
      return;
    }
    setBusy(true);
    setMessage("");
    const f = new FormData(e.currentTarget);
    if (f.get("website")) {
      setBusy(false);
      return;
    }
    try {
      const requestKey = service!.id + slot + String(f.get("email"));
      if (bookingRequest.current?.key !== requestKey)
        bookingRequest.current = { key: requestKey, id: crypto.randomUUID() };
      const { data, error } = await db().rpc("create_booking", {
        p_request: bookingRequest.current.id,
        p_service: service!.id,
        p_start: slot,
        p_name: String(f.get("name")),
        p_email: String(f.get("email")),
        p_notes: String(f.get("notes")),
      });
      if (error) throw error;
      router.push("/manage/" + data);
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "We could not book that time. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="simple-header">
        <Logo />
        <Link href="/">About BriefBooth ↗</Link>
      </header>
      <main id="main" className="booking-shell">
        {demo && (
          <div className="demo-banner">
            Interactive demo · Alex is an example consultant. No real
            appointment will be created.
          </div>
        )}
        {loading ? (
          <p role="status">Loading booking page…</p>
        ) : !profile ? (
          <div className="error-state">
            <h1>We couldn’t open this page.</h1>
            <p role="alert">{message}</p>
            <Link className="button" href="/">
              Go to BriefBooth
            </Link>
          </div>
        ) : (
          <div className="booking-layout">
            <section className="consultant-panel">
              <div className="avatar large">
                {profile.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <h1>{profile.name}</h1>
              <p className="consultant-headline">{profile.headline}</p>
              <p className="consultant-bio">{profile.bio}</p>
              {service && (
                <div className="selected-service">
                  <h2>{service.title}</h2>
                  <p>{service.description}</p>
                  <span>
                    {service.duration} minutes ·{" "}
                    {profile.meeting_url
                      ? "Online consultation"
                      : "Meeting details arranged by consultant"}
                  </span>
                </div>
              )}
              <div className="booking-brand">
                Scheduling with <strong>BriefBooth</strong>
              </div>
            </section>
            <section className="booking-main">
              {confirmed ? (
                <div className="confirmation">
                  <div className="confirmation-check">✓</div>
                  <h2>That’s how easy booking feels.</h2>
                  <p>This was a demo. No appointment was created.</p>
                  <Link href="/account?mode=signup" className="button">
                    Create your own booking page ↗
                  </Link>
                  <button
                    className="text-link"
                    onClick={() => {
                      setConfirmed(false);
                      setStage(0);
                      setService(null);
                    }}
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <>
                  {stage > 0 && (
                    <button
                      className="back-button"
                      onClick={() => {
                        setStage(stage - 1);
                        setMessage("");
                      }}
                    >
                      ← Back
                    </button>
                  )}
                  <h2>
                    {stage === 0
                      ? "What can we help with?"
                      : stage === 1
                        ? "Find a time that works."
                        : "Let’s make it official."}
                  </h2>
                  <p className="section-subtitle">
                    {stage === 0
                      ? "Choose a consultation to get started."
                      : stage === 1
                        ? "Choose a date, then an available time."
                        : "Just a few details before we confirm your consultation."}
                  </p>
                  {stage === 0 ? (
                    <div className="service-list">
                      {services.length === 0 ? (
                        <p>
                          No consultations are available yet. Please contact the
                          consultant.
                        </p>
                      ) : (
                        services.map((s) => (
                          <button
                            className="service-option"
                            key={s.id}
                            onClick={() => {
                              setService(s);
                              setStage(1);
                              setDay("");
                              setSlot("");
                            }}
                          >
                            <div>
                              <h3>{s.title}</h3>
                              <p>{s.description}</p>
                              <span>{s.duration} min</span>
                            </div>
                            <span className="service-arrow" aria-hidden="true">
                              ↗
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : stage === 1 ? (
                    <>
                      <label>
                        Choose a date{" "}
                        <span className="field-help">
                          in {profile.timezone}
                        </span>
                        <select
                          value={day}
                          onChange={(e) => setDay(e.target.value)}
                        >
                          <option value="">Select a day</option>
                          {dates().map((d) => (
                            <option value={d.value} key={d.value}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Your timezone
                        <select
                          value={timezone}
                          onChange={(e) => setTimezone(e.target.value)}
                        >
                          {Array.from(
                            new Set([
                              timezone,
                              ...Intl.supportedValuesOf("timeZone"),
                            ]),
                          ).map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>
                      {day && (
                        <>
                          <h3 className="times-title">Available times</h3>
                          <div className="time-grid">
                            {busy ? (
                              <p role="status">Finding available times…</p>
                            ) : slots.length === 0 ? (
                              <p>
                                No times available on this day. Please choose
                                another date.
                              </p>
                            ) : (
                              slots.map((s) => (
                                <button
                                  key={s}
                                  onClick={() => setSlot(s)}
                                  className={
                                    slot === s
                                      ? "time-option active"
                                      : "time-option"
                                  }
                                  aria-pressed={slot === s}
                                >
                                  {new Date(s).toLocaleTimeString(undefined, {
                                    hour: "numeric",
                                    minute: "2-digit",
                                    timeZone: timezone,
                                  })}
                                </button>
                              ))
                            )}
                          </div>
                          {slot && (
                            <Button
                              className="form-submit"
                              onClick={() => setStage(2)}
                            >
                              Enter your details{" "}
                              <span aria-hidden="true">→</span>
                            </Button>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="appointment-summary">
                        <strong>{service?.title}</strong>
                        <span>
                          {new Date(slot).toLocaleString(undefined, {
                            dateStyle: "full",
                            timeStyle: "short",
                            timeZone: timezone,
                          })}
                        </span>
                        <small>
                          {timezone} · {service?.duration} minutes
                        </small>
                      </div>
                      <form onSubmit={submit}>
                        <div className="form-row">
                          <label>
                            Your name
                            <Input
                              name="name"
                              autoComplete="name"
                              required
                              maxLength={100}
                              placeholder="Full name"
                            />
                          </label>
                          <label>
                            Email address
                            <Input
                              name="email"
                              autoComplete="email"
                              type="email"
                              maxLength={254}
                              required
                              placeholder="you@example.com"
                            />
                          </label>
                        </div>
                        <label>
                          What would you like to discuss?{" "}
                          <span className="field-help">Optional</span>
                          <Textarea
                            name="notes"
                            rows={3}
                            maxLength={2000}
                            placeholder="A little context helps make the most of our time."
                          />
                        </label>
                        <label className="honeypot" aria-hidden="true">
                          Website
                          <Input
                            name="website"
                            tabIndex={-1}
                            autoComplete="off"
                          />
                        </label>
                        <p className="privacy-note">
                          Your details are shared with {profile.name} to arrange
                          this consultation. Save the private link shown after
                          booking to manage your appointment.
                        </p>
                        <Button
                          type="submit"
                          className="form-submit"
                          disabled={busy}
                        >
                          {busy
                            ? "Confirming…"
                            : demo
                              ? "Try demo booking"
                              : "Confirm booking"}{" "}
                          <span aria-hidden="true">↗</span>
                        </Button>
                      </form>
                    </>
                  )}
                  {message && (
                    <p className="notice" role="alert">
                      {message}
                    </p>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </>
  );
}
