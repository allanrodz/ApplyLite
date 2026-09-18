import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.resolve(apiRoot, "../..");
const installedCommitPath = path.join(root, ".installed-commit");
const UPDATE_COMMAND = "irm https://raw.githubusercontent.com/allanrodz/ApplyLite/main/install.ps1 | iex";
const CACHE_MS = 10 * 60 * 1000;

export type UpdateStatus = {
  checkedAt: string;
  currentVersion: string;
  installedCommit: string | null;
  latestVersion: string | null;
  latestCommit: string | null;
  updateAvailable: boolean;
  comparison: "commit" | "version" | "unknown";
  updateCommand: string;
  message: string;
  error?: string;
};

let cache: { at: number; value: UpdateStatus } | null = null;

function cleanCommit(value: string | null | undefined) {
  const commit = (value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(commit) ? commit : null;
}

function versionParts(value: string) {
  return value.replace(/^v/i, "").split(".").slice(0, 3).map((part) => Number(part.replace(/[^0-9].*$/, "")) || 0);
}

export function isNewerVersion(latest: string, current: string) {
  const a = versionParts(latest), b = versionParts(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

export function compareUpdate(latestCommit: string | null, latestVersion: string | null, installedCommit: string | null, currentVersion: string) {
  const remoteCommit = cleanCommit(latestCommit);
  const localCommit = cleanCommit(installedCommit);
  if (remoteCommit && localCommit) {
    return { updateAvailable: remoteCommit !== localCommit, comparison: "commit" as const };
  }
  if (latestVersion) {
    return { updateAvailable: isNewerVersion(latestVersion, currentVersion), comparison: "version" as const };
  }
  return { updateAvailable: false, comparison: "unknown" as const };
}

function readInstalledCommit() {
  try { return cleanCommit(fs.readFileSync(installedCommitPath, "utf8")); }
  catch { return null; }
}

async function fetchLatest() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const [commitResponse, packageResponse] = await Promise.all([
      fetch("https://api.github.com/repos/allanrodz/ApplyLite/commits/main", {
        headers: { "User-Agent": "ApplyLite-Update-Check", "Accept": "application/vnd.github+json" },
        signal: controller.signal
      }),
      fetch("https://raw.githubusercontent.com/allanrodz/ApplyLite/main/package.json", {
        headers: { "User-Agent": "ApplyLite-Update-Check" },
        signal: controller.signal
      })
    ]);
    if (!commitResponse.ok) throw new Error(`GitHub commit check returned HTTP ${commitResponse.status}`);
    if (!packageResponse.ok) throw new Error(`GitHub version check returned HTTP ${packageResponse.status}`);
    const commitBody = await commitResponse.json() as { sha?: string };
    const packageBody = await packageResponse.json() as { version?: string };
    return {
      latestCommit: cleanCommit(commitBody.sha),
      latestVersion: typeof packageBody.version === "string" ? packageBody.version : null
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getUpdateStatus(force = false): Promise<UpdateStatus> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const installedCommit = readInstalledCommit();
  try {
    const latest = await fetchLatest();
    const compared = compareUpdate(latest.latestCommit, latest.latestVersion, installedCommit, config.version);
    const value: UpdateStatus = {
      checkedAt: new Date().toISOString(),
      currentVersion: config.version,
      installedCommit,
      latestVersion: latest.latestVersion,
      latestCommit: latest.latestCommit,
      updateAvailable: compared.updateAvailable,
      comparison: compared.comparison,
      updateCommand: UPDATE_COMMAND,
      message: compared.updateAvailable
        ? `A newer ApplyLite build is available${latest.latestVersion ? ` (v${latest.latestVersion}` : ""}${latest.latestVersion ? ")" : ""}. Close ApplyLite before running the update command.`
        : "This ApplyLite installation is up to date."
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    const value: UpdateStatus = {
      checkedAt: new Date().toISOString(),
      currentVersion: config.version,
      installedCommit,
      latestVersion: null,
      latestCommit: null,
      updateAvailable: false,
      comparison: "unknown",
      updateCommand: UPDATE_COMMAND,
      message: "Could not check GitHub for updates.",
      error: error instanceof Error ? error.message : String(error)
    };
    cache = { at: Date.now(), value };
    return value;
  }
}
