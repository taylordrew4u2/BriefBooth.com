/** Serial polling: never overlap requests, and ignore results after cleanup. */
export function pollSequentially<T>(
  request: () => Promise<T>,
  success: (value: T) => void,
  failure: (error: unknown) => void,
  interval = 10000,
) {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function run() {
    try {
      const value = await request();
      if (active) success(value);
    } catch (error) {
      if (active) failure(error);
    } finally {
      if (active) timer = setTimeout(run, interval);
    }
  }
  void run();
  return () => { active = false; if (timer !== undefined) clearTimeout(timer); };
}
