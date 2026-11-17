"use client";
import { useEffect, useState } from "react";
import { db, configured } from "@/lib/supabase";
import { emptyAccountSession, observeAccountSession } from "@/lib/account-session";

export function useAccountSession() {
  const [session, setSession] = useState({ ...emptyAccountSession, checked: !configured });
  useEffect(() => {
    if (configured) return observeAccountSession(db().auth, setSession);
  }, []);
  return session;
}
