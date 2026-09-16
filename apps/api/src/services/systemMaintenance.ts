import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { db } from "../db/database.js";
import { config } from "../config.js";
import { getDailyDiscoveryStatus } from "./dailyDiscovery.js";
import { getApplicationPrepStatus } from "./applicationPrep.js";
import { gmailConnectionStatus } from "./gmail.js";

const root = process.cwd();
const backupRoot = path.resolve(root, "backups");
const exportRoot = path.resolve(root, "exports");
const maintenanceRoot = path.resolve(root, ".maintenance");
const pendingRestoreRoot = path.join(maintenanceRoot, "restore-pending-data");
const pendingRestoreMarker = path.join(maintenanceRoot, "restore-pending.json");
const storageRoot = path.resolve(root, config.storagePath);

function ensureDirs() {
  fs.mkdirSync(backupRoot, { recursive: true });
  fs.mkdirSync(exportRoot, { recursive: true });
  fs.mkdirSync(maintenanceRoot, { recursive: true });
}

function isoFileStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeFileName(value: string) {
  const name = path.basename(value);
  if (!name || name !== value || /[\\/]/.test(value)) throw new Error("Invalid file name");
  return name;
}

function recordMaintenanceEvent(kind: string, status: string, message: string, details: Record<string, unknown> = {}) {
  try {
    db.prepare(`
      INSERT INTO maintenance_events (kind, status, message, details_json)
      VALUES (?, ?, ?, ?)
    `).run(kind, status, message, JSON.stringify(details));
  } catch {
    // Diagnostics should never block the operation they are describing.
  }
}

function readAppVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(root, "package.json"), "utf8")) as { version?: string };
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function archiveStagingDirectory(stagingDir: string, archivePath: string) {
  if (process.platform === "win32") {
    const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const command = `Compress-Archive -Path ${psQuote(path.join(stagingDir, "*"))} -DestinationPath ${psQuote(archivePath)} -Force`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Compress-Archive failed");
    return;
  }
  const result = spawnSync("tar", ["-czf", archivePath, "-C", stagingDir, "."], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "tar backup failed");
}

function extractArchive(archivePath: string, destination: string) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === "win32") {
    const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const command = `Expand-Archive -Path ${psQuote(archivePath)} -DestinationPath ${psQuote(destination)} -Force`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Expand-Archive failed");
    return;
  }
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", destination], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "tar restore failed");
}

export type BackupInfo = {
  name: string;
  sizeBytes: number;
  createdAt: string;
  kind: string;
};

