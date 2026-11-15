"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AccountAccess from "@/components/account-access";
import { RecoveryAccountLinks } from "@/components/recovery-account-links";
import { needsAccountAccess } from "@/lib/account-routing";

export default function Account() {
  if (process.env.NEXT_PUBLIC_BOOKING_RECOVERY !== "1") return <AccountAccess />;
  return <Suspense fallback={<RecoveryAccountLinks view="account" />}><AccountIntent /></Suspense>;
}
function AccountIntent() {
  const search = useSearchParams();
  const [callback, setCallback] = useState(false);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.has("access_token") || hash.has("error_description")) queueMicrotask(() => setCallback(true));
  }, []);
  return callback || needsAccountAccess(search.toString()) ? <AccountAccess /> : <RecoveryAccountLinks view="account" />;
}
