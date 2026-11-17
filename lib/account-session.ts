export type AccountSession = { checked: boolean; userId: string | null; email: string; accessToken: string };
type Auth = {
  getSession(): Promise<{ data: { session: { access_token: string; user: { id: string } } | null }; error?: unknown }>;
  getUser(token: string): Promise<{ data: { user: { id: string; email?: string } | null }; error?: unknown }>;
  onAuthStateChange(callback: (event: string) => void): { data: { subscription: { unsubscribe(): void } } };
};
export const emptyAccountSession: AccountSession = { checked: false, userId: null, email: "", accessToken: "" };

// A cached token selects the session to verify; it never establishes permission.
// Invalidate immediately on account changes, and discard checks from old sessions.
export function observeAccountSession(auth: Auth, update: (session: AccountSession) => void) {
  let active = true;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function verify() {
    const current = ++revision;
    update({ ...emptyAccountSession });
    try {
      const cached = await auth.getSession();
      const session = cached.error ? null : cached.data.session;
      const result = session ? await auth.getUser(session.access_token) : null;
      const user = result && !result.error && result.data.user?.id === session?.user.id ? result.data.user : null;
      if (active && current === revision) update({ checked: true, userId: user?.id || null, email: user?.email || "", accessToken: user && session ? session.access_token : "" });
    } catch {
      if (active && current === revision) update({ ...emptyAccountSession, checked: true });
    }
  }
  const { data } = auth.onAuthStateChange(event => {
    if (!active) return;
    revision += 1;
    if (timer !== undefined) clearTimeout(timer);
    update({ ...emptyAccountSession, checked: event === "SIGNED_OUT" });
    if (event !== "SIGNED_OUT") timer = setTimeout(() => { if (active) void verify(); }, 0);
  });
  void verify();
  return () => { active = false; revision += 1; if (timer !== undefined) clearTimeout(timer); data.subscription.unsubscribe(); };
}
