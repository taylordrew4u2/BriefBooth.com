/** Serial polling: never overlap requests, and ignore results after cleanup. */
export function pollSequentially<T>(
  request: () => Promise<T>,
  success: (value: T) => void,
  failure: (error: unknown) => void,
  interval = 30000,
) {
  let active = true;
  let running = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const page = typeof document === "undefined" ? undefined : document;
  async function run() {
    if (!active || running || page?.hidden) return;
    running = true;
    try {
      const value = await request();
      failures = 0;
      if (active) success(value);
    } catch (error) {
      failures += 1;
      if (active) failure(error);
    } finally {
      running = false;
      if (active && !page?.hidden) {
        timer = setTimeout(run, Math.min(interval * 2 ** Math.min(failures, 4), 300000));
      }
    }
  }
  function resume() {
    if (timer !== undefined) clearTimeout(timer);
    void run();
  }
  page?.addEventListener("visibilitychange", resume);
  void run();
  return () => {
    active = false;
    if (timer !== undefined) clearTimeout(timer);
    page?.removeEventListener("visibilitychange", resume);
  };
}
