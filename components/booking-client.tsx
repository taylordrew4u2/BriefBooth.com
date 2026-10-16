"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { PriceBreakdown } from "./price-breakdown";
import { money, priceBreakdown } from "@/lib/pricing";
import { paymentAction } from "@/lib/payments";
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
export default function Booking() {
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const bookingRequest = useRef<{ key: string; id: string } | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => {
    Promise.resolve().then(() =>
      setSlug(window.location.pathname.split("/")[2] || ""),
    );
  }, []);
  const demo = slug === "demo";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [service, setService] = useState<Service | null>(null);
  const [meetingMode, setMeetingMode] = useState("zoom");
  const [day, setDay] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState("");
  const [stage, setStage] = useState(0);
  const [intakeStep, setIntakeStep] = useState(0);
  const [intake, setIntake] = useState({ name: "", email: "", notes: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  useEffect(() => { stepHeading.current?.focus(); }, [stage, intakeStep]);
  useEffect(() => {
    if (slug === null) return;
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
            .eq("slug", slug!)
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
            setProfile({ ...p, meeting_url: "", in_person_address: "" });
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
  function continueIntake(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("website")) return;
    if (intakeStep === 0) {
      setIntake({ name: String(f.get("name")).trim(), email: String(f.get("email")).trim(), notes: "" });
    } else {
      const question = profile!.intake_questions[intakeStep - 1];
      const answer = String(f.get("answer-" + question.id) || "").trim();
      if (question.required && !answer) { setMessage("Add a quick answer before continuing."); return; }
      setAnswers(previous => ({ ...previous, [question.id]: answer }));
    }
    if (intakeStep < (profile?.intake_questions.length || 0)) setIntakeStep(intakeStep + 1);
    else setStage(1);
    setMessage("");
  }
  async function submit() {
    if (demo) {
      setConfirmed(true);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const requestKey = service!.id + slot + intake.email + meetingMode;
      if (bookingRequest.current?.key !== requestKey)
        bookingRequest.current = { key: requestKey, id: crypto.randomUUID() };
      const booking = {
        p_request: bookingRequest.current.id,
        p_service: service!.id,
        p_start: slot,
        p_name: intake.name,
        p_email: intake.email,
        p_answers: answers,
        p_meeting_mode: meetingMode,
      };
      if (service!.amount_cents > 0) {
        const result = await paymentAction("checkout", { booking, expected_total: priceBreakdown(service!.amount_cents).total });
        const checkout = new URL(result.url);
        if (checkout.protocol !== "https:" || checkout.hostname !== "checkout.stripe.com") throw new Error("Invalid checkout link.");
        window.location.assign(checkout.href);
        return;
      }
      const { data, error } = await db().rpc("book_consultation", booking);
      if (error) throw error;
      window.location.assign(
        new URL("/manage/" + data + "/", window.location.origin).href,
      );
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
              {profile.bio && <details className="consultant-bio-mobile"><summary>About your consultant</summary><p>{profile.bio}</p></details>}
              {service && (
                <div className="selected-service">
                  <h2>{service.title}</h2>
                  <p>{service.description}</p>
                  <span>
                    {service.duration} minutes ·{" "}
                    {service.meeting_modes
                      .map((mode) =>
                        mode === "in_person" ? "In person" : "Zoom",
                      )
                      .join(" or ")}
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
                      setIntakeStep(0);
                      setService(null);
                    }}
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <>
                  {(stage > 0 || intakeStep > 0) && (
                    <button
                      className="back-button"
                      onClick={() => {
                        if (stage === 0) setIntakeStep(intakeStep - 1);
                        else setStage(stage - 1);
                        setMessage("");
                      }}
                    >
                      ← Back
                    </button>
                  )}
                  {stage === 0 && (
                    <div className="intake-progress">
                      <span>Getting to know you · {intakeStep + 1} of {profile.intake_questions.length + 1}</span>
                      <progress aria-label="Questionnaire progress" value={intakeStep + 1} max={profile.intake_questions.length + 1}/>
                    </div>
                  )}
                  <h2 id="intake-step-title" ref={stepHeading} tabIndex={-1}>
                    {stage === 0
                      ? intakeStep === 0 ? "Let’s start with you." : profile.intake_questions[intakeStep - 1]?.label
                      : stage === 1
                        ? "Choose your consultation."
                        : "Find a time that works."}
                  </h2>
                  <p className="section-subtitle">
                    {stage === 0
                      ? intakeStep === 0 ? "A few quick answers, then we’ll find a time. No account needed." : "One question at a time. A sentence or two is plenty."
                      : stage === 1
                        ? "Nice, your answers are ready. What would you like to book?"
                        : "Choose a date and an available time, then confirm your consultation."}
                  </p>
                  {stage === 1 ? (
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
                              setMeetingMode(s.meeting_modes[0]);
                              setStage(2);
                              setDay("");
                              setSlot("");
                            }}
                          >
                            <div>
                              <h3>{s.title}</h3>
                              <p>{s.description}</p>
                              <span>{s.duration} min · {s.amount_cents ? money(priceBreakdown(s.amount_cents).total) + " total" : "Free"}</span>
                            </div>
                            <span className="service-arrow" aria-hidden="true">
                              ↗
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : stage === 2 ? (
                    <>
                        <fieldset className="meeting-options">
                          <legend>How would you like to meet?</legend>
                          <div className="meeting-options-grid">
                            {service?.meeting_modes.map((mode) => (
                              <label className="meeting-mode-option" key={mode}>
                                <Input
                                  type="radio"
                                  name="meeting_mode"
                                  value={mode}
                                  checked={meetingMode === mode}
                                  onChange={() => setMeetingMode(mode)}
                                />
                                <span>
                                  {mode === "in_person"
                                    ? "In-person consultation"
                                    : "Consultation via Zoom"}
                                </span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
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
                                  {timezone} · {service?.duration} minutes ·{" "}
                                  {meetingMode === "in_person"
                                    ? "In person"
                                    : "Zoom"}
                                </small>
                              </div>
                              <PriceBreakdown amount={service?.amount_cents || 0} />
                              <Button
                                className="form-submit"
                                onClick={submit}
                                disabled={busy}
                              >
                                {busy
                                  ? "Confirming…"
                                  : demo
                                    ? "Try demo booking"
                                    : service?.amount_cents ? "Continue to secure checkout" : "Confirm booking"}{" "}
                                <span aria-hidden="true">→</span>
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <form onSubmit={continueIntake}>

                        {intakeStep === 0 && <div className="form-row">
                          <label>
                            Your name
                            <Input
                              name="name"
                              defaultValue={intake.name}
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
                              defaultValue={intake.email}
                              autoComplete="email"
                              type="email"
                              maxLength={254}
                              required
                              placeholder="you@example.com"
                            />
                          </label>
                        </div>}
                        {profile.intake_questions.filter((_, i) => i === intakeStep - 1).map(q => (
                          <label key={q.id}>
                            Your answer <span className="field-help">{q.required ? "Required" : "Optional"}</span>
                            {q.type === "short" ? (
                              <Input aria-labelledby="intake-step-title" name={"answer-" + q.id} value={answers[q.id] || ""} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})} required={q.required} maxLength={1500} />
                            ) : (
                              <Textarea aria-labelledby="intake-step-title" name={"answer-" + q.id} value={answers[q.id] || ""} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})} required={q.required} maxLength={1500} rows={4} />
                            )}
                          </label>
                        ))}
                        <label className="honeypot" aria-hidden="true">
                          Website
                          <Input
                            name="website"
                            tabIndex={-1}
                            autoComplete="off"
                          />
                        </label>
                        <p className="privacy-note">
                          Your answers are sent to {profile.name} when you confirm
                          your booking and included in your confirmation email.
                        </p>
                        <Button
                          type="submit"
                          className="form-submit"
                          disabled={busy}
                        >
                          {intakeStep < profile.intake_questions.length ? "Continue" : "Choose a consultation"} <span aria-hidden="true">→</span>
                        </Button>
                        {intakeStep > 0 && !profile.intake_questions[intakeStep - 1].required && (
                          <button type="button" className="text-link" onClick={() => {
                            setAnswers({...answers,[profile.intake_questions[intakeStep - 1].id]:""});
                            setMessage("");
                            if(intakeStep < profile.intake_questions.length) setIntakeStep(intakeStep + 1);
                            else setStage(1);
                          }}>Skip for now</button>
                        )}
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
