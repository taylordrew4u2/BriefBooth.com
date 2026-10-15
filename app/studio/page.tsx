"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  const [tab, setTab] = useState("profile");
  const [profile, setProfile] = useState<Profile | null>(null);
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
            .select("meeting_url")
            .eq("owner_id", user.id)
            .maybeSingle(),
        ]);
        for (const r of results) if (r.error) throw r.error;
        const [p, s, a, b, settings] = results;
        setProfile(
          p.data
            ? { ...p.data, meeting_url: settings.data?.meeting_url || "" }
            : {
                id: user.id,
                slug: "",
                name: "",
                headline: "Independent consultant",
                bio: "",
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                meeting_url: "",
                published: false,
              },
        );
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
    setBusy(true);
    setMessage("");
    try {
      const { meeting_url, ...publicProfile } = profile;
      const { error } = await db()
        .from("profiles")
        .upsert({ ...publicProfile, id: uid });
      if (error) throw error;
      const { error: settingsError } = await db()
        .from("consultant_settings")
        .upsert({ owner_id: uid, meeting_url });
      if (settingsError) throw settingsError;
      setMessage("Profile saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save profile.");
    } finally {
      setBusy(false);
    }
  }
  async function addService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const { data, error } = await db()
      .from("services")
      .insert({
        owner_id: uid,
        title: String(f.get("title")),
        description: String(f.get("description")),
        duration: Number(f.get("duration")),
      })
      .select()
      .single();
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setServices([...services, data]);
      setAdding(false);
      setMessage("Consultation added.");
    }
  }
  async function saveHours(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const invalid = hours.some((h) => h.enabled && h.end_time <= h.start_time);
    if (invalid) {
      setBusy(false);
      setMessage("Each end time must be after its start time.");
      return;
    }
    const { error } = await db().rpc("save_availability", {
      p_hours: hours
        .filter((h) => h.enabled)
        .map(({ weekday, start_time, end_time }) => ({
          weekday,
          start_time,
          end_time,
        })),
    });
    setBusy(false);
    setMessage(error ? error.message : "Availability saved.");
  }
  function updateHour(i: number, patch: Partial<Hours>) {
    setHours(hours.map((h, n) => (n === i ? { ...h, ...patch } : h)));
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
            <h1>Your booking studio.</h1>
            <p>A little organization. More time for your clients.</p>
          </div>
          {profile?.slug && profile.published && (
            <a
              className="button"
              href={"/book/" + profile.slug}
              target="_blank"
            >
              View booking page ↗
            </a>
          )}
        </div>
        <nav className="studio-tabs" aria-label="Manage booking page">
          {["profile", "consultations", "availability", "bookings"].map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setMessage("");
              }}
              aria-current={tab === t ? "page" : undefined}
              className={tab === t ? "active" : ""}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
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
        ) : (
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
                  <label>
                    Meeting link{" "}
                    <span className="field-help">
                      Optional · shared only after booking
                    </span>
                    <Input
                      type="url"
                      pattern="https://.*"
                      placeholder="https://meet.google.com/..."
                      value={profile.meeting_url}
                      onChange={(e) =>
                        setProfile({ ...profile, meeting_url: e.target.value })
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
                {profile.slug && (
                  <div className="share-link">
                    <span>Your link: /book/{profile.slug}</span>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            location.origin + "/book/" + profile.slug,
                          );
                          setMessage("Booking link copied.");
                        } catch {
                          setMessage(
                            "Your booking link is " +
                              location.origin +
                              "/book/" +
                              profile.slug,
                          );
                        }
                      }}
                    >
                      Copy link ↗
                    </button>
                  </div>
                )}
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
                    <Button type="submit" disabled={busy}>
                      {busy ? "Adding…" : "Add consultation"}
                    </Button>
                  </form>
                )}
                {services.length === 0 ? (
                  <div className="empty-state">
                    <h3>Your expertise goes here.</h3>
                    <p>
                      Save your profile first, then add your first consultation.
                    </p>
                  </div>
                ) : (
                  services.map((s) => (
                    <div className="service-admin" key={s.id}>
                      <div>
                        <h3>{s.title}</h3>
                        <p>{s.description}</p>
                        <span>
                          {s.duration} minutes ·{" "}
                          {s.active ? "Available for booking" : "Hidden"}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        onClick={async () => {
                          const { error } = await db()
                            .from("services")
                            .update({ active: !s.active })
                            .eq("id", s.id);
                          if (error) setMessage(error.message);
                          else
                            setServices(
                              services.map((x) =>
                                x.id === s.id ? { ...x, active: !x.active } : x,
                              ),
                            );
                        }}
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
                  onClick={async () => {
                    const { error } = await db()
                      .from("profiles")
                      .update({ timezone: profile.timezone })
                      .eq("id", uid);
                    setMessage(error ? error.message : "Timezone saved.");
                  }}
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
                  <h2>Your consultations, on the calendar.</h2>
                  <p>
                    Times are shown in your browser’s timezone. Cancelled
                    appointments stay here for reference.
                  </p>
                </div>
                {bookings.length === 0 ? (
                  <div className="empty-state">
                    <h3>Room for your next conversation.</h3>
                    <p>
                      Publish your page and share your booking link to get
                      started.
                    </p>
                  </div>
                ) : (
                  <div className="booking-records">
                    {bookings.map((b) => (
                      <article className="booking-record" key={b.id}>
                        <div>
                          <span className={"booking-status " + b.status}>
                            {b.status}
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
                          {b.notes && (
                            <details>
                              <summary>Client notes</summary>
                              <p>{b.notes}</p>
                            </details>
                          )}
                        </div>
                        <a href={"/manage/" + b.manage_token}>
                          Manage booking ↗
                        </a>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </>
  );
}
