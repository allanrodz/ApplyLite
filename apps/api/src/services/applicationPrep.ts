import {
  ApplicationPrepSettingsSchema,
  ApplicationPrepStatusSchema,
  PreparedApplicationItemSchema,
  type ApplicationPrepSettings,
  type ApplicationPrepStatus,
  type PreparedApplicationItem
} from "@apply-lite/shared";
import { db } from "../db/database.js";
import { getLatestApplicationPackage } from "./applicationPackage.js";
import { generatePackageWorkflow } from "./packageWorkflow.js";

type PrepLogger = {
  info: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

let prepWorkerRunning = false;
let prepLogger: PrepLogger | null = null;

function rowSettings() {
  return db.prepare(`
    SELECT enabled, max_packages_per_brief AS maxPackagesPerBrief, min_score AS minScore
    FROM application_prep_settings WHERE id = 1
  `).get() as Record<string, unknown> | undefined;
}

export function loadApplicationPrepSettings(): ApplicationPrepSettings {
  const row = rowSettings();
  return ApplicationPrepSettingsSchema.parse({
    enabled: Boolean(row?.enabled),
    maxPackagesPerBrief: Number(row?.maxPackagesPerBrief ?? 2),
    minScore: Number(row?.minScore ?? 75)
  });
}

export function saveApplicationPrepSettings(input: ApplicationPrepSettings) {
  const parsed = ApplicationPrepSettingsSchema.parse(input);
  db.prepare(`
    UPDATE application_prep_settings SET enabled = ?, max_packages_per_brief = ?, min_score = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(parsed.enabled ? 1 : 0, parsed.maxPackagesPerBrief, parsed.minScore);
  return loadApplicationPrepSettings();
}

function terminalApplicationForJob(jobId: number) {
  return db.prepare(`
    SELECT id, state FROM applications WHERE job_id = ? ORDER BY id DESC LIMIT 1
  `).get(jobId) as { id: number; state: string } | undefined;
}

function upsertQueueEntry(input: {
  jobId: number;
  briefId?: number | null;
  briefItemId?: number | null;
  source: "daily" | "manual";
  score: number;
}) {
  const application = terminalApplicationForJob(input.jobId);
  if (application && ["SUBMITTED", "REJECTED_BY_USER", "EXPIRED"].includes(application.state)) {
    return { queued: false, reason: `Application is already ${application.state}.` };
  }

  const existing = db.prepare("SELECT id, status FROM application_prep_queue WHERE job_id = ?").get(input.jobId) as { id: number; status: string } | undefined;
  if (existing) {
    if (["FAILED", "DISMISSED", "SKIPPED"].includes(existing.status)) {
      db.prepare(`
        UPDATE application_prep_queue SET
          brief_id = COALESCE(?, brief_id), brief_item_id = COALESCE(?, brief_item_id), source = ?,
          status = 'QUEUED', score_snapshot = ?, application_id = NULL, package_id = NULL,
          audit_status = NULL, error_message = NULL, started_at = NULL, completed_at = NULL,
          queued_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(input.briefId ?? null, input.briefItemId ?? null, input.source, input.score, existing.id);
      return { queued: true, id: existing.id };
    }
    return { queued: false, id: existing.id, reason: `Already ${existing.status.toLowerCase()}.` };
  }

  const result = db.prepare(`
    INSERT INTO application_prep_queue (job_id, brief_id, brief_item_id, source, status, score_snapshot)
    VALUES (?, ?, ?, ?, 'QUEUED', ?)
  `).run(input.jobId, input.briefId ?? null, input.briefItemId ?? null, input.source, input.score);
  return { queued: true, id: Number(result.lastInsertRowid) };
}

export function queueJobForPreparation(jobId: number, source: "daily" | "manual" = "manual") {
  const job = db.prepare("SELECT id, score FROM jobs WHERE id = ?").get(jobId) as { id: number; score: number } | undefined;
  if (!job) throw new Error("Job not found");
  const result = upsertQueueEntry({ jobId, source, score: Number(job.score ?? 0) });
  if (result.queued) kickApplicationPrepWorker();
  return result;
}