export function listBackups(): BackupInfo[] {
  ensureDirs();
  return fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".zip") || entry.name.endsWith(".tar.gz")))
    .map((entry) => {
      const fullPath = path.join(backupRoot, entry.name);
      const stat = fs.statSync(fullPath);
      const kind = entry.name.includes("pre-reset") ? "pre-reset" : entry.name.includes("migration") ? "migration" : "manual";
      return { name: entry.name, sizeBytes: stat.size, createdAt: stat.birthtime.toISOString(), kind };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createBackup(label = "manual") {
  ensureDirs();
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "manual";
  const stamp = isoFileStamp();
  const extension = process.platform === "win32" ? ".zip" : ".tar.gz";
  const name = `applylite-${safeLabel}-${stamp}${extension}`;
  const archivePath = path.join(backupRoot, name);
  const stagingDir = path.join(maintenanceRoot, `backup-staging-${stamp}`);

  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(stagingDir, "data"), { recursive: true });
  fs.mkdirSync(path.join(stagingDir, "storage"), { recursive: true });

  try {
    db.pragma("wal_checkpoint(FULL)");
    await db.backup(path.join(stagingDir, "data", "apply-lite.db"));
    if (fs.existsSync(storageRoot)) fs.cpSync(storageRoot, path.join(stagingDir, "storage"), { recursive: true, force: true });
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM jobs) AS jobs,
        (SELECT COUNT(*) FROM applications) AS applications,
        (SELECT COUNT(*) FROM application_packages) AS packages,
        (SELECT COUNT(*) FROM cv_documents) AS cvs
    `).get() as Record<string, number>;
    fs.writeFileSync(path.join(stagingDir, "manifest.json"), JSON.stringify({
      format: "ApplyLiteBackup",
      formatVersion: 1,
      appVersion: readAppVersion(),
      schemaVersion: Number(db.pragma("user_version", { simple: true }) ?? 0),
      createdAt: new Date().toISOString(),
      label: safeLabel,
      counts,
      includes: ["data/apply-lite.db", "storage/"],
      excludes: [".env", ".secrets", "node_modules", "backups"]
    }, null, 2));
    archiveStagingDirectory(stagingDir, archivePath);
    const stat = fs.statSync(archivePath);
    recordMaintenanceEvent("backup", "PASS", `Created ${name}`, { sizeBytes: stat.size, label: safeLabel });
    return { name, sizeBytes: stat.size, createdAt: stat.birthtime.toISOString(), kind: safeLabel, path: archivePath };
  } catch (error) {
    recordMaintenanceEvent("backup", "FAIL", error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

export function getBackupPath(name: string) {
  ensureDirs();
  const safe = safeFileName(name);
  const fullPath = path.join(backupRoot, safe);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw new Error("Backup not found");
  return fullPath;
}

export function stageRestore(name: string) {
  ensureDirs();
  const archivePath = getBackupPath(name);
  extractArchive(archivePath, pendingRestoreRoot);
  const manifestPath = path.join(pendingRestoreRoot, "manifest.json");
  const dbPath = path.join(pendingRestoreRoot, "data", "apply-lite.db");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(dbPath)) {
    fs.rmSync(pendingRestoreRoot, { recursive: true, force: true });
    throw new Error("This archive is not a valid ApplyLite backup.");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { format?: string; createdAt?: string; schemaVersion?: number };
  if (manifest.format !== "ApplyLiteBackup") {
    fs.rmSync(pendingRestoreRoot, { recursive: true, force: true });
    throw new Error("Backup manifest format is not recognized.");
  }
  fs.writeFileSync(pendingRestoreMarker, JSON.stringify({
    archiveName: name,
    stagedAt: new Date().toISOString(),
    backupCreatedAt: manifest.createdAt ?? null,
    schemaVersion: manifest.schemaVersion ?? null
  }, null, 2));
  recordMaintenanceEvent("restore", "PENDING", `Restore staged from ${name}. Restart ApplyLite to apply it.`);
  return { ok: true, restartRequired: true, archiveName: name };
}

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function applicationHistoryRows() {
  return db.prepare(`
    SELECT a.id AS applicationId, a.job_id AS jobId, j.title, j.company, j.location,
           j.source_url AS sourceUrl, j.ats, a.state, a.outcome, a.submitted_score AS submittedScore,
           a.submitted_at AS submittedAt, a.outcome_at AS outcomeAt,
           a.next_action AS nextAction, a.next_action_at AS nextActionAt, a.notes,
           a.created_at AS createdAt, a.updated_at AS updatedAt
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    ORDER BY a.created_at DESC
  `).all() as Array<Record<string, unknown>>;
}

export function createApplicationExport(format: "json" | "csv") {
  ensureDirs();
  const rows = applicationHistoryRows();
  const stamp = isoFileStamp();
  const name = `applylite-applications-${stamp}.${format}`;
  const fullPath = path.join(exportRoot, name);
  if (format === "json") {
    const ids = rows.map((row) => Number(row.applicationId));
    const timelines = ids.length
      ? db.prepare(`SELECT application_id AS applicationId, event_type AS eventType, title, note, metadata_json AS metadataJson, created_at AS createdAt FROM application_tracker_events ORDER BY application_id, created_at`).all()
      : [];
    fs.writeFileSync(fullPath, JSON.stringify({ exportedAt: new Date().toISOString(), applications: rows, trackerEvents: timelines }, null, 2));
  } else {
    const headers = rows.length ? Object.keys(rows[0]) : ["applicationId", "jobId", "title", "company", "state", "outcome"];
    const lines = [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))];
    fs.writeFileSync(fullPath, lines.join("\r\n"), "utf8");
  }
  const stat = fs.statSync(fullPath);
  recordMaintenanceEvent("export", "PASS", `Created ${name}`, { rows: rows.length, format });
  return { name, rows: rows.length, sizeBytes: stat.size, createdAt: stat.birthtime.toISOString() };
}

export function getExportPath(name: string) {
  ensureDirs();
  const safe = safeFileName(name);
  const fullPath = path.join(exportRoot, safe);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw new Error("Export not found");
  return fullPath;
}

async function checkOllama() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    const names = (body.models ?? []).map((model) => model.name ?? model.model ?? "");
    const exact = names.some((name) => name === config.ollamaModel || name.startsWith(`${config.ollamaModel}:`));
    return { status: exact ? "pass" : "warn", detail: exact ? `${config.ollamaModel} is available.` : `Ollama is running, but ${config.ollamaModel} was not listed.`, meta: { models: names.slice(0, 20) } };
  } catch (error) {
    return { status: "fail", detail: `Ollama is not reachable at ${config.ollamaBaseUrl}: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

function bytesLabel(bytes: number) {
  if (!Number.isFinite(bytes)) return "unknown";
  const gb = bytes / (1024 ** 3);
  return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
}

export async function getSystemDoctor() {
  ensureDirs();
  const checks: Array<{ key: string; label: string; status: "pass" | "warn" | "fail"; detail: string; meta?: Record<string, unknown> }> = [];

  try {
    const row = db.pragma("quick_check", { simple: true });
    checks.push({ key: "database", label: "SQLite database", status: row === "ok" ? "pass" : "fail", detail: row === "ok" ? "SQLite quick_check passed." : `SQLite quick_check returned ${String(row)}` });
  } catch (error) {
    checks.push({ key: "database", label: "SQLite database", status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    fs.mkdirSync(storageRoot, { recursive: true });
    const probe = path.join(storageRoot, `.m9-write-test-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    checks.push({ key: "storage", label: "Local storage", status: "pass", detail: `Writable: ${storageRoot}` });
  } catch (error) {
    checks.push({ key: "storage", label: "Local storage", status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const stats = fs.statfsSync(root);
    const free = Number(stats.bavail) * Number(stats.bsize);
    const status = free < 1024 ** 3 ? "warn" : "pass";
    checks.push({ key: "disk", label: "Disk space", status, detail: `${bytesLabel(free)} free on the ApplyLite volume.`, meta: { freeBytes: free } });
  } catch (error) {
    checks.push({ key: "disk", label: "Disk space", status: "warn", detail: `Could not read disk space: ${error instanceof Error ? error.message : String(error)}` });
  }

  const ollama = await checkOllama();
  checks.push({ key: "ollama", label: "Ollama / local AI", status: ollama.status as "pass" | "warn" | "fail", detail: ollama.detail, meta: "meta" in ollama ? ollama.meta : undefined });

  try {
    const executable = chromium.executablePath();
    checks.push({ key: "chromium", label: "Playwright Chromium", status: fs.existsSync(executable) ? "pass" : "fail", detail: fs.existsSync(executable) ? "Chromium executable is installed." : `Chromium executable is missing: ${executable}` });
  } catch (error) {
    checks.push({ key: "chromium", label: "Playwright Chromium", status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }

  const cvCount = Number((db.prepare("SELECT COUNT(*) AS count FROM cv_documents").get() as { count: number }).count ?? 0);
  checks.push({ key: "cv", label: "Candidate CV", status: cvCount > 0 ? "pass" : "warn", detail: cvCount > 0 ? `${cvCount} CV snapshot(s) available; latest will be used.` : "No CV has been uploaded yet." });

  const sourceRow = db.prepare(`
    SELECT COUNT(*) AS enabled,
           SUM(CASE WHEN last_error IS NOT NULL AND TRIM(last_error) != '' THEN 1 ELSE 0 END) AS failing
    FROM discovery_sources WHERE enabled = 1
  `).get() as { enabled: number; failing: number | null };
  const enabledSources = Number(sourceRow.enabled ?? 0);
  const failingSources = Number(sourceRow.failing ?? 0);
  checks.push({
    key: "sources",
    label: "Discovery sources",
    status: enabledSources === 0 ? "fail" : failingSources > 0 ? "warn" : "pass",
    detail: enabledSources === 0 ? "No discovery sources are enabled." : `${enabledSources} enabled source(s); ${failingSources} currently reporting an error.`,
    meta: { enabled: enabledSources, failing: failingSources }
  });

  const daily = getDailyDiscoveryStatus();
  checks.push({ key: "scheduler", label: "Daily discovery scheduler", status: daily.settings.enabled ? "pass" : "warn", detail: daily.settings.enabled ? `Enabled for ${daily.settings.runTime}; next run ${daily.nextRunAt ?? "pending"}.` : "Daily discovery is disabled." });

  const prep = getApplicationPrepStatus();
  checks.push({ key: "prep", label: "Application preparation worker", status: prep.counts.failed > 0 ? "warn" : "pass", detail: `${prep.counts.queued} queued, ${prep.counts.generating} generating, ${prep.counts.failed} failed.` });

  const gmail = gmailConnectionStatus();
  checks.push({
    key: "gmail",
    label: "Gmail intelligence",
    status: gmail.connected ? (gmail.lastError ? "warn" : "pass") : gmail.oauthConfigured ? "warn" : "warn",
    detail: gmail.connected
      ? `${gmail.email} connected read-only${gmail.lastSyncAt ? `; last sync ${gmail.lastSyncAt}` : "; first sync pending"}${gmail.lastError ? `; ${gmail.lastError}` : ""}.`
      : gmail.oauthConfigured ? "OAuth client configured, but Gmail is not connected." : "Gmail is not configured. This is optional until you enable M10 email intelligence."
  });

  const backups = listBackups();
  checks.push({ key: "backup", label: "Backups", status: backups.length ? "pass" : "warn", detail: backups.length ? `${backups.length} backup archive(s); latest ${backups[0].createdAt}.` : "No M9 backup archive exists yet. Create one before relying on autonomous runs." });

  const failed = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  return {
    version: readAppVersion(),
    schemaVersion: Number(db.pragma("user_version", { simple: true }) ?? 0),
    overall: failed ? "fail" : warnings ? "warn" : "pass",
    failed,
    warnings,
    checkedAt: new Date().toISOString(),
    checks
  };
}

export function getSystemDiagnostics() {
  const discoveryRuns = db.prepare(`
    SELECT id, status, sources_scanned AS sourcesScanned, jobs_seen AS jobsSeen,
           jobs_shortlisted AS jobsShortlisted, jobs_analyzed AS jobsAnalyzed,
           jobs_imported AS jobsImported, cache_hits AS cacheHits, ai_requests AS aiRequests,
           duration_ms AS durationMs, source_fetch_ms AS sourceFetchMs, analysis_ms AS analysisMs,
           errors_json AS errorsJson, started_at AS startedAt, completed_at AS completedAt
    FROM discovery_runs ORDER BY id DESC LIMIT 12
  `).all();
  const dailyBriefs = db.prepare(`
    SELECT id, run_date AS runDate, trigger, status, jobs_seen AS jobsSeen,
           jobs_analyzed AS jobsAnalyzed, jobs_imported AS jobsImported,
           shortlist_count AS shortlistCount, duration_ms AS durationMs,
           error_message AS errorMessage, created_at AS createdAt, completed_at AS completedAt
    FROM daily_discovery_briefs ORDER BY id DESC LIMIT 12
  `).all();
  const prepRuns = db.prepare(`
    SELECT q.id, q.status, q.score_snapshot AS score, q.error_message AS errorMessage,
           q.queued_at AS queuedAt, q.started_at AS startedAt, q.completed_at AS completedAt,
           q.updated_at AS updatedAt, j.title, j.company
    FROM application_prep_queue q JOIN jobs j ON j.id = q.job_id
    ORDER BY q.updated_at DESC LIMIT 12
  `).all();
  const maintenance = db.prepare(`
    SELECT id, kind, status, message, details_json AS detailsJson, created_at AS createdAt
    FROM maintenance_events ORDER BY id DESC LIMIT 20
  `).all();
  const sources = db.prepare(`
    SELECT id, ats, name, board_key AS boardKey, enabled, learned,
           last_scan_at AS lastScanAt, last_error AS lastError
    FROM discovery_sources
    ORDER BY enabled DESC, ats, name
  `).all();
  const gmailRuns = db.prepare(`
    SELECT id, trigger, status, messages_seen AS messagesSeen, relevant_messages AS relevantMessages,
           new_messages AS newMessages, matched_messages AS matchedMessages, ai_classified AS aiClassified,
           duration_ms AS durationMs, error_message AS errorMessage, started_at AS startedAt, completed_at AS completedAt
    FROM gmail_sync_runs ORDER BY id DESC LIMIT 12
  `).all();
  return { generatedAt: new Date().toISOString(), discoveryRuns, dailyBriefs, prepRuns, gmailRuns, maintenance, sources };
}

export async function resetLocalData(confirmation: string) {
  if (confirmation !== "RESET APPLYLITE") throw new Error('Type exactly "RESET APPLYLITE" to confirm local data reset.');
  const daily = getDailyDiscoveryStatus();
  const prep = getApplicationPrepStatus();
  if (daily.running || prep.running) {
    throw new Error("Wait for the active discovery/preparation run to finish before resetting local data.");
  }
  const backup = await createBackup("pre-reset");
  const transaction = db.transaction(() => {
    const tables = [
      "gmail_messages", "gmail_seen_messages", "gmail_sync_runs",
      "mock_interview_turns", "followup_drafts", "interview_packs",
      "application_prep_queue", "daily_discovery_items", "daily_discovery_briefs",
      "application_tracker_events", "application_events", "generated_artifacts",
      "application_packages", "applications", "jobs", "discovery_analysis_cache",
      "discovery_runs", "field_mappings", "skill_learning_plans", "answer_library",
      "cv_documents", "profile"
    ];
    for (const table of tables) db.exec(`DELETE FROM ${table}`);
    db.exec(`
      UPDATE daily_discovery_settings SET enabled = 0, last_run_date = NULL, last_started_at = NULL,
        last_completed_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
      UPDATE application_prep_settings SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
      UPDATE gmail_settings SET connected_email = '', sync_enabled = 0, last_sync_at = NULL, last_sync_started_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
      UPDATE discovery_sources SET last_scan_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP;
    `);
  });
  transaction();
  fs.rmSync(storageRoot, { recursive: true, force: true });
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.rmSync(path.resolve(root, ".secrets"), { recursive: true, force: true });
  recordMaintenanceEvent("reset", "PASS", "Local user data reset after automatic pre-reset backup.", { backup: backup.name });
  return { ok: true, backup: backup.name };
}
