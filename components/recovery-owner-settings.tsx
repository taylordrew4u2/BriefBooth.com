"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { recoveryApi } from "@/lib/recovery-api";
import { RecoveryGoogleConnection } from "@/components/recovery-google-connection";

type Service = { id: string; title: string; description: string; duration: number; active: boolean };
type OwnerConfig = {
  profile: { name: string; headline: string; bio: string; timezone: string };
  services: Service[];
  availability: { weekday: number; start_time: string; end_time: string }[];
  preferences: { notice_hours: number; horizon_days: number; buffer_minutes: number };
};
type Settings = { config: OwnerConfig; revision: number; calendar: { configured: boolean; provider: string } };
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function RecoveryOwnerSettings({ token }: { token: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const action = useRef<AbortController | null>(null);
  useEffect(() => () => action.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    recoveryApi<Settings>("owner-config", { token, signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setSettings(value); setError(""); }
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load your settings."); });
    return () => controller.abort();
  }, [token, reload]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || saving) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) || "").trim();
    const number = (name: string) => Number(form.get(name));
    const controller = new AbortController(); action.current = controller;
    setSaving(true); setError(""); setNotice("");
    try {
      const value = await recoveryApi<Settings>("owner-config", { token, signal: controller.signal, body: {
        revision: settings.revision,
        profile: { name: text("name"), headline: text("headline"), bio: text("bio"), timezone: text("timezone") },
        services: settings.config.services.map(service => ({ id: service.id, title: text(service.id + "-title"), description: text(service.id + "-description"), duration: number(service.id + "-duration"), active: form.has(service.id + "-active") })),
        availability: days.flatMap((_, weekday) => form.has(`day-${weekday}`) ? [{ weekday, start_time: text(`start-${weekday}`), end_time: text(`end-${weekday}`) }] : []),
        preferences: { notice_hours: number("notice_hours"), horizon_days: number("horizon_days"), buffer_minutes: number("buffer_minutes") },
      } });
      if (!controller.signal.aborted) { setSettings(value); setNotice("Saved. Your booking page now uses these settings. Existing appointments are unchanged."); }
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not save your settings."); }
    finally { if (!controller.signal.aborted) setSaving(false); }
  }
  return <section aria-labelledby="owner-settings-title" className="space-y-5">
    <h2 id="owner-settings-title" className="text-2xl font-semibold">Your booking settings</h2>
    <p>These settings control your live 4u Digital booking page. Consultations stay free, use Google Meet, and require your approval.</p>
    <RecoveryGoogleConnection token={token} />
    {error && <div role="alert" className="rounded-xl border p-4"><p>{error}</p><Button type="button" variant="outline" disabled={saving} onClick={() => { setNotice(""); setReload(value => value + 1); }}>Reload saved settings</Button><p className="mt-2 text-sm">Reloading replaces unsaved edits with the latest saved settings.</p></div>}
    {notice && <p role="status" className="rounded-xl bg-secondary p-4">{notice}</p>}
    {!settings ? <p role="status">Loading settings…</p> : <form key={settings.revision + ":" + reload} onSubmit={save} className="space-y-6">
      <fieldset disabled={saving} className="space-y-4 rounded-2xl border p-5">
        <legend className="px-2 font-semibold">Your public page</legend>
        <label className="block space-y-2"><span>Business name</span><Input name="name" defaultValue={settings.config.profile.name} required maxLength={120} /></label>
        <label className="block space-y-2"><span>Headline</span><Input name="headline" defaultValue={settings.config.profile.headline} maxLength={200} /></label>
        <label className="block space-y-2"><span>About your business</span><Textarea name="bio" defaultValue={settings.config.profile.bio} maxLength={4000} rows={4} /></label>
        <label className="block space-y-2"><span>Time zone</span><Input name="timezone" defaultValue={settings.config.profile.timezone} required placeholder="America/New_York" /><span className="block text-sm">Use a time zone such as America/New_York. Hours below use this zone.</span></label>
      </fieldset>
      {settings.config.services.map(service => <fieldset key={service.id} disabled={saving} className="space-y-4 rounded-2xl border p-5">
        <legend className="px-2 font-semibold">Consultation</legend>
        <label className="block space-y-2"><span>Title</span><Input name={service.id + "-title"} defaultValue={service.title} required maxLength={160} /></label>
        <label className="block space-y-2"><span>Description</span><Textarea name={service.id + "-description"} defaultValue={service.description} maxLength={2000} rows={3} /></label>
        <label className="block space-y-2"><span>Length in minutes</span><Input name={service.id + "-duration"} type="number" min={15} max={120} step={15} defaultValue={service.duration} required /></label>
        <label className="flex items-center gap-3"><input name={service.id + "-active"} type="checkbox" defaultChecked={service.active} />Available for new requests</label>
      </fieldset>)}
      <fieldset disabled={saving} className="space-y-4 rounded-2xl border p-5">
        <legend className="px-2 font-semibold">Weekly hours</legend>
        {days.map((day, weekday) => { const hours = settings.config.availability.find(value => value.weekday === weekday); return <div key={day} className="grid gap-3 sm:grid-cols-3 sm:items-center">
          <label className="flex items-center gap-3"><input type="checkbox" name={`day-${weekday}`} defaultChecked={Boolean(hours)} />{day}</label>
          <label><span className="sr-only">{day} start</span><Input type="time" aria-label={`${day} start`} name={`start-${weekday}`} defaultValue={hours?.start_time.slice(0, 5) || "09:00"} required /></label>
          <label><span className="sr-only">{day} end</span><Input type="time" aria-label={`${day} end`} name={`end-${weekday}`} defaultValue={hours?.end_time.slice(0, 5) || "17:00"} required /></label>
        </div>; })}
      </fieldset>
      <fieldset disabled={saving} className="grid gap-4 rounded-2xl border p-5 sm:grid-cols-3">
        <legend className="px-2 font-semibold">Scheduling</legend>
        <label className="space-y-2"><span>Minimum notice (hours)</span><Input type="number" name="notice_hours" min={0} max={168} step={1} defaultValue={settings.config.preferences.notice_hours} required /></label>
        <label className="space-y-2"><span>Book ahead (days)</span><Input type="number" name="horizon_days" min={1} max={60} step={1} defaultValue={settings.config.preferences.horizon_days} required /></label>
        <label className="space-y-2"><span>Time between calls (minutes)</span><Input type="number" name="buffer_minutes" min={0} max={120} step={1} defaultValue={settings.config.preferences.buffer_minutes} required /></label>
      </fieldset>
      <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save booking settings"}</Button>
    </form>}
  </section>;
}
