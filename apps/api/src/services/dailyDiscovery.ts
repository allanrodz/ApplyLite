import { targets } from "./matching.js";
import {
  CandidateFactsSchema,
  DailyDiscoveryBriefSchema,
  DailyDiscoverySettingsSchema,
  JobInputSchema,
  JobRequirementsSchema,
  ProfileSchema,
  type CandidateFacts,
  type DailyDiscoveryBrief,
  type DailyDiscoverySettings,
  type ScoreBreakdown
} from "@apply-lite/shared";
import { db } from "../db/database.js";
import { isDiscoveryRunning, runDiscovery } from "./discovery.js";
import { scoreJob } from "./scoring.js";
import { applyOutcomeLearning, buildOutcomeLearningModel } from "./outcomeLearning.js";
import { enqueueBriefForPreparation } from "./applicationPrep.js";

let dailyRunInProgress = false;
let schedulerTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

type SchedulerLogger = {
  info: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

function safeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; }
  catch { return fallback; }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTimeKey(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function loadProfile() {
  const row = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
  return row ? ProfileSchema.parse(JSON.parse(row.data_json)) : ProfileSchema.parse({});
}

function loadCandidateFacts(): CandidateFacts | null {
  const row = db.prepare("SELECT facts_json AS factsJson FROM cv_documents ORDER BY id DESC LIMIT 1").get() as { factsJson: string } | undefined;
  if (!row) return null;
  const parsed = CandidateFactsSchema.safeParse(JSON.parse(row.factsJson));
  return parsed.success ? parsed.data : null;
}

function loadStoredSettingsRow() {
  return db.prepare(`
    SELECT enabled, run_time AS runTime, target_titles_json AS targetTitlesJson,
           locations_json AS locationsJson, min_pre_score AS minPreScore,
           min_final_score AS minFinalScore, max_deep_analysis AS maxDeepAnalysis,
           analysis_concurrency AS analysisConcurrency, shortlist_size AS shortlistSize,
           use_outcome_learning AS useOutcomeLearning, last_run_date AS lastRunDate,
           last_started_at AS lastStartedAt, last_completed_at AS lastCompletedAt,
           last_error AS lastError
    FROM daily_discovery_settings WHERE id = 1
  `).get() as Record<string, unknown> | undefined;
}

export function loadDailyDiscoverySettings(): DailyDiscoverySettings {
  const row = loadStoredSettingsRow();
  const profile = loadProfile();
  const storedTitles = safeArray(row?.targetTitlesJson);
  const storedLocations = safeArray(row?.locationsJson);

  return DailyDiscoverySettingsSchema.parse({
    enabled: Boolean(row?.enabled),
    runTime: String(row?.runTime ?? "08:00"),
    targetTitles: storedTitles.length ? storedTitles : targets(profile),
    locations: storedLocations.length ? storedLocations : [...profile.preferredLocations, profile.city, profile.country].filter(Boolean),
    minPreScore: Number(row?.minPreScore ?? 25),
    minFinalScore: Number(row?.minFinalScore ?? 60),
    maxDeepAnalysis: Number(row?.maxDeepAnalysis ?? 6),
    analysisConcurrency: Number(row?.analysisConcurrency ?? 2),
    shortlistSize: Number(row?.shortlistSize ?? 5),
    useOutcomeLearning: row?.useOutcomeLearning === undefined ? true : Boolean(row.useOutcomeLearning),
    lastRunDate: row?.lastRunDate ? String(row.lastRunDate) : null,
    lastStartedAt: row?.lastStartedAt ? String(row.lastStartedAt) : null,
    lastCompletedAt: row?.lastCompletedAt ? String(row.lastCompletedAt) : null,
    lastError: row?.lastError ? String(row.lastError) : null
  });
}

export function saveDailyDiscoverySettings(input: DailyDiscoverySettings) {
  const parsed = DailyDiscoverySettingsSchema.parse(input);
  db.prepare(`
    UPDATE daily_discovery_settings SET
      enabled = ?, run_time = ?, target_titles_json = ?, locations_json = ?,
      min_pre_score = ?, min_final_score = ?, max_deep_analysis = ?, analysis_concurrency = ?,
      shortlist_size = ?, use_outcome_learning = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    parsed.enabled ? 1 : 0,
    parsed.runTime,
    JSON.stringify(parsed.targetTitles),
    JSON.stringify(parsed.locations),
    parsed.minPreScore,
    parsed.minFinalScore,
    parsed.maxDeepAnalysis,
    parsed.analysisConcurrency,
    parsed.shortlistSize,
    parsed.useOutcomeLearning ? 1 : 0
  );
  return loadDailyDiscoverySettings();
}

function parseBreakdown(value: unknown): ScoreBreakdown {
  const parsed = safeJson<Partial<ScoreBreakdown>>(value, {});
  return {
    total: Number(parsed.total ?? 0),
    skills: Number(parsed.skills ?? 0),
    title: Number(parsed.title ?? 0),
    location: Number(parsed.location ?? 0),
    experience: Number(parsed.experience ?? 0),
    preference: Number(parsed.preference ?? 0),
    candidateExperienceYears: Number(parsed.candidateExperienceYears ?? 0),
    candidateTechnicalExperienceYears: Number(parsed.candidateTechnicalExperienceYears ?? 0),
    experienceSource: parsed.experienceSource ?? "unknown",
    experienceEvidence: parsed.experienceEvidence ?? [],
    matchedSkills: parsed.matchedSkills ?? [],
    missingSkills: parsed.missingSkills ?? [],
    matchedRequiredSkills: parsed.matchedRequiredSkills ?? [],
    missingRequiredSkills: parsed.missingRequiredSkills ?? [],
    matchedPreferredSkills: parsed.matchedPreferredSkills ?? [],
    missingPreferredSkills: parsed.missingPreferredSkills ?? [],
    reasons: parsed.reasons ?? [],
    concerns: parsed.concerns ?? [],
    baseTotal: parsed.baseTotal,
    outcomeAdjustment: parsed.outcomeAdjustment,
    outcomeConfidence: parsed.outcomeConfidence,
    outcomeSamples: parsed.outcomeSamples,
    outcomeReasons: parsed.outcomeReasons,
    outcomeLearningActive: parsed.outcomeLearningActive
  };
}

function rescoreEligibleJobs(useOutcomeLearning: boolean) {
  const profile = loadProfile();
  const facts = loadCandidateFacts();
  const outcomeModel = buildOutcomeLearningModel();
  const rows = db.prepare(`
    SELECT j.id, j.source_url AS sourceUrl, j.title, j.company, j.location,
           j.salary_text AS salaryText, j.description, j.ats,
           j.analysis_json AS analysisJson, j.created_at AS createdAt
    FROM jobs j
    WHERE NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id)
      AND NOT EXISTS (SELECT 1 FROM daily_discovery_items i WHERE i.job_id = j.id)
    ORDER BY j.created_at DESC
  `).all() as Array<Record<string, unknown> & { id: number; analysisJson: string }>;

  const rescored = rows.map((row) => {
    const requirementsParsed = JobRequirementsSchema.safeParse(safeJson(row.analysisJson, {}));
    const requirements = requirementsParsed.success ? requirementsParsed.data : JobRequirementsSchema.parse({});
    const job = JobInputSchema.parse(row);
    const base = scoreJob(profile, job, requirements, facts);
    const breakdown = applyOutcomeLearning(base, job, requirements, useOutcomeLearning, outcomeModel);
    db.prepare("UPDATE jobs SET score = ?, score_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(breakdown.total, JSON.stringify(breakdown), row.id);
    return {
      id: row.id,
      breakdown,
      createdAt: String(row.createdAt ?? "")
    };
  });

  return rescored.sort((a, b) => b.breakdown.total - a.breakdown.total || b.createdAt.localeCompare(a.createdAt));
}

function briefReasons(breakdown: ScoreBreakdown) {
  const reasons: string[] = [];
  if (breakdown.matchedRequiredSkills?.length) {
    reasons.push(`Matches required skills: ${breakdown.matchedRequiredSkills.slice(0, 4).join(", ")}`);
  }
  if ((breakdown.outcomeAdjustment ?? 0) !== 0) {
    const sign = (breakdown.outcomeAdjustment ?? 0) > 0 ? "+" : "";
    reasons.push(`Outcome learning ${sign}${breakdown.outcomeAdjustment} points`);
  }
  if (breakdown.reasons?.length) reasons.push(...breakdown.reasons.slice(0, 2));
  if (!reasons.length) reasons.push("Strong overall CV-to-role fit based on current scoring.");
  return reasons.slice(0, 4);
}

function serializeBriefRow(row: Record<string, unknown>, withItems = true): DailyDiscoveryBrief {
  const briefId = Number(row.id);
  const items = withItems ? db.prepare(`
    SELECT i.id, i.brief_id AS briefId, i.job_id AS jobId, i.rank, i.status,
           i.score_snapshot AS scoreSnapshot, i.base_score_snapshot AS baseScoreSnapshot,
           i.outcome_adjustment AS outcomeAdjustment, i.reasons_json AS reasonsJson,
           i.created_at AS createdAt, i.reviewed_at AS reviewedAt,
           j.title, j.company, j.location, j.source_url AS sourceUrl, j.ats, j.score_json AS scoreJson
    FROM daily_discovery_items i
    JOIN jobs j ON j.id = i.job_id
    WHERE i.brief_id = ?
    ORDER BY i.rank ASC
  `).all(briefId) as Array<Record<string, unknown>> : [];

  return DailyDiscoveryBriefSchema.parse({
    id: briefId,
    runDate: String(row.runDate),
    trigger: String(row.trigger),
    status: String(row.status),
    discoveryRunId: row.discoveryRunId === null || row.discoveryRunId === undefined ? null : Number(row.discoveryRunId),
    jobsSeen: Number(row.jobsSeen ?? 0),
    jobsAnalyzed: Number(row.jobsAnalyzed ?? 0),
    jobsImported: Number(row.jobsImported ?? 0),
    shortlistCount: Number(row.shortlistCount ?? 0),
    durationMs: Number(row.durationMs ?? 0),
    errors: safeArray(row.errorsJson),
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
    createdAt: String(row.createdAt),
    completedAt: row.completedAt ? String(row.completedAt) : null,
    items: items.map((item) => {
      const breakdown = parseBreakdown(item.scoreJson);
      return {
        id: Number(item.id),
        briefId: Number(item.briefId),
        jobId: Number(item.jobId),
        rank: Number(item.rank),
        status: String(item.status),
        title: String(item.title),
        company: String(item.company),
        location: String(item.location ?? ""),
        sourceUrl: String(item.sourceUrl ?? ""),
        ats: String(item.ats ?? "unknown"),
        score: Number(item.scoreSnapshot ?? 0),
        baseScore: Number(item.baseScoreSnapshot ?? item.scoreSnapshot ?? 0),
        outcomeAdjustment: Number(item.outcomeAdjustment ?? 0),
        matchedRequiredSkills: breakdown.matchedRequiredSkills ?? [],
        missingRequiredSkills: breakdown.missingRequiredSkills ?? [],
        reasons: safeArray(item.reasonsJson),
        concerns: breakdown.concerns ?? [],
        createdAt: String(item.createdAt),
        reviewedAt: item.reviewedAt ? String(item.reviewedAt) : null
      };
    })
  });
}

export function getDailyDiscoveryBrief(id: number) {
  const row = db.prepare(`
    SELECT id, run_date AS runDate, trigger, status, discovery_run_id AS discoveryRunId,
           jobs_seen AS jobsSeen, jobs_analyzed AS jobsAnalyzed, jobs_imported AS jobsImported,
           shortlist_count AS shortlistCount, duration_ms AS durationMs, errors_json AS errorsJson,
           error_message AS errorMessage, created_at AS createdAt, completed_at AS completedAt
    FROM daily_discovery_briefs WHERE id = ?
  `).get(id) as Record<string, unknown> | undefined;
  return row ? serializeBriefRow(row, true) : null;
}

export function getLatestDailyDiscoveryBrief() {
  const row = db.prepare(`
    SELECT id, run_date AS runDate, trigger, status, discovery_run_id AS discoveryRunId,
           jobs_seen AS jobsSeen, jobs_analyzed AS jobsAnalyzed, jobs_imported AS jobsImported,
           shortlist_count AS shortlistCount, duration_ms AS durationMs, errors_json AS errorsJson,
           error_message AS errorMessage, created_at AS createdAt, completed_at AS completedAt
    FROM daily_discovery_briefs ORDER BY id DESC LIMIT 1
  `).get() as Record<string, unknown> | undefined;
  return row ? serializeBriefRow(row, true) : null;
}

export function listDailyDiscoveryBriefs(limit = 10) {
  const safeLimit = Math.max(1, Math.min(30, Math.floor(limit)));
  const rows = db.prepare(`
    SELECT id, run_date AS runDate, trigger, status, discovery_run_id AS discoveryRunId,
           jobs_seen AS jobsSeen, jobs_analyzed AS jobsAnalyzed, jobs_imported AS jobsImported,
           shortlist_count AS shortlistCount, duration_ms AS durationMs, errors_json AS errorsJson,
           error_message AS errorMessage, created_at AS createdAt, completed_at AS completedAt
    FROM daily_discovery_briefs ORDER BY id DESC LIMIT ?
  `).all(safeLimit) as Array<Record<string, unknown>>;
  return rows.map((row) => serializeBriefRow(row, false));
}

export function updateDailyDiscoveryItemStatus(id: number, status: "NEW" | "REVIEWED" | "DISMISSED") {
  const reviewedAt = status === "NEW" ? null : new Date().toISOString();
  const result = db.prepare(`
    UPDATE daily_discovery_items SET status = ?, reviewed_at = ? WHERE id = ?
  `).run(status, reviewedAt, id);
  return Boolean(result.changes);
}

export function isDailyDiscoveryRunning() {
  return dailyRunInProgress || isDiscoveryRunning();
}

function nextRunInfo(settings: DailyDiscoverySettings) {
  const now = new Date();
  const today = localDateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const scheduledMinutes = minutesFromTime(settings.runTime);
  const alreadyRan = settings.lastRunDate === today;
  const dueToday = settings.enabled && !alreadyRan && nowMinutes >= scheduledMinutes;

  if (!settings.enabled) return { nextRunAt: null, dueToday };
  const target = new Date(now);
  if (alreadyRan || nowMinutes >= scheduledMinutes) target.setDate(target.getDate() + (alreadyRan ? 1 : 0));
  target.setHours(Math.floor(scheduledMinutes / 60), scheduledMinutes % 60, 0, 0);
  return {
    nextRunAt: `${localDateKey(target)}T${settings.runTime}:00`,
    dueToday
  };
}

export function getDailyDiscoveryStatus() {
  const settings = loadDailyDiscoverySettings();
  const next = nextRunInfo(settings);
  return {
    settings,
    running: isDailyDiscoveryRunning(),
    nextRunAt: next.nextRunAt,
    dueToday: next.dueToday,
    localDate: localDateKey(),
    localTime: localTimeKey(),
    latestBrief: getLatestDailyDiscoveryBrief()
  };
}

export async function runDailyDiscovery(trigger: "scheduled" | "manual") {
  if (dailyRunInProgress || isDiscoveryRunning()) {
    throw new Error("Discovery is already running. Wait for the current run to finish.");
  }

  const settings = loadDailyDiscoverySettings();
  if (trigger === "scheduled" && !settings.enabled) throw new Error("Daily discovery is disabled.");

  dailyRunInProgress = true;
  const runDate = localDateKey();
  const briefResult = db.prepare(`
    INSERT INTO daily_discovery_briefs (run_date, trigger, status, settings_json)
    VALUES (?, ?, 'RUNNING', ?)
  `).run(runDate, trigger, JSON.stringify(settings));
  const briefId = Number(briefResult.lastInsertRowid);

  db.prepare(`
    UPDATE daily_discovery_settings SET
      last_run_date = ?, last_started_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(runDate);

  try {
    const result = await runDiscovery({
      targetTitles: settings.targetTitles,
      locations: settings.locations,
      minPreScore: settings.minPreScore,
      minFinalScore: settings.minFinalScore,
      maxDeepAnalysis: settings.maxDeepAnalysis,
      analysisConcurrency: settings.analysisConcurrency,
      useOutcomeLearning: settings.useOutcomeLearning,
      entryLevelOnly: false,
      broadEntryLevelIT: false,
      includeRemoteUS: false
    });

    const eligible = rescoreEligibleJobs(settings.useOutcomeLearning)
      .filter((entry) => entry.breakdown.total >= settings.minFinalScore)
      .slice(0, settings.shortlistSize);

    const insertItem = db.prepare(`
      INSERT INTO daily_discovery_items (
        brief_id, job_id, rank, status, score_snapshot, base_score_snapshot, outcome_adjustment, reasons_json
      ) VALUES (?, ?, ?, 'NEW', ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      eligible.forEach((entry, index) => {
        insertItem.run(
          briefId,
          entry.id,
          index + 1,
          entry.breakdown.total,
          entry.breakdown.baseTotal ?? entry.breakdown.total,
          entry.breakdown.outcomeAdjustment ?? 0,
          JSON.stringify(briefReasons(entry.breakdown))
        );
      });
    });
    transaction();

    db.prepare(`
      UPDATE daily_discovery_briefs SET
        status = 'COMPLETED', discovery_run_id = ?, jobs_seen = ?, jobs_analyzed = ?, jobs_imported = ?,
        shortlist_count = ?, duration_ms = ?, errors_json = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      result.runId,
      result.jobsSeen,
      result.jobsAnalyzed,
      result.jobsImported,
      eligible.length,
      result.durationMs,
      JSON.stringify(result.errors),
      briefId
    );

    db.prepare(`
      UPDATE daily_discovery_settings SET
        last_completed_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run();

    // M7: queue a bounded number of top matches for background application-package preparation.
    // This only queues work when M7 autonomous preparation is enabled; it never opens employer sites.
    enqueueBriefForPreparation(briefId);

    return getDailyDiscoveryBrief(briefId)!;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE daily_discovery_briefs SET status = 'FAILED', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(message, briefId);
    db.prepare(`
      UPDATE daily_discovery_settings SET last_completed_at = CURRENT_TIMESTAMP, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1
    `).run(message);
    throw error;
  } finally {
    dailyRunInProgress = false;
  }
}

async function schedulerTick(logger: SchedulerLogger) {
  if (dailyRunInProgress || isDiscoveryRunning()) return;
  const status = getDailyDiscoveryStatus();
  if (!status.settings.enabled || !status.dueToday) return;

  try {
    logger.info({ runTime: status.settings.runTime, localDate: status.localDate }, "M6 daily discovery starting");
    const brief = await runDailyDiscovery("scheduled");
    logger.info({ briefId: brief.id, shortlistCount: brief.shortlistCount }, "M6 daily discovery completed");
  } catch (error) {
    logger.error({ err: error }, "M6 daily discovery failed");
  }
}

export function startDailyDiscoveryScheduler(logger: SchedulerLogger) {
  if (schedulerTimer) return () => stopDailyDiscoveryScheduler();

  startupTimer = setTimeout(() => {
    void schedulerTick(logger);
  }, 2_500);
  schedulerTimer = setInterval(() => {
    void schedulerTick(logger);
  }, 60_000);

  return () => stopDailyDiscoveryScheduler();
}

export function stopDailyDiscoveryScheduler() {
  if (startupTimer) clearTimeout(startupTimer);
  if (schedulerTimer) clearInterval(schedulerTimer);
  startupTimer = null;
  schedulerTimer = null;
}
