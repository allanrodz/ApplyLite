export const API_BASE = "http://127.0.0.1:4310";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const hasBody = init?.body !== undefined && init?.body !== null;
  if (hasBody && !(init?.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: init?.signal ?? AbortSignal.timeout(300_000) });
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new Error("Request timed out or was cancelled. Check saved task status before retrying; this is not necessarily a connection failure.");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach the local ApplyLite API at ${API_BASE}. Make sure npm run dev is still running. ${message}`);
  }

  const text = await response.text();
  let body: { error?: string } & Record<string, unknown> = {};
  if (text) {
    try { body = JSON.parse(text) as { error?: string } & Record<string, unknown>; }
    catch { body = { error: text.slice(0, 500) }; }
  }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as unknown as T;
}
