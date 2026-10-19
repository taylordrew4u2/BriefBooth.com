"use client";
import { ZoomConnection } from "@/components/zoom-connection";
import { IntakeTemplatePicker } from "@/components/intake-template-picker";
import { defaultQuestions } from "@/lib/intake";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AvatarPicker } from "@/components/avatar-picker";
import { Logo } from "@/components/site-header";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { db, configured, Profile, Service } from "@/lib/supabase";
type Hours = {
  weekday: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
};
type Booking = {
  id: string;
  client_name: string;
  client_email: string;
  notes: string;
  starts_at: string;
  ends_at: string;
  status: string;
  service_id: string;
  manage_token: string;
  meeting_mode: string;
};
const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export default function Studio() {
  const router = useRouter();
  const [uid, setUid] = useState("");
  const [siteOrigin, setSiteOrigin] = useState("");
  const [tab, setTab] = useState("overview");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [savedProfile, setSavedProfile] = useState<{slug: string; published: boolean} | null>(null);
  const [savedHours, setSavedHours] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [hours, setHours] = useState<Hours[]>(
    dayNames.map((_, weekday) => ({
      weekday,
      start_time: "09:00",
      end_time: "17:00",
      enabled: weekday > 0 && weekday < 6,
    })),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [bookingFilter, setBookingFilter] = useState("upcoming");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const bookingAction = useRef(false);
  useEffect(() => {
    if (!configured) {
      router.replace("/account");
      return;
    }
    async function load() {
      try {
        const {
          data: { user },
        } = await db().auth.getUser();
        if (!user) {
          router.replace("/account");
          return;
        }
        setSiteOrigin(window.location.origin);
        setUid(user.id);
        const results = await Promise.all([
          db().from("profiles").select("*").eq("id", user.id).maybeSingle(),
          db()
            .from("services")
            .select("*")
            .eq("owner_id", user.id)
            .order("duration"),
          db().from("availability").select("*").eq("owner_id", user.id),
          db()
            .from("bookings")
            .select("*")
            .eq("owner_id", user.id)
            .order("starts_at"),
          db()
            .from("consultant_settings")
            .select("meeting_url,in_person_address")
            .eq("owner_id", user.id)
            .maybeSingle(),
        ]);
        for (const r of results) if (r.error) throw r.error;
        const [p, s, a, b, settings] = results;
        setProfile(
          p.data
            ? {
                ...p.data,
                meeting_url: settings.data?.meeting_url || "",
                in_person_address: settings.data?.in_person_address || "",
              }
            : {
                id: user.id,
                slug: "",
                name: "",
                avatar_data: "",
                headline: "Independent consultant",
                bio: "",
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                meeting_url: "",
                in_person_address: "",
                published: false,
                booking_mode: "instant",
                intake_questions: defaultQuestions,
                payment_methods: [],
                payment_notes: "",
              },
        );
        setSavedProfile(p.data ? {slug: p.data.slug, published: p.data.published} : null);
        setSavedHours(!!a.data?.length);
        setServices(s.data || []);
        setBookings(b.data || []);
        if (a.data?.length)
          setHours(
            dayNames.map((_, weekday) => {
              const h = a.data.find((x) => x.weekday === weekday);
              return {
                weekday,
                start_time: h?.start_time.slice(0, 5) || "09:00",
                end_time: h?.end_time.slice(0, 5) || "17:00",
                enabled: !!h,
              };
            }),
          );
      } catch (e) {
        setMessage(
          e instanceof Error ? e.message : "Unable to load your studio.",
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);
  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) return;
    if (!profile.name.trim() || profile.slug === "demo" || !/^[a-z0-9][a-z0-9-]{2,39}$/.test(profile.slug)) {
      setTab("profile");
      setMessage("First, enter your name and a booking page address, then save your profile.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const { meeting_url, in_person_address, ...publicProfile } = profile;
      const { error } = await db()
        .from("profiles")
        .upsert({ ...publicProfile, id: uid });
      if (error) throw new Error(error.code === "23505" ? "That booking page address is already taken. Please choose another." : error.message);
      const { error: settingsError } = await db()
        .from("consultant_settings")
        .upsert({ owner_id: uid, meeting_url, in_person_address });
      if (settingsError) throw settingsError;
      setSavedProfile({slug: profile.slug, published: profile.published});
      setMessage("Saved. Your booking page is up to date.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save profile.");
    } finally {
      setBusy(false);
    }
  }
  async function savePaymentPreferences(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile || !savedProfile) { setTab("profile"); setMessage("Save your profile before adding payment preferences."); return; }
    setBusy(true); setMessage("");
    try {
      const { error } = await db().from("profiles").update({
        payment_methods: profile.payment_methods || [], payment_notes: profile.payment_notes || "",
      }).eq("id", uid).select("id").single();
      if (error) throw error;
      setMessage("Payment preferences saved.");
    } catch { setMessage("Couldn’t save payment preferences. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  async function saveTimezone() {
    if (!profile || !savedProfile) { setTab("profile"); setMessage("Save your profile before changing its timezone."); return; }
    setBusy(true); setMessage("");
    try {
      const { error } = await db().from("profiles").update({ timezone: profile.timezone }).eq("id", uid).select("id").single();
      if (error) throw error;
      setMessage("Timezone saved.");
    } catch { setMessage("Couldn’t save your timezone. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  async function toggleService(service: Service) {
    setBusy(true); setMessage("");
    try {
      const { error } = await db().from("services").update({active: !service.active}).eq("id", service.id).eq("owner_id",uid).select("id").single();
      if(error) throw error;
      setServices(items => items.map(item => item.id === service.id ? {...item,active:!service.active} : item));
      setMessage(service.active ? "Consultation hidden from your booking page." : "Consultation is available for booking.");
    } catch { setMessage("Couldn’t update this consultation. Refresh to check its status and try again."); }
    finally { setBusy(false); }
  }
  async function addService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!savedProfile) { setTab("profile"); setMessage("Save your profile before adding a consultation."); return; }
    setBusy(true);
    const f = new FormData(e.currentTarget);
    setMessage("");
    try {
      const { data, error } = await db()
        .from("services")
        .insert({
          owner_id: uid,
          title: String(f.get("title")),
          description: String(f.get("description")),
          duration: Number(f.get("duration")),
          amount_cents: 0,
          meeting_modes: String(f.get("meeting_modes")).split(","),
        })
        .select()
        .single();
      if (error) throw error;
      setServices([...services, data]);
      setAdding(false);
      setMessage("Consultation added.");
    } catch {
      setMessage("Couldn’t confirm the consultation was saved. Reload to check before adding it again.");
    } finally { setBusy(false); }
  }

  async function saveHours(e: React.FormEvent) {
    e.preventDefault();
    if (!savedProfile) { setTab("profile"); setMessage("Save your profile before setting your hours."); return; }
    setBusy(true);
    setMessage("");
    const invalid = hours.some((h) => h.enabled && h.end_time <= h.start_time);
    if (invalid) {
      setBusy(false);
      setMessage("Each end time must be after its start time.");
      return;
    }
    try {
      const { error } = await db().rpc("save_availability", {
        p_hours: hours
          .filter((h) => h.enabled)
          .map(({ weekday, start_time, end_time }) => ({
            weekday,
            start_time,
            end_time,
          })),
      });
      if (!error) setSavedHours(hours.some(h => h.enabled));
      setMessage(error ? error.message : "Availability saved.");
    } catch { setMessage("Couldn’t save your hours. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  function updateHour(i: number, patch: Partial<Hours>) {
    setHours(hours.map((h, n) => (n === i ? { ...h, ...patch } : h)));
  }
  const pending = bookings.filter(b => b.status === "pending_approval" && new Date(b.ends_at).getTime() > now);
  const upcoming = bookings.filter(b => b.status === "confirmed" && new Date(b.ends_at).getTime() > now);
  const nextBooking = [...upcoming].sort((a,b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
  const visibleBookings = bookings.filter(b => {
    const future = Date.parse(b.ends_at) > now;
    const matches = bookingFilter === "all" ||
      (bookingFilter === "requests" && future && b.status === "pending_approval") ||
      (bookingFilter === "upcoming" && future && ["confirmed", "pending_approval"].includes(b.status)) ||
      (bookingFilter === "history" && (!future || !["confirmed", "pending_approval"].includes(b.status)));
    const title = services.find(service => service.id === b.service_id)?.title || "";
    return matches && `${b.client_name} ${b.client_email} ${title}`.toLowerCase().includes(search.trim().toLowerCase());
  }).sort((a,b) => bookingFilter === "history" ? Date.parse(b.starts_at)-Date.parse(a.starts_at) : Date.parse(a.starts_at)-Date.parse(b.starts_at));
  async function refreshBookings() {
    if (bookingAction.current) return;
    bookingAction.current = true;
    setRefreshing(true);
    try {
      const {data,error} = await db().from("bookings").select("*").eq("owner_id",uid).order("starts_at");
      if(error) throw error;
      setBookings(data || []); setNow(Date.now()); setMessage("Bookings are up to date.");
    } catch { setMessage("Couldn’t refresh bookings. Please try again."); }
    finally { bookingAction.current = false; setRefreshing(false); }
  }
  async function reviewRequest(bookingId: string, approve: boolean) {
    if (bookingAction.current) return;
    bookingAction.current = true;
    setBusy(true); setMessage("");
    try {
      const {data,error} = await db().rpc("review_booking", {p_booking:bookingId,p_approve:approve});
      if (error || data !== (approve ? "confirmed" : "declined")) throw new Error("Review did not complete");
      setBookings(items => items.map(item => item.id === bookingId ? {...item,status:data} : item));
      setMessage(approve ? "Request approved. Meeting details will be emailed to you and your client." : "Request declined. The client will be notified.");
    } catch { setMessage("Couldn’t update this request. Refresh bookings and try again."); }
    finally { bookingAction.current = false; setBusy(false); }
  }
  return (
    <>
      <header className="studio-header">
        <Logo />
        <nav aria-label="Studio navigation">
          <Link href="/book/demo">Booking demo ↗</Link>
          <button
            onClick={async () => {
              await db().auth.signOut();
              router.push("/");
            }}
          >
            Sign out
          </button>
        </nav>
      </header>
      <main id="main" className="studio-shell">
        <div className="studio-title">
          <div>
            <span className="studio-eyebrow">YOUR CONSULTANT WORKSPACE</span>
            <h1>{profile?.name ? `${profile.name}’s studio` : "Your booking studio"}</h1>
            <p>A little organization. More time for your clients.</p>
          </div>

        </div>
        <div className="studio-workspace">
        <nav className="studio-tabs" aria-label="Manage booking page">
          {["overview", "bookings", "profile", "questionnaire", "consultations", "availability"].map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setMessage("");
              }}
              aria-current={tab === t ? "page" : undefined}
              className={tab === t ? "active" : ""}
            >
              {{overview: "Overview", bookings: "Bookings", profile: "Profile & Zoom", questionnaire: "Intake questions", consultations: "Meeting types", availability: "Availability"}[t]}
            </button>
          ))}
        </nav>
        <div className="studio-content">
        {!loading && profile && tab === "overview" && (
          <section className="studio-overview" aria-label="Studio overview">
            <div className="studio-metrics">
              <button onClick={() => {setTab("bookings"); setBookingFilter("requests");}}><span>Needs your approval</span><strong>{pending.length}</strong><small>Review requests →</small></button>
              <button onClick={() => {setTab("bookings"); setBookingFilter("upcoming");}}><span>Upcoming meetings</span><strong>{upcoming.length}</strong><small>View your schedule →</small></button>
              <button onClick={() => setTab("profile")}><span>Booking page</span><strong className="metric-word">{savedProfile?.published ? "Published" : "Draft"}</strong><small>Edit profile & settings →</small></button>
            </div>
            <div className="studio-next">
              <span className="studio-eyebrow">NEXT CONFIRMED MEETING</span>
              <h2>{nextBooking ? nextBooking.client_name : "Your next conversation starts here."}</h2>
              <p>{nextBooking ? new Date(nextBooking.starts_at).toLocaleString(undefined,{dateStyle:"full",timeStyle:"short"}) : "Share your intake link. Clients answer your questions, then choose a time."}</p>
              {nextBooking && <a className="text-link" href={"/manage/"+nextBooking.manage_token}>View meeting details →</a>}
              {pending.length > 0 && <button className="text-link" onClick={() => {setTab("bookings");setBookingFilter("requests");}}>{pending.length} request{pending.length === 1 ? "" : "s"} waiting for your review →</button>}
            </div>
          </section>
        )}
        {!loading && profile && tab === "overview" && (
          <section className="booking-link-card" aria-labelledby="booking-link-title">
            <h2 id="booking-link-title">Your intake & booking link</h2>
            <p>Share this on your website or send it to a client. They answer your questions first, then choose a consultation and time.</p>
            {savedProfile?.published ? (
              <>
                <label>
                  Your shareable link
                  <Input readOnly value={siteOrigin + "/book/" + savedProfile.slug} onFocus={event => event.target.select()} />
                </label>
                <div className="template-actions">
                  <Button type="button" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(siteOrigin + "/book/" + savedProfile.slug);
                      setMessage("Booking link copied. Paste it into your website or a message to a client.");
                    } catch {
                      setMessage("Select and copy the link in the Your shareable link field above.");
                    }
                  }}>Copy booking link</Button>
                  <a className="button secondary" href={"/book/" + savedProfile.slug} target="_blank" rel="noopener noreferrer">Preview client page ↗</a>
                </div>
                {(!services.some(service => service.active) || !savedHours) && <p className="field-help">Your link is created. Add a consultation and save your weekly hours before inviting clients to book.</p>}
              </>
            ) : (
              <>
                <p>To create your link, enter your name and booking page address in Profile, check “Publish my booking page,” then save.</p>
                <Button type="button" onClick={() => { setTab("profile"); setMessage("Enter your profile details below, check Publish my booking page, and save to create your link."); }}>Set up my booking link</Button>
              </>
            )}
          </section>
        )}
        {!loading && profile && tab === "overview" && (!savedProfile?.published || !services.some(s => s.active) || !savedHours) && (
          <section className="notice" aria-label="Booking page setup">
            <strong>Get your page ready to share</strong>
            <p>Save your profile, add a consultation, and save your weekly hours. Customize your questionnaire whenever you like.</p>
            <div className="form-row">
              <button className="text-link" onClick={() => setTab("profile")}>{savedProfile?.published ? "✓ Profile published" : "1. Save and publish profile"}</button>
              <button className="text-link" onClick={() => setTab("consultations")}>{services.some(s => s.active) ? "✓ Consultation added" : "2. Add a consultation"}</button>
              <button className="text-link" onClick={() => setTab("availability")}>{savedHours ? "✓ Hours saved" : "3. Save weekly hours"}</button>
              <button className="text-link" onClick={() => setTab("questionnaire")}>Customize intake questions</button>
            </div>
          </section>
        )}
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        {loading ? (
          <p role="status">Opening your studio…</p>
        ) : !profile ? (
          <p>
            We couldn’t load your account. Please check your connection and
            reload.
          </p>
        ) : tab !== "overview" ? (
          <section className="studio-panel">
            {tab === "profile" ? (
              <>
                <div className="panel-heading">
                  <h2>Your public profile</h2>
                  <p>
                    Introduce yourself and choose the link you’ll share with
                    clients.
                  </p>
                </div>
                <form onSubmit={saveProfile}>
                  <AvatarPicker name={profile.name} value={profile.avatar_data || ""} onChange={avatar_data=>setProfile({...profile,avatar_data})} />
                  <div className="form-row">
                    <label>
                      Your name
                      <Input
                        required
                        maxLength={80}
                        value={profile.name}
                        onChange={(e) =>
                          setProfile({ ...profile, name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Booking page address
                      <Input
                        required
                        minLength={3}
                        maxLength={40}
                        pattern="[a-z0-9][a-z0-9-]{2,39}"
                        placeholder="your-name"
                        value={profile.slug}
                        onChange={(e) =>
                          setProfile({ ...profile, slug: e.target.value })
                        }
                      />
                      <span className="field-help">
                        /book/{profile.slug || "your-name"} · lowercase letters,
                        numbers, hyphens
                      </span>
                    </label>
                  </div>
                  <label>
                    What do you do?
                    <Input
                      maxLength={140}
                      required
                      value={profile.headline}
                      onChange={(e) =>
                        setProfile({ ...profile, headline: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    About you
                    <Textarea
                      maxLength={2000}
                      rows={4}
                      value={profile.bio}
                      onChange={(e) =>
                        setProfile({ ...profile, bio: e.target.value })
                      }
                    />
                  </label>
                  <label>Booking confirmation
                    <select value={profile.booking_mode} onChange={e=>setProfile({...profile,booking_mode:e.target.value as "instant"|"approval"})}>
                      <option value="instant">Instant booking — confirm automatically</option>
                      <option value="approval">Request approval — I approve each meeting</option>
                    </select>
                    <span className="field-help">Requests hold the selected time. Zoom links and confirmation emails are sent only after approval. Save your profile to apply this setting.</span>
                  </label>
                  <ZoomConnection />
                  <label>
                    Backup Zoom meeting link{" "}
                    <span className="field-help">
                      Optional · shared only after booking
                    </span>
                    <Input
                      type="url"
                      pattern="https://.*"
                      placeholder="https://zoom.us/j/..."
                      value={profile.meeting_url}
                      onChange={(e) =>
                        setProfile({ ...profile, meeting_url: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    In-person meeting address
                    <span className="field-help">
                      Shared only after booking
                    </span>
                    <Textarea
                      maxLength={500}
                      rows={2}
                      value={profile.in_person_address}
                      placeholder="Office address and arrival instructions"
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          in_person_address: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="checkbox-label">
                    <Input
                      type="checkbox"
                      checked={profile.published}
                      onChange={(e) =>
                        setProfile({ ...profile, published: e.target.checked })
                      }
                    />
                    Publish my booking page
                  </label>
                  <Button type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save profile"}
                  </Button>
                </form>

              </>
            ) : tab === "questionnaire" ? (
              <>
                <div className="panel-heading">
                  <h2>Your pre-consultation questionnaire</h2>
                  <p>Clients answer these questions first when they open your link. Their answers appear with the booking and in your confirmation email.</p>
                </div>
                <IntakeTemplatePicker questions={profile.intake_questions} onChange={questions => setProfile({ ...profile, intake_questions: questions })} />
                <form onSubmit={async (e) => {
                  e.preventDefault(); setBusy(true); setMessage("");
                  try {
                    const { data, error } = await db().from("profiles").update({ intake_questions: profile.intake_questions }).eq("id",uid).select("id").single();
                    if(error || !data) throw new Error(error?.message || "Save your profile first.");
                    setMessage("Questionnaire saved. Your intake link is ready to share.");
                  } catch(e) { setMessage(e instanceof Error ? e.message : "Unable to save questionnaire."); }
                  finally { setBusy(false); }
                }}>
                  <p className="field-help">Name and email are always included. Add up to 10 questions.</p>
                  {profile.intake_questions.map((q,i) => (
                    <fieldset className="inset-form" key={q.id}>
                      <legend>Question {i+1}</legend>
                      <label>Question text
                        <Input required maxLength={200} value={q.label} onChange={e=>setProfile({...profile,intake_questions:profile.intake_questions.map(x=>x.id===q.id?{...x,label:e.target.value}:x)})}/>
                      </label>
                      <label>Answer format
                        <select value={q.type} onChange={e=>setProfile({...profile,intake_questions:profile.intake_questions.map(x=>x.id===q.id?{...x,type:e.target.value as "short"|"long"}:x)})}>
                          <option value="short">Short answer</option><option value="long">Long answer</option>
                        </select>
                      </label>
                      <label className="checkbox-label"><Input type="checkbox" checked={q.required} onChange={e=>setProfile({...profile,intake_questions:profile.intake_questions.map(x=>x.id===q.id?{...x,required:e.target.checked}:x)})}/>Required answer</label>
                      <div className="form-row">
                        <Button type="button" variant="outline" disabled={i===0} aria-label={`Move question ${i+1} up: ${q.label || "Untitled question"}`} onClick={()=>{const questions=[...profile.intake_questions];[questions[i-1],questions[i]]=[questions[i],questions[i-1]];setProfile({...profile,intake_questions:questions});}}>Move up</Button>
                        <Button type="button" variant="outline" aria-label={`Remove question ${i+1}: ${q.label || "Untitled question"}`} onClick={()=>setProfile({...profile,intake_questions:profile.intake_questions.filter(x=>x.id!==q.id)})}>Remove question</Button>
                      </div>
                    </fieldset>
                  ))}
                  <div className="form-row">
                    <Button type="button" variant="outline" disabled={profile.intake_questions.length>=10} onClick={()=>setProfile({...profile,intake_questions:[...profile.intake_questions,{id:crypto.randomUUID(),label:"",type:"long",required:false}]})}>Add question</Button>
                    <Button type="submit" disabled={busy}>{busy?"Saving…":"Save questionnaire"}</Button>
                  </div>
                </form>
                <p className="field-help">{savedProfile?.published ? `Share /book/${savedProfile.slug} in a message or use it as the destination of a “Book a consultation” button on your website.` : "Save and publish your profile to get your shareable intake link."}</p>
              </>
            ) : tab === "consultations" ? (
              <>
                <div className="panel-heading horizontal">
                  <div>
                    <h2>Your consultations</h2>
                    <p>Give clients a clear reason to book your time.</p>
                  </div>
                  <Button onClick={() => setAdding(!adding)}>
                    {adding ? "Close form" : "+ Add consultation"}
                  </Button>
                </div>
                <form className="inset-form" onSubmit={savePaymentPreferences}>
                  <h3>Arrange payment directly</h3>
                  <p>Booking on BriefBooth is free. If you charge for your time, agree on the price and payment with your client directly.</p>
                  <fieldset>
                    <legend>Payment methods you accept</legend>
                    <div className="form-row">
                      {["Cash App", "Venmo", "PayPal", "Zelle", "Bank transfer", "Cash", "Other"].map(method => (
                        <label className="checkbox-label" key={method}><input type="checkbox" checked={profile?.payment_methods?.includes(method) || false} onChange={e => profile && setProfile({...profile, payment_methods: e.target.checked ? [...(profile.payment_methods || []), method] : (profile.payment_methods || []).filter(m => m !== method)})} /> {method}</label>
                      ))}
                    </div>
                  </fieldset>
                  <label>Payment instructions (optional)
                    <Textarea maxLength={500} rows={3} value={profile?.payment_notes || ""} onChange={e => profile && setProfile({...profile, payment_notes: e.target.value})} placeholder="Let’s agree on a price first. I accept Venmo or Cash App." />
                    <span className="field-help">These preferences appear on your public booking page. Add any other payment method here.</span>
                  </label>
                  <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save payment preferences"}</Button>
                </form>
                {adding && (
                  <form className="inset-form" onSubmit={addService}>
                    <label>
                      Consultation name
                      <Input
                        name="title"
                        required
                        maxLength={100}
                        placeholder="Strategy session"
                      />
                    </label>
                    <label>
                      Description
                      <Textarea name="description" maxLength={500} rows={2} />
                    </label>
                    <label>
                      Duration
                      <select name="duration" defaultValue="30">
                        {[15, 30, 45, 60, 90].map((n) => (
                          <option key={n} value={n}>
                            {n} minutes
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Meeting options
                      <select
                        name="meeting_modes"
                        defaultValue="zoom,in_person"
                      >
                        <option value="zoom,in_person">
                          Let clients choose: in person or Zoom
                        </option>
                        <option value="in_person">In person only</option>
                        <option value="zoom">Zoom only</option>
                      </select>
                    </label>
                    <Button type="submit" disabled={busy}>
                      {busy ? "Adding…" : "Add consultation"}
                    </Button>
                  </form>
                )}
                {services.length === 0 ? (
                  <div className="empty-state">
                    <h3>Your expertise goes here.</h3>
                    <p>
                      {savedProfile ? "Add your first consultation so clients can choose what to book." : "Save your profile first, then add your first consultation."}
                    </p>
                  </div>
                ) : (
                  services.map((s) => (
                    <div className="service-admin" key={s.id}>
                      <div>
                        <h3>{s.title}</h3>
                        <p>{s.description}</p>
                        <span>
                          Free to book · {s.duration} minutes ·{" "}
                          {s.meeting_modes
                            .map((mode) =>
                              mode === "in_person" ? "In person" : "Zoom",
                            )
                            .join(" / ")}{" "}
                          · {s.active ? "Available for booking" : "Hidden"}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => toggleService(s)}
                      >
                        {s.active ? "Hide" : "Make available"}
                      </Button>
                    </div>
                  ))
                )}
              </>
            ) : tab === "availability" ? (
              <>
                <div className="panel-heading">
                  <h2>Make time on your terms.</h2>
                  <p>
                    Weekly hours repeat in your timezone. Bookings require two
                    hours’ notice and open 60 days ahead.
                  </p>
                </div>
                <label>
                  Schedule timezone
                  <select
                    value={profile.timezone}
                    onChange={(e) =>
                      setProfile({ ...profile, timezone: e.target.value })
                    }
                  >
                    {Array.from(
                      new Set([
                        profile.timezone,
                        ...Intl.supportedValuesOf("timeZone"),
                      ]),
                    ).map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={saveTimezone}
                >
                  Save timezone
                </Button>
                <form className="hours-form" onSubmit={saveHours}>
                  {hours.map((h, i) => (
                    <div className="hours-row" key={h.weekday}>
                      <label className="checkbox-label">
                        <Input
                          type="checkbox"
                          checked={h.enabled}
                          onChange={(e) =>
                            updateHour(i, { enabled: e.target.checked })
                          }
                        />
                        {dayNames[h.weekday]}
                      </label>
                      {h.enabled ? (
                        <div className="hours-times">
                          <Input
                            aria-label={dayNames[i] + " start time"}
                            type="time"
                            required
                            value={h.start_time}
                            onChange={(e) =>
                              updateHour(i, { start_time: e.target.value })
                            }
                          />
                          <span>to</span>
                          <Input
                            aria-label={dayNames[i] + " end time"}
                            type="time"
                            required
                            value={h.end_time}
                            onChange={(e) =>
                              updateHour(i, { end_time: e.target.value })
                            }
                          />
                        </div>
                      ) : (
                        <span className="field-help">Unavailable</span>
                      )}
                    </div>
                  ))}
                  <Button type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save weekly hours"}
                  </Button>
                </form>
              </>
            ) : (
              <>
                <div className="panel-heading">
                  <h2>Your bookings</h2>
                  <p>
                    Times are shown in your browser’s timezone. Cancelled
                    appointments stay here for reference.
                  </p>
                </div>
                <div className="booking-toolbar">
                  <label>Find a booking<Input type="search" placeholder="Client name, email, or meeting type" value={search} onChange={event => setSearch(event.target.value)} /></label>
                  <Button variant="outline" disabled={refreshing || busy} onClick={refreshBookings}>{refreshing ? "Refreshing…" : "Refresh"}</Button>
                </div>
                <div className="booking-filters" role="group" aria-label="Filter bookings">
                  {[["requests", `Needs approval (${pending.length})`],["upcoming","Upcoming"],["history","History"],["all","All bookings"]].map(([value,label]) => <button key={value} aria-pressed={bookingFilter === value} onClick={() => setBookingFilter(value)}>{label}</button>)}
                </div>
                {visibleBookings.length === 0 ? (
                  <div className="empty-state">
                    <h3>No bookings in this view.</h3>
                    <p>
                      Try another filter or share your intake link from Overview.
                    </p>
                  </div>
                ) : (
                  <div className="booking-records">
                    {visibleBookings.map((b) => (
                      <article className="booking-record" key={b.id}>
                        <div>
                          <span className={"booking-status " + b.status}>
                            {b.status === "pending_approval" ? "Awaiting approval" : b.status}
                          </span>
                          <h3>
                            {services.find((s) => s.id === b.service_id)
                              ?.title || "Consultation"}
                          </h3>
                          <p>
                            {new Date(b.starts_at).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </p>
                          <p>
                            <strong>{b.client_name}</strong> ·{" "}
                            <a href={"mailto:" + b.client_email}>
                              {b.client_email}
                            </a>
                          </p>
                          <p>
                            {b.meeting_mode === "in_person"
                              ? "In-person consultation"
                              : "Zoom consultation"}
                          </p>
                          {b.notes && (
                            <details>
                              <summary aria-label={`Client intake for ${b.client_name}`}>Client intake</summary>
                              <p style={{ whiteSpace: "pre-wrap" }}>{b.notes}</p>
                            </details>
                          )}
                        </div>
                        {b.status==="pending_approval" && <div className="manage-actions">{[true,false].map(approve=><Button variant={approve ? "default" : "outline"} key={String(approve)} type="button" aria-label={`${approve ? "Approve" : "Decline"} request for ${b.client_name}`} disabled={busy || refreshing} onClick={() => reviewRequest(b.id, approve)}>{approve?"Approve request":"Decline request"}</Button>)}</div>}
                        <a aria-label={`Manage booking for ${b.client_name}`} href={"/manage/" + b.manage_token}>
                          Manage booking ↗
                        </a>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        ) : null}
        </div>
        </div>
      </main>
    </>
  );
}
