type Identity = { checked: boolean; userId: string | null };
type Auth = {
  getUser(): Promise<{ data: { user: { id: string } | null }; error?: unknown }>;
  onAuthStateChange(callback: (event: string) => void): { data: { subscription: { unsubscribe(): void } } };
};

// Re-check identity with Auth rather than trusting browser session storage.
// Invalidate the old workspace immediately; ignore delayed checks after a
// sign-out, account switch, or unmount. Auth callbacks must not await Auth calls.
export function observeWorkspaceIdentity(auth: Auth, update: (identity: Identity) => void) {
  let active = true;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function verify() {
    const current = ++revision;
    update({ checked: false, userId: null });
    try {
      const result = await auth.getUser();
      if (active && current === revision) update({ checked: true, userId: result.error ? null : result.data.user?.id || null });
    } catch {
      if (active && current === revision) update({ checked: true, userId: null });
    }
  }
  const { data } = auth.onAuthStateChange(event => {
    if (!active) return;
    revision += 1;
    if (timer !== undefined) clearTimeout(timer);
    if (event === "SIGNED_OUT") update({ checked: true, userId: null });
    else {
      update({ checked: false, userId: null });
      timer = setTimeout(() => { if (active) void verify(); }, 0);
    }
  });
  void verify();
  return () => {
    active = false;
    revision += 1;
    if (timer !== undefined) clearTimeout(timer);
    data.subscription.unsubscribe();
  };
}
