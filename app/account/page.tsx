"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/site-header";
import { db, configured } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export default function Account() {
  const router = useRouter();
  const formHeading = useRef<HTMLHeadingElement>(null);
  const previousMode = useRef("signin");
  const [mode, setMode] = useState("signin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const routeAccount = useCallback(async () => {
    const role = await db().rpc("account_role");
    if (role.error) { setMessage("Could not load your account. Please reload and try again."); return; }
    const clientIntent = Date.now() - Number(localStorage.getItem("briefbooth_client_login") || 0) < 15 * 60 * 1000;
    localStorage.removeItem("briefbooth_client_login");
    router.replace(role.data === "consultant" && !clientIntent ? "/studio" : "/client");
  }, [router]);
  useEffect(() => {
    if (previousMode.current !== mode) formHeading.current?.focus();
    previousMode.current = mode;
  }, [mode]);
  useEffect(() => {
    const callback = new URLSearchParams(location.hash.slice(1));
    if (callback.has("error_description")) {
      queueMicrotask(() => setMessage("This email link has expired or has already been used. Sign in if you already confirmed your account, or use Forgot password to get a new link."));
      history.replaceState(null, "", location.pathname + location.search);
    }
    const queryMode = new URLSearchParams(location.search).get("mode");
    if (queryMode === "signup") queueMicrotask(() => setMode("signup"));
    if (queryMode === "password") {
      queueMicrotask(() => setMode("password"));
      return;
    }
    if (configured)
      db()
        .auth.getUser()
        .then(({ data }) => {
          if (data.user) void routeAccount();
        });
  }, [router, routeAccount]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(e.currentTarget);
    try {
      const email = String(form.get("email"));
      const password = String(form.get("password"));
      if (mode === "reset") {
        const { error } = await db().auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + "/account?mode=password",
        });
        if (error) throw error;
        setMessage("Check your email for the password reset link.");
      } else if (mode === "signup") {
        const { data, error } = await db().auth.signUp({ email, password, options: { emailRedirectTo: location.origin + "/account/" } });
        if (error) throw error;
        if (data.session) await routeAccount();
        else
          setMessage("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await db().auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        await routeAccount();
      }
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Unable to sign in. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!configured) return;
    const { data } = db().auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("password");
    });
  return () => data.subscription.unsubscribe();
  }, []);
  async function savePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMessage("");
    try {
      const { error } = await db().auth.updateUser({
        password: String(new FormData(e.currentTarget).get("password")),
      });
      if (error) setMessage(error.message);
      else await routeAccount();
    } catch { setMessage("Couldn’t save your password. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return (
    <>
      <header className="simple-header">
        <Logo />
        <Link href="/">Back to home ↗</Link>
      </header>
      <main id="main" className="auth-layout">
        <div className="auth-story">
          <h1>
            Your time deserves
            <br />a better front door.
          </h1>
          <p>
            Create a page. Set your hours.
            <br />
            Let your next client find a time.
          </p>
          <div className="auth-graphic">
            <div className="auth-slot">
              Discovery call <span>15 min</span>
            </div>
            <div className="auth-slot">
              Strategy session <span>60 min</span>
            </div>
            <div className="auth-slot selected">
              Your next conversation <span>↗</span>
            </div>
          </div>
        </div>
        <section className="auth-card">
          <h2 ref={formHeading} tabIndex={-1}>
            {mode === "signup"
              ? "Create your account"
              : mode === "reset"
                ? "Reset your password"
                : mode === "password"
                  ? "Choose a new password"
                  : "Welcome back."}
          </h2>
          <p>
            {mode === "signup"
              ? "A little setup. A lot less scheduling."
              : "Your next conversation is waiting."}
          </p>
          {!configured && (
            <div className="notice">
              Live accounts are not connected yet. Connect Supabase using the
              setup guide to enable sign-in and booking.{" "}
              <Link href="/book/demo">Explore the booking demo →</Link>
            </div>
          )}
          {process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" &&
            (mode === "signin" || mode === "signup") && (
              <>
                <Button
                  variant="outline"
                  className="form-submit"
                  disabled={busy || !configured}
                  onClick={async () => {
                    setBusy(true);
                    setMessage("");
                    try {
                      const { error } = await db().auth.signInWithOAuth({
                        provider: "google",
                        options: { redirectTo: location.origin + "/studio" },
                      });
                      if (error) throw error;
                    } catch (e) {
                      setMessage(
                        e instanceof Error
                          ? e.message
                          : "Unable to start Google sign-in.",
                      );
                      setBusy(false);
                    }
                  }}
                >
                  Continue with Google
                </Button>
                <p className="auth-divider">or use email</p>
              </>
            )}
          <form
            onSubmit={
              mode === "password"
                ? savePassword
                : submit
            }
          >
            {mode !== "password" && (
              <label>
                Email address
                <Input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                Password
                <Input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  placeholder="At least 8 characters"
                />
              </label>
            )}
            <Button
              className="form-submit"
              type="submit"
              disabled={busy || !configured}
            >
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : mode === "reset"
                    ? "Send reset link"
                    : mode === "password"
                      ? "Save password"
                      : "Sign in"}{" "}
              <span aria-hidden="true">↗</span>
            </Button>
          </form>
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          <div className="auth-switch">
            <Link href="/client">Booked a consultation? Client sign in →</Link>
            <button
              onClick={() => {
                setMessage("");
                setMode(mode === "signup" ? "signin" : "signup");
              }}
            >
              {mode === "signup"
                ? "Already have an account? Sign in"
                : "New to BriefBooth? Create an account"}
            </button>
            {mode === "signin" && (
              <button onClick={() => setMode("reset")}>Forgot password?</button>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