export function enqueueBriefForPreparation(briefId: number, force = false) {
  const settings = loadApplicationPrepSettings();
  if (!settings.enabled && !force) return { queued: 0, skipped: 0, disabled: true };

  const rows = db.prepare(`
    SELECT i.id AS briefItemId, i.brief_id AS briefId, i.job_id AS jobId, i.score_snapshot AS score
    FROM daily_discovery_items i
    JOIN jobs j ON j.id = i.job_id
    WHERE i.brief_id = ?
      AND i.status != 'DISMISSED'
      AND i.score_snapshot >= ?
    ORDER BY i.rank ASC
    LIMIT ?
  `).all(briefId, settings.minScore, settings.maxPackagesPerBrief) as Array<{
    briefItemId: number;
    briefId: number;
    jobId: number;
    score: number;
  }>;

  let queued = 0;
  let skipped = 0;
  for (const row of rows) {
    const result = upsertQueueEntry({
      jobId: row.jobId,
      briefId: row.briefId,
      briefItemId: row.briefItemId,
      source: "daily",
      score: Number(row.score)
    });
    if (result.queued) queued += 1;
    else skipped += 1;
  }
  if (queued) kickApplicationPrepWorker();
  return { queued, skipped, disabled: false };
}

function serializeQueueRow(row: Record<string, unknown>): PreparedApplicationItem {
  const jobId = Number(row.jobId);
  const pkg = row.packageId === null || row.packageId === undefined ? null : getLatestApplicationPackage(jobId);
  return PreparedApplicationItemSchema.parse({
    id: Number(row.id),
    jobId,
    briefId: row.briefId === null || row.briefId === undefined ? null : Number(row.briefId),
    briefItemId: row.briefItemId === null || row.briefItemId === undefined ? null : Number(row.briefItemId),
    source: String(row.source),
    status: String(row.status),
    score: Number(row.scoreSnapshot ?? 0),
    title: String(row.title),
    company: String(row.company),
    location: String(row.location ?? ""),
    sourceUrl: String(row.sourceUrl ?? ""),
    ats: String(row.ats ?? "unknown"),
    applicationId: row.applicationId === null || row.applicationId === undefined ? null : Number(row.applicationId),
    applicationState: row.applicationState ? String(row.applicationState) : null,
    packageId: row.packageId === null || row.packageId === undefined ? null : Number(row.packageId),
    auditStatus: row.auditStatus ? String(row.auditStatus) : null,
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
    queuedAt: String(row.queuedAt),
    startedAt: row.startedAt ? String(row.startedAt) : null,
    completedAt: row.completedAt ? String(row.completedAt) : null,
    updatedAt: String(row.updatedAt),
    package: pkg
  });
}

export function listApplicationPrepQueue(limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = db.prepare(`
    SELECT q.id, q.job_id AS jobId, q.brief_id AS briefId, q.brief_item_id AS briefItemId,
           q.source, q.status, q.score_snapshot AS scoreSnapshot, q.application_id AS applicationId,
           q.package_id AS packageId, q.audit_status AS auditStatus, q.error_message AS errorMessage,
           q.queued_at AS queuedAt, q.started_at AS startedAt, q.completed_at AS completedAt,
           q.updated_at AS updatedAt,
           j.title, j.company, j.location, j.source_url AS sourceUrl, j.ats,
           a.state AS applicationState
    FROM application_prep_queue q
    JOIN jobs j ON j.id = q.job_id
    LEFT JOIN applications a ON a.id = q.application_id
    ORDER BY
      CASE q.status
        WHEN 'GENERATING' THEN 0
        WHEN 'QUEUED' THEN 1
        WHEN 'NEEDS_REVIEW' THEN 2
        WHEN 'READY' THEN 3
        WHEN 'FAILED' THEN 4
        WHEN 'SUBMITTED' THEN 5
        WHEN 'DISMISSED' THEN 6
        ELSE 7
      END,
      q.updated_at DESC
    LIMIT ?
  `).all(safeLimit) as Array<Record<string, unknown>>;
  return rows.map(serializeQueueRow);
}

