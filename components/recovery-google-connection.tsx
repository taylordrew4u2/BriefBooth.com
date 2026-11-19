"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { recoveryApi } from "@/lib/recovery-api";

type Connection = { enabled: boolean; connected: boolean; revision: number; updated_ms?: number };
const callbackMessages: Record<string, string> = {
  cancelled: "Google connection was cancelled. Your existing connection is unchanged.",
  expired: "That connection attempt expired. Your existing connection is unchanged; you can try again.",
  scope: "Allow both Calendar permissions to reconnect. Your existing connection is unchanged.",
  account: "Choose the Google account already used for your business Calendar. Your existing connection is unchanged.",
  stale: "Another connection was saved first. Reload the connection status before trying again.",
  failed: "Google could not finish reconnecting. Your existing connection is unchanged.",
};

export function RecoveryGoogleConnection({ token }: { token: string }) {
  const [status, setStatus] = useState<Connection | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const action = useRef<AbortController | null>(null);
  useEffect(() => () => action.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    const url = new URL(window.location.href);
    const result = url.searchParams.get("google");
    async function load() {
      try {
        // Only a currently verified owner session can complete the staged
        // grant. The provider callback itself never replaces credentials.
        if (result === "pending") {
          await recoveryApi("google-complete", { token, body: {}, signal: controller.signal });
          if (controller.signal.aborted) return;
          url.searchParams.delete("google");
          window.history.replaceState(null, "", url.pathname + url.search + url.hash);
          setMessage("Google is reconnected. New availability checks and meetings now use this connection.");
        } else if (result && callbackMessages[result]) {
          setMessage(callbackMessages[result]);
        }
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Google connection status is unavailable.");
      }
      // A cancelled, expired or interrupted callback must not hide the
      // existing connection or strand the owner without a reconnect button.
      if (controller.signal.aborted) return;
      try {
        const value = await recoveryApi<Connection>("google-status", { token, signal: controller.signal });
        if (!controller.signal.aborted) setStatus(value);
      } catch (error) {
        if (!controller.signal.aborted) setMessage(current => current || (error instanceof Error ? error.message : "Google connection status is unavailable."));
      }
    }
    void load();
    return () => controller.abort();
  }, [token, reload]);

  async function connect() {
    if (lock.current) return;
    lock.current = true;
    const controller = new AbortController(); action.current = controller;
    setBusy(true); setMessage("");
    try {
      const result = await recoveryApi<{ url: string }>("google-connect", { token, body: {}, signal: controller.signal });
      if (controller.signal.aborted) return;
      const url = new URL(result.url);
      if (url.origin !== "https://accounts.google.com" || url.pathname !== "/o/oauth2/v2/auth" || url.username || url.password) throw new Error("Google returned an invalid connection address.");
      window.location.assign(url.href);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not start the Google connection.");
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section id="google-connection" tabIndex={-1} aria-label="Google Calendar and Meet" className="space-y-3 rounded-2xl bg-secondary p-5">
    <h3 className="font-semibold">Google Calendar &amp; Meet</h3>
    <p>BriefBooth checks busy times and creates a Google Calendar event and Meet link after you approve a request. Rescheduling updates that event; cancelling removes it.</p>
    <p role="status">{status ? status.connected ? "Your business Calendar connection is configured." : "Your Google connection needs attention." : "Checking your Google connection…"}</p>
    {status?.enabled && <><p className="text-sm">Reconnect with the same business Google account. Your current connection stays in place until both Calendar permissions and the replacement connection are verified.</p><Button type="button" disabled={busy} onClick={connect}>{busy ? "Opening Google…" : "Reconnect Google Calendar & Meet"}</Button></>}
    <Button type="button" variant="outline" disabled={busy} onClick={() => setReload(value => value + 1)}>Refresh connection status</Button>
    {message && <p role="status">{message}</p>}
  </section>;
}
