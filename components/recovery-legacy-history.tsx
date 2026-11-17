"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { db } from "@/lib/supabase";
import { recoveryOwnerId } from "@/lib/account-routing";
type Record = { id: string; client_name: string; client_email: string; title_snapshot: string | null; starts_at: string; status: string; manage_token: string };
export function RecoveryLegacyHistory() {
  const [records, setRecords] = useState<Record[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve(db().from("bookings").select("id,client_name,client_email,title_snapshot,starts_at,status,manage_token").eq("owner_id", recoveryOwnerId).order("starts_at", { ascending: false }).limit(100).abortSignal(controller.signal)).then(({ data, error }) => {
      if (controller.signal.aborted) return;
      if (error) setError("Earlier appointments could not be loaded. Current booking requests are available in the Requests tab.");
      else setRecords(data || []);
    }).catch(() => { if (!controller.signal.aborted) setError("Earlier appointments could not be loaded. Please try again later."); });
    return () => controller.abort();
  }, []);
  return <section className="space-y-5" aria-labelledby="earlier-bookings-title"><h2 id="earlier-bookings-title" className="text-2xl font-semibold">Earlier appointments</h2><p>These appointments were saved before the current booking service. Open their original records for details. New requests and time changes use the Requests tab.</p>{error ? <p role="alert">{error}</p> : !records ? <p role="status">Loading earlier appointments…</p> : !records.length ? <p>No earlier appointments.</p> : records.map(record => <article key={record.id} className="space-y-2 rounded-2xl border p-5"><h3 className="font-semibold">{record.client_name} · {record.title_snapshot || "Consultation"}</h3><p>{new Date(record.starts_at).toLocaleString()} · {record.status.replaceAll("_", " ")}</p><p>{record.client_email}</p><Link className="underline" href={`/manage/${encodeURIComponent(record.manage_token)}/`}>Open original appointment</Link></article>)}{records?.length === 100 && <p className="text-sm">Showing the most recent 100 earlier appointments.</p>}</section>;
}