export function getApplicationPrepStatus(): ApplicationPrepStatus {
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status = 'GENERATING' THEN 1 ELSE 0 END) AS generating,
      SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN status = 'NEEDS_REVIEW' THEN 1 ELSE 0 END) AS needsReview,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed
    FROM application_prep_queue
  `).get() as Record<string, unknown>;

  return ApplicationPrepStatusSchema.parse({
    settings: loadApplicationPrepSettings(),
    running: prepWorkerRunning,
    counts: {
      queued: Number(counts.queued ?? 0),
      generating: Number(counts.generating ?? 0),
      ready: Number(counts.ready ?? 0),
      needsReview: Number(counts.needsReview ?? 0),
      failed: Number(counts.failed ?? 0)
    }
  });
}

export function dismissApplicationPrepItem(id: number) {
  const row = db.prepare("SELECT status FROM application_prep_queue WHERE id = ?").get(id) as { status: string } | undefined;
  if (!row) return false;
  if (row.status === "GENERATING") throw new Error("This application package is currently generating. Wait until it finishes before dismissing it.");
  db.prepare("UPDATE application_prep_queue SET status = 'DISMISSED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  return true;
}

export function retryApplicationPrepItem(id: number) {
  const row = db.prepare("SELECT id, status FROM application_prep_queue WHERE id = ?").get(id) as { id: number; status: string } | undefined;
  if (!row) return false;
  if (row.status === "GENERATING") throw new Error("This item is already generating.");
  db.prepare(`
    UPDATE application_prep_queue SET status = 'QUEUED', error_message = NULL, application_id = NULL,
      package_id = NULL, audit_status = NULL, started_at = NULL, completed_at = NULL,
      queued_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);
  kickApplicationPrepWorker();
  return true;
}

async function processNextPrepItem() {
  const row = db.prepare(`
    SELECT id, job_id AS jobId FROM application_prep_queue
    WHERE status = 'QUEUED' ORDER BY queued_at ASC, id ASC LIMIT 1
  `).get() as { id: number; jobId: number } | undefined;
  if (!row) return false;

  db.prepare(`
    UPDATE application_prep_queue SET status = 'GENERATING', started_at = CURRENT_TIMESTAMP,
      error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(row.id);

  prepLogger?.info({ queueId: row.id, jobId: row.jobId }, "M7 application preparation started");
  try {
    // Recovery/idempotency: if a prior/manual generation already completed for this job,
    // attach that package instead of spending another Ollama cycle.
    const existingPackage = getLatestApplicationPackage(row.jobId);
    const existingApplication = db.prepare(
      "SELECT id, state FROM applications WHERE job_id = ? ORDER BY id DESC LIMIT 1"
    ).get(row.jobId) as { id: number; state: string } | undefined;
    if (existingPackage && existingApplication?.state === "REVIEW_REQUIRED") {
      const queueStatus = existingPackage.status === "PASS" ? "READY" : "NEEDS_REVIEW";
      db.prepare(`
        UPDATE application_prep_queue SET status = ?, application_id = ?, package_id = ?, audit_status = ?,
          completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(queueStatus, existingApplication.id, existingPackage.id, existingPackage.status, row.id);
      prepLogger?.info({ queueId: row.id, jobId: row.jobId, packageId: existingPackage.id }, "M7 reused existing application package");
      return true;
    }

    const result = await generatePackageWorkflow(row.jobId, "M7 autonomous application preparation");
    const queueStatus = result.package.status === "PASS" ? "READY" : "NEEDS_REVIEW";
    db.prepare(`
      UPDATE application_prep_queue SET status = ?, application_id = ?, package_id = ?, audit_status = ?,
        completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(queueStatus, result.applicationId, result.package.id, result.package.status, row.id);
    prepLogger?.info({ queueId: row.id, jobId: row.jobId, packageId: result.package.id, audit: result.package.status }, "M7 application preparation completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE application_prep_queue SET status = 'FAILED', error_message = ?, completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(message, row.id);
    prepLogger?.error({ err: error, queueId: row.id, jobId: row.jobId }, "M7 application preparation failed");
  }
  return true;
}

async function processPrepQueue() {
  if (prepWorkerRunning) return;
  prepWorkerRunning = true;
  try {
    while (await processNextPrepItem()) {
      // Intentionally sequential. Ollama package generation is expensive and M7 avoids parallel package drafting.
    }
  } finally {
    prepWorkerRunning = false;
  }
}

export function kickApplicationPrepWorker() {
  if (!prepWorkerRunning) void processPrepQueue();
}

export function startApplicationPrepWorker(logger: PrepLogger) {
  prepLogger = logger;
  kickApplicationPrepWorker();
  return () => { prepLogger = null; };
}
