"use client";
import { useEffect } from "react";

// Older verification emails point at the site root. Preserve their callback
// until the account page initializes Supabase and consumes the session.
export function AuthReturn() {
  useEffect(() => {
    if (window.location.pathname !== "/") return;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    if (hash.has("access_token") || hash.has("error_description") || query.has("code")) {
      const mode = hash.get("type") === "recovery" ? "?mode=password" : window.location.search;
      window.location.replace("/account/" + mode + window.location.hash);
    }
  }, []);
  return null;
}
