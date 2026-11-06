"use client";
import { useEffect, useState } from "react";
import { db } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
export function ZoomConnection() {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected" | "error">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState(0);
  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const { data, error } = await db().rpc("zoom_status");
        if (error || !data || typeof (data as {connected?: unknown}).connected !== "boolean") throw new Error("Unavailable");
        if (active) setStatus((data as {connected: boolean}).connected ? "connected" : "disconnected");
      } catch { if(active) setStatus("error"); }
    }
    loadStatus();
    return () => { active = false; };
  }, [check]);
  async function connect() {
    setBusy(true); setMessage("");
    try {
      const { data, error } = await db().rpc("zoom_begin");
      if(error || !data) throw new Error(error?.message || "Zoom is not ready yet.");
      const url = new URL(data);
      if(url.origin !== "https://zoom.us") throw new Error("Invalid Zoom connection address.");
      window.location.assign(url.href);
    } catch(e) { setMessage(e instanceof Error ? e.message : "Unable to connect Zoom."); setBusy(false); }
  }
  return <section className="inset-form" aria-label="Zoom connection">
    <h3>Automatic Zoom links</h3>
    <p role="status">{status === "loading" ? "Checking your Zoom connection…" : status === "error" ? "We couldn’t check Zoom right now. Your saved connection has not been changed." : status === "connected" ? "Zoom is connected. Each new Zoom booking gets its own meeting link, emailed to you and your client." : "Connect your Zoom account to create a meeting automatically when someone books. Your Zoom plan’s limits still apply."}</p>
    {status === "error" ? <Button type="button" variant="outline" onClick={() => {setStatus("loading");setCheck(value => value + 1);}}>Retry connection check</Button> : <Button type="button" onClick={connect} disabled={busy || status === "loading"}>{busy ? "Opening Zoom…" : status === "connected" ? "Reconnect Zoom" : "Connect Zoom"}</Button>}
    {message && <p role="status">{message}</p>}
    <p className="helper">Cancelling a booking stops its confirmation emails. If its Zoom meeting was already created, remove it from Zoom yourself.</p>
  </section>;
}
