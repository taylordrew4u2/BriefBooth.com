export async function recoveryApi<T>(path: string, options: { body?: unknown; token?: string; signal?: AbortSignal } = {}): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  const response = await fetch(`/api/recovery/${path}`, {
    method: options.body === undefined ? "GET" : "POST", headers, cache: "no-store",
    body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "We couldn’t complete that request. Please try again.");
  return data as T;
}
