import { askAiText,askAiStructured,aiPreferences } from "./aiProvider.js";
import { spawn } from "node:child_process";
import { config } from "../config.js";

const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);
const DEFAULT_ATTEMPTS = 3;
const STARTUP_WAIT_MS = 15_000;

function ollamaTimeoutSignal(timeoutMs = config.ollamaTimeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

function timeoutMessage(timeoutMs = config.ollamaTimeoutMs) {
  return `Ollama did not finish within ${Math.round(timeoutMs / 1000)} seconds. Make sure Ollama is running and try again.`;
}

function isTimeoutError(error: unknown) {
  return (error instanceof DOMException && error.name === "TimeoutError")
    || (error instanceof Error && error.name === "TimeoutError");
}

function errorText(error: unknown) {
  if (!(error instanceof Error)) return String(error ?? "");
  const cause = (error as Error & { cause?: unknown }).cause;
  let causeText = "";
  if (cause instanceof Error) causeText = `${cause.name} ${cause.message}`;
  else if (cause) causeText = String(cause);
  return `${error.name} ${error.message} ${causeText}`.toLowerCase();
}

function isTransientNetworkError(error: unknown) {
  if (isTimeoutError(error)) return false;
  const text = errorText(error);
  return [
    "fetch failed",
    "econnrefused",
    "econnreset",
    "socket",
    "und_err",
    "connection refused",
    "connection reset",
    "network"
  ].some((needle) => text.includes(needle));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function ollamaFetch(
  pathname: string,
  init: Omit<RequestInit, "signal">,
  timeoutMs: number,
  attempts = DEFAULT_ATTEMPTS
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${config.ollamaBaseUrl}${pathname}`, {
        ...init,
        signal: ollamaTimeoutSignal(timeoutMs)
      });

      if (TRANSIENT_STATUS.has(response.status) && attempt < attempts) {
        await response.text().catch(() => "");
        await sleep(700 * attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= attempts) throw error;
      await sleep(700 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Ollama request failed");
}

function isLoopbackOllama() {
  try {
    const url = new URL(config.ollamaBaseUrl);
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

type OllamaTags = {
  models?: Array<{ name?: string; model?: string }>;
};

async function getTags(timeoutMs = 1500): Promise<OllamaTags | null> {
  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json() as OllamaTags;
  } catch {
    return null;
  }
}

async function waitForOllama(timeoutMs = STARTUP_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tags = await getTags(1500);
    if (tags) return tags;
    await sleep(500);
  }
  return null;
}

async function startLocalOllamaProcess() {
  await new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("ollama", ["serve"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }

    const onError = (error: Error) => reject(error);
    child.once("error", onError);
    child.once("spawn", () => {
      child.off("error", onError);
      child.unref();
      resolve();
    });
  });
}

function installedModelNames(tags: OllamaTags) {
  return (tags.models ?? [])
    .flatMap((model) => [model.name, model.model])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
}

function hasConfiguredModel(tags: OllamaTags) {
  const expected = config.ollamaModel.trim().toLowerCase();
  const names = installedModelNames(tags);
  return names.some((name) => name === expected || name.startsWith(`${expected}:`));
}

/**
 * Ensures the local Ollama service is reachable before an expensive package generation starts.
 * For the default loopback configuration ApplyLite will try to launch `ollama serve` once and
 * wait briefly for it to become healthy. We intentionally never auto-pull a model because that
 * can download several gigabytes without the user's consent.
 */
export async function ensureOllamaReady(): Promise<void> {
  if (aiPreferences().mode !== "local_only" && aiPreferences().cloudConsent) return;
  let tags = await getTags();

  if (!tags && isLoopbackOllama()) {
    try {
      await startLocalOllamaProcess();
    } catch {
      // The actionable error below is more useful than surfacing a raw spawn error.
    }
    tags = await waitForOllama();
  }

  if (!tags) {
    throw new Error(
      `Local AI is unavailable at ${config.ollamaBaseUrl}. ApplyLite tried to start Ollama automatically. `
      + `Run \"ollama serve\" in another PowerShell window, then regenerate the package.`
    );
  }

  if (!hasConfiguredModel(tags)) {
    throw new Error(
      `Ollama is running, but the configured model \"${config.ollamaModel}\" is not installed. `
      + `Run \"ollama pull ${config.ollamaModel}\" once, then regenerate the package.`
    );
  }
}

// Compatibility exports route existing features through the same consent-aware provider layer.
export const askOllama = askAiText;
export const askOllamaStructured = askAiStructured;

export async function ollamaHealth(): Promise<boolean> {
  return Boolean(await getTags());
}
