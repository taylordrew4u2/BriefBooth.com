"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { paymentAction, stripeRedirect } from "@/lib/payments";
import { PriceBreakdown } from "@/components/price-breakdown";
import { priceBreakdown, money } from "@/lib/pricing";
import { ProfileAvatar } from "@/components/profile-avatar";
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
  const submittingRequest = useRef(false);
  const [submitting, setSubmitting] = useState(false);
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
  const visit=useRef<string|null>(null);
  useEffect(()=>{
    if(!profile||demo||navigator.doNotTrack==='1')return;
    if(!visit.current)visit.current=crypto.randomUUID();
    const event=confirmed?'submitted':stage>=2?'schedule':(stage>=1||intakeStep>0)?'intake':'view';
    void db().rpc('record_funnel',{p_owner:profile.id,p_visit:visit.current,p_stage:event});
  },[profile,demo,stage,intakeStep,confirmed]);
  useEffect(() => { stepHeading.current?.focus(); }, [stage, intakeStep, confirmed]);
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
    let live = true;
    async function load() {
      await Promise.resolve();
      if (!live) return;
      setSlots([]);
      setSlot("");
      if (!service || !day) { setBusy(false); return; }
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
      if (!String(f.get("name") || "").trim()) { setMessage("Please enter your name before continuing."); return; }
      setIntake({ name: String(f.get("name")).trim(), email: String(f.get("email")).trim(), notes: "" });
    } else {
      const question = profile!.intake_questions[intakeStep - 1];
      const answer = question.type === "multiple" ? f.getAll("answer-" + question.id).map(String).join("\n") : String(f.get("answer-" + question.id) || "").trim();
      if (question.required && !answer) { setMessage("Add a quick answer before continuing."); return; }
      setAnswers(previous => ({ ...previous, [question.id]: answer }));
    }
    if (intakeStep < (profile?.intake_questions.length || 0)) setIntakeStep(intakeStep + 1);
    else setStage(1);
    setMessage("");
  }
  async function submit() {
    if (submittingRequest.current || busy || !service || !slot) return;
    if (demo) {
      setConfirmed(true);
      return;
    }
    submittingRequest.current = true;
    setSubmitting(true);
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
      if (service.amount_cents > 0) {
        const result = await paymentAction("checkout", { booking, expected_total: priceBreakdown(service.amount_cents).total });
        if(profile&&visit.current&&navigator.doNotTrack!=='1')void db().rpc('record_funnel',{p_owner:profile.id,p_visit:visit.current,p_stage:'submitted'});
        stripeRedirect(result.url);
        return;
      }
      const { data, error } = await db().rpc("book_consultation", booking);
      if (error) throw error;
      if (typeof data !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) throw new Error("We couldn’t verify the booking response. Please try again; your request will not be duplicated.");
      if(profile&&visit.current&&navigator.doNotTrack!=='1')await Promise.race([Promise.resolve(db().rpc('record_funnel',{p_owner:profile.id,p_visit:visit.current,p_stage:'submitted'})).catch(()=>{}),new Promise(resolve=>setTimeout(resolve,500))]);
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
      submittingRequest.current = false;
      setSubmitting(false);
    }
  }
  return (
    <>
      <header className="simple-header">
        <Logo />
        <Link href="/">About BriefBooth ↗</Link>
      </header>
      <main id="main" className="booking-shell booking-experience">
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
              <ProfileAvatar name={profile.name} image={profile.avatar_data} />
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
                        mode === "in_person" ? "In person" : mode === "google_meet" ? "Google Meet" : "Zoom",
                      )
                      .join(" or ")}
                  </span>
                </div>
              )}
              <div className="conversation-art" aria-hidden="true">
                <span className="art-bubble">Your next big idea</span>
                <svg viewBox="0 0 64 64" fill="currentColor"><path d="M6 17 24 10 58 13 58 20 24 17 6 23Z M8 26 24 20 24 60 8 54Z M42 26 56 22 56 58 42 53Z M28 40 38 39 38 45 28 46Z M28 48 41 46 47 48 47 51 28 53Z"/></svg>
                <span className="art-spark">✦</span><span className="art-caption">starts with a conversation.</span>
              </div>
              <div className="booking-brand">
                Scheduling with <strong>BriefBooth</strong>
              </div>
            </section>
            <section className="booking-main">
              {confirmed ? (
                <div className="confirmation">
                  <div className="confirmation-check">✓</div>
                  <h2 ref={stepHeading} tabIndex={-1}>That’s how easy booking feels.</h2>
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
                  <ol className="booking-journey" aria-label="Booking steps">
                    {["About you", "Consultation", "Choose a time"].map((label, index) => (
                      <li key={label} aria-current={stage === index ? "step" : undefined} className={stage >= index ? "reached" : ""}><span aria-hidden="true">{stage > index ? "✓" : index + 1}</span>{label}</li>
                    ))}
                  </ol>
                  {(stage > 0 || intakeStep > 0) && (
                    <button
                      className="back-button"
                      disabled={submitting}
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
                      <div className="intake-progress-label"><span>{intakeStep === 0 ? "A friendly hello" : intakeStep === profile.intake_questions.length ? "Last question. You’ve got this." : "Your ideas are taking shape"}</span><strong>{intakeStep + 1} / {profile.intake_questions.length + 1}</strong></div>
                      <progress aria-label="Questionnaire progress" aria-valuetext={`Question ${intakeStep + 1} of ${profile.intake_questions.length + 1}`} value={intakeStep + 1} max={profile.intake_questions.length + 1}/>
                    </div>
                  )}
                  <div className="question-chapter" aria-hidden="true" key={`${stage}-${intakeStep}`}>
                    <span className="chapter-symbol">{stage === 0 ? intakeStep === 0 ? "✳" : "✦" : stage === 1 ? "↗" : "◷"}</span>
                    <span>{stage === 0 ? intakeStep === 0 ? "NICE TO MEET YOU" : `A LITTLE ABOUT YOUR IDEAS · ${String(intakeStep).padStart(2, "0")}` : stage === 1 ? "MAKE IT YOURS" : "LET’S MAKE TIME"}</span>
                  </div>
                  <h2 id="intake-step-title" aria-describedby={stage === 0 ? "intake-step-guidance" : undefined} ref={stepHeading} tabIndex={-1}>
                    {stage === 0
                      ? intakeStep === 0 ? "Let’s start with you." : profile.intake_questions[intakeStep - 1]?.label
                      : stage === 1
                        ? "Choose your consultation."
                        : "Find a time that works."}
                  </h2>
                  <p className="section-subtitle" id="intake-step-guidance">
                    {stage === 0
                      ? intakeStep === 0 ? "A few quick answers, then we’ll find a time. No account needed." : profile.intake_questions[intakeStep - 1]?.type === "multiple" ? "Choose everything that fits. You can select more than one." : "One question at a time. A sentence or two is plenty."
                      : stage === 1
                        ? "Nice, your answers are ready. What would you like to book?"
                        : "Choose a date and an available time."}
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
                              <span>{s.duration} min · {s.amount_cents ? money(priceBreakdown(s.amount_cents).total) + " total" : "Free to book"}</span>
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
                        <fieldset className="meeting-options" disabled={submitting}>
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
                                    : mode === "google_meet" ? "Consultation via Google Meet" : "Consultation via Zoom"}
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
                          disabled={submitting}
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
                          disabled={submitting}
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
                          <p className="sr-only" role="status" aria-atomic="true">{busy ? "Loading available times." : `${slots.length} available times for the selected date.`}</p>
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
                                  disabled={submitting}
                                  onClick={() => setSlot(s)}
                                  className={
                                    slot === s
                                      ? "time-option active"
                                      : "time-option"
                                  }
                                  aria-pressed={slot === s}
                                >
                                  {slot === s && <span aria-hidden="true">✓ </span>}
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
                                    : meetingMode === "google_meet" ? "Google Meet" : "Zoom"}
                                </small>
                              </div>
                              {service && service.amount_cents > 0 ? <div className="inset-form">
                                <PriceBreakdown amount={service.amount_cents} />
                                <p>{profile.booking_mode === "approval" ? "Pay now to send your request. Your consultant must still approve it before the meeting is confirmed. If declined, contact the consultant for a refund." : "Your booking is confirmed after Stripe verifies payment."} Cancellations do not automatically refund payments. Your consultant handles refunds.</p>
                              </div> : profile.payment_methods?.length || profile.payment_notes?.trim() ? <div className="inset-form">
                                <h3>Negotiate with consultant</h3>
                                <p>{profile.booking_mode === "approval" ? "Your consultant must approve this request before the meeting is confirmed. " : ""}Free to book. No payment is collected here. Agree on any consultation fee directly with your consultant.</p>
                                {!!profile.payment_methods?.length && <p><strong>Accepted methods:</strong> {profile.payment_methods.join(", ")}</p>}
                                {profile.payment_notes && <p style={{whiteSpace: "pre-wrap"}}>{profile.payment_notes}</p>}
                              </div> : <div className="inset-form">
                                <h3>Free consultation</h3>
                                <p>No payment is needed for this consultation.{profile.booking_mode === "approval" ? " Your consultant will review your request before confirming the meeting." : " Choose Confirm booking to reserve this time."}</p>
                              </div>}
                              <Button
                                className="form-submit"
                                onClick={submit}
                                disabled={busy || submitting}
                              >
                                {submitting
                                  ? profile.booking_mode === "approval" ? "Sending request…" : "Confirming…"
                                  : demo
                                    ? "Try demo booking"
                                    : service && service.amount_cents > 0 ? "Continue to secure payment" : profile.booking_mode === "approval" ? "Send consultation request" : "Confirm booking"}{" "}
                                <span aria-hidden="true">→</span>
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <form className="intake-answer-card" onSubmit={continueIntake}>

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
                          q.type === "multiple" ? <fieldset key={q.id} className="intake-choices" aria-describedby={`answer-help-${q.id}`}><legend className="sr-only">{q.label}</legend><p id={`answer-help-${q.id}`} className="field-help">Select all that apply. {q.required ? "Choose at least one." : "Optional."}</p>{q.options?.map(option => <label key={option} className="intake-choice"><input type="checkbox" name={"answer-" + q.id} value={option} checked={(answers[q.id] || "").split("\n").includes(option)} onChange={e => { const selected = new Set((answers[q.id] || "").split("\n").filter(Boolean)); if(e.target.checked) selected.add(option); else selected.delete(option); setAnswers({...answers,[q.id]:q.options!.filter(item=>selected.has(item)).join("\n")}); }}/><span>{option}</span></label>)}</fieldset> : <label key={q.id}>
                            Your answer <span id={`answer-help-${q.id}`} className="field-help">{q.required ? "Required answer" : "Optional — you can skip this question"}. Up to 1,500 characters.</span>
                            {q.type === "short" ? (
                              <Input aria-labelledby="intake-step-title" aria-describedby={`answer-help-${q.id}`} name={"answer-" + q.id} value={answers[q.id] || ""} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})} required={q.required} maxLength={1500} />
                            ) : (
                              <Textarea aria-labelledby="intake-step-title" aria-describedby={`answer-help-${q.id}`} name={"answer-" + q.id} value={answers[q.id] || ""} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})} required={q.required} maxLength={1500} rows={4} />
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
                          {intakeStep < profile.intake_questions.length ? "Continue" : "Choose consultation"} <span aria-hidden="true">→</span>
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
