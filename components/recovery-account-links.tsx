"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { RecoveryReview } from "@/components/recovery-client";

function useZoomConnectionIntent() {
  return useSearchParams().get("connect") === "zoom";
}

function ConnectionNotice() {
  return <section aria-labelledby="connection-title" className="space-y-3 rounded-2xl border border-border bg-secondary p-5 sm:p-7">
    <h2 id="connection-title" className="text-xl font-semibold">Zoom connection is temporarily unavailable</h2>
    <p>The consultant account system is unavailable, so you cannot connect or change a Zoom account here right now. The existing 4u Digital consultation uses Google Meet.</p>
    <p>No connection has been changed.</p>
  </section>;
}

export function RecoveryAccountLinks({ view }: { view: "account" | "client" | "connection" }) {
  return <Suspense fallback={<RecoveryAccessContent view={view} connection={view === "connection"} />}><RecoveryAccountIntent view={view} /></Suspense>;
}

function RecoveryAccountIntent({ view }: { view: "account" | "client" | "connection" }) {
  const zoomIntent = useZoomConnectionIntent();
  const connection = view === "connection" || zoomIntent === true;
  return <RecoveryAccessContent view={view} connection={connection} />;
}

function RecoveryAccessContent({ view, connection }: { view: "account" | "client" | "connection"; connection: boolean }) {
  return <>
    <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-6"><Logo /><Link href="/" className="text-sm underline underline-offset-4">Home</Link></header>
    <main id="main" className="mx-auto max-w-3xl space-y-6 px-5 pb-16 pt-6">
      <div className="space-y-3"><p className="text-sm font-semibold tracking-wide">4u Digital</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{view === "client" ? "Your consultation" : connection ? "Consultant connections" : "Access your booking"}</h1><p>4u Digital consultations can be requested and managed inside BriefBooth.</p></div>
      {connection && <ConnectionNotice />}
      <section aria-labelledby="booking-link-title" className="space-y-4 rounded-2xl border border-border p-5 sm:p-7">
        <h2 id="booking-link-title" className="text-xl font-semibold">Open your private booking link</h2>
        <p>Use the link saved after your request or included in your confirmation email. It shows your current status, your Google Meet link once confirmed, and your cancellation options.</p>
        <p>Account sign-in, registration, and the full account history are temporarily unavailable. You do not need an account to request a consultation.</p>
        <Button asChild><Link href="/book/4u-digital/">Request a consultation</Link></Button>
        <p className="text-sm">Lost your booking link? <a className="underline underline-offset-4" href="mailto:admin@customtechbuilt4u.com">Contact 4u Digital</a> from the email address used for your request.</p>
      </section>
      <section aria-labelledby="owner-access-title" className="space-y-4 rounded-2xl border border-border p-5 sm:p-7">
        <h2 id="owner-access-title" className="text-xl font-semibold">For the 4u Digital owner</h2>
        <p>Use your existing private owner key to review requests and manage current consultations. Profile editing, new consultant accounts, and other full Studio settings remain unavailable.</p>
        <Button asChild variant="outline"><Link href="/booking-review/">Review consultation requests</Link></Button>
      </section>
    </main>
    <footer className="mx-auto flex max-w-3xl flex-wrap gap-5 px-5 pb-8 text-sm"><Link href="/privacy/" className="underline">Privacy</Link><a href="mailto:admin@customtechbuilt4u.com" className="underline">Contact 4u Digital</a></footer>
  </>;
}

export function RecoveryStudio() {
  return <Suspense fallback={<main id="main" className="mx-auto max-w-3xl px-5 py-12"><p role="status">Opening your workspace…</p></main>}><RecoveryStudioIntent /></Suspense>;
}

function RecoveryStudioIntent() {
  const zoomIntent = useZoomConnectionIntent();
  return zoomIntent ? <RecoveryAccessContent view="connection" connection /> : <RecoveryReview />;
}
