import type {
  ApplicationOutcome,
  ApplicationTrackerDetail,
  ApplicationTrackerEvent,
  ApplicationTrackerItem,
  ApplicationTrackerMetrics,
  ApplicationTrackerOverview
} from "@apply-lite/shared";
import { ApplicationOutcomeSchema } from "@apply-lite/shared";
import { db } from "../db/database.js";

type RawTrackerRow = {
  id: number;
  job_id: number;
  state: string;
  outcome: string;
  ats: string;
  title: string;
  company: string;
  location: string;
  source_url: string;
  score: number;
  submitted_score: number | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  outcome_at: string | null;
  next_action_at: string | null;
  next_action: string;
  notes: string;
};

function normalizeOutcome(value: string): ApplicationOutcome {
  const parsed = ApplicationOutcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : "ACTIVE";
}

function trackerStage(row: RawTrackerRow): ApplicationTrackerItem["stage"] {
  const outcome = normalizeOutcome(row.outcome);
  if (outcome === "OFFER") return "OFFER";
  if (outcome === "INTERVIEW") return "INTERVIEW";
  if (outcome === "REJECTED" || outcome === "WITHDRAWN") return "CLOSED";
  if (row.submitted_at || row.state === "SUBMITTED" || outcome === "WAITING") return "APPLIED";
  return "PREPARING";
}

function toItem(row: RawTrackerRow): ApplicationTrackerItem {
  return {
    id: row.id,
    jobId: row.job_id,
    state: row.state,
    outcome: normalizeOutcome(row.outcome),
    stage: trackerStage(row),
    ats: row.ats,
    title: row.title,
    company: row.company,
    location: row.location,
    sourceUrl: row.source_url,
    score: row.score,
    submittedScore: row.submitted_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    outcomeAt: row.outcome_at,
    nextActionAt: row.next_action_at,
    nextAction: row.next_action,
    notes: row.notes
  };
}

function queryTrackerRows(where = "", params: Array<string | number> = []): RawTrackerRow[] {
  return db.prepare(`
    SELECT a.id, a.job_id, a.state, a.outcome, a.ats,
           a.created_at, a.updated_at, a.submitted_at, a.outcome_at,
           a.next_action_at, a.next_action, a.notes, a.submitted_score,
           j.title, j.company, j.location, j.source_url, j.score
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    ${where}
    ORDER BY COALESCE(a.outcome_at, a.submitted_at, a.updated_at) DESC, a.id DESC
  `).all(...params) as RawTrackerRow[];
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function scoreFor(item: ApplicationTrackerItem) {
  return item.submittedScore ?? item.score;
}

export function recordTrackerEvent(
  applicationId: number,
  eventType: string,
  title: string,
  note = "",
  metadata: Record<string, unknown> = {}
) {
  db.prepare(`
    INSERT INTO application_tracker_events (application_id, event_type, title, note, metadata_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(applicationId, eventType, title, note, JSON.stringify(metadata));
}

export function markTrackerSubmitted(applicationId: number, note = "User confirmed manual employer submission") {
  const row = db.prepare(`
    SELECT a.id, a.submitted_at AS submittedAt, a.outcome, j.score
    FROM applications a JOIN jobs j ON j.id = a.job_id
    WHERE a.id = ?
  `).get(applicationId) as { id: number; submittedAt: string | null; outcome: string; score: number } | undefined;
  if (!row) return false;

  const firstConfirmation = !row.submittedAt;
  db.prepare(`
    UPDATE applications
    SET submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
        submitted_score = COALESCE(submitted_score, ?),
        outcome = CASE WHEN outcome IS NULL OR outcome = 'ACTIVE' THEN 'WAITING' ELSE outcome END,
        outcome_at = CASE WHEN outcome IS NULL OR outcome = 'ACTIVE' THEN CURRENT_TIMESTAMP ELSE outcome_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(row.score, applicationId);

  if (firstConfirmation) {
    recordTrackerEvent(applicationId, "SUBMITTED", "Application submitted", note, { score: row.score });
  }
  return true;
}

export function listApplicationTrackerItems(): ApplicationTrackerItem[] {
  return queryTrackerRows().map(toItem);
}

export function buildApplicationTrackerOverview(): ApplicationTrackerOverview {
  const items = listApplicationTrackerItems();
  const eventRows = db.prepare(`
    SELECT application_id AS applicationId, event_type AS eventType
    FROM application_tracker_events
    WHERE event_type IN ('OUTCOME_INTERVIEW', 'OUTCOME_REJECTED', 'OUTCOME_OFFER')
  `).all() as Array<{ applicationId: number; eventType: string }>;

  const interviewIds = new Set<number>();
  const rejectedIds = new Set<number>();
  const offerIds = new Set<number>();
  for (const row of eventRows) {
    if (row.eventType === "OUTCOME_INTERVIEW") interviewIds.add(row.applicationId);
    if (row.eventType === "OUTCOME_REJECTED") rejectedIds.add(row.applicationId);
    if (row.eventType === "OUTCOME_OFFER") offerIds.add(row.applicationId);
  }
  for (const item of items) {
    if (item.outcome === "INTERVIEW") interviewIds.add(item.id);
    if (item.outcome === "REJECTED") rejectedIds.add(item.id);
    if (item.outcome === "OFFER") offerIds.add(item.id);
  }

  const submittedItems = items.filter((item) => Boolean(item.submittedAt) || item.state === "SUBMITTED");
  const submittedIds = new Set(submittedItems.map((item) => item.id));
  const responseIds = new Set<number>([...interviewIds, ...rejectedIds, ...offerIds].filter((id) => submittedIds.has(id)));

  const metrics: ApplicationTrackerMetrics = {
    applicationCount: items.length,
    preparingCount: items.filter((item) => item.stage === "PREPARING").length,
    submittedCount: submittedItems.length,
    waitingCount: items.filter((item) => item.outcome === "WAITING").length,
    interviewCount: [...interviewIds].filter((id) => submittedIds.has(id)).length,
    offerCount: [...offerIds].filter((id) => submittedIds.has(id)).length,
    rejectedCount: items.filter((item) => item.outcome === "REJECTED").length,
    withdrawnCount: items.filter((item) => item.outcome === "WITHDRAWN").length,
    responseCount: responseIds.size,
    responseRate: percent(responseIds.size, submittedItems.length),
    interviewRate: percent([...interviewIds].filter((id) => submittedIds.has(id)).length, submittedItems.length),
    offerRate: percent([...offerIds].filter((id) => submittedIds.has(id)).length, submittedItems.length),
    averageSubmittedScore: average(submittedItems.map(scoreFor)),
    averageInterviewScore: average(items.filter((item) => interviewIds.has(item.id)).map(scoreFor)),
    averageRejectedScore: average(items.filter((item) => rejectedIds.has(item.id)).map(scoreFor)),
    averageOfferScore: average(items.filter((item) => offerIds.has(item.id)).map(scoreFor))
  };

  return { items, metrics, generatedAt: new Date().toISOString() };
}

function humanState(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function workflowNote(note: string, toState: string) {
  const trimmed = note.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length > 240) {
    if (toState === "NEEDS_INPUT" || toState === "REVIEW_REQUIRED") return "Browser assistant prepared an application step; detailed field results remain available in the job workspace.";
    return "Workflow details recorded by ApplyLite.";
  }
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

export function getApplicationTrackerDetail(applicationId: number): ApplicationTrackerDetail | null {
  const row = queryTrackerRows("WHERE a.id = ?", [applicationId])[0];
  if (!row) return null;

  const workflow = db.prepare(`
    SELECT id, from_state AS fromState, to_state AS toState, note, created_at AS createdAt
    FROM application_events
    WHERE application_id = ?
  `).all(applicationId) as Array<{ id: number; fromState: string | null; toState: string; note: string; createdAt: string }>;

  const tracker = db.prepare(`
    SELECT id, event_type AS eventType, title, note, created_at AS createdAt
    FROM application_tracker_events
    WHERE application_id = ?
  `).all(applicationId) as Array<{ id: number; eventType: string; title: string; note: string; createdAt: string }>;

  const gmail = db.prepare(`
    SELECT gmail_id AS gmailId, classification, subject, from_email AS fromEmail,
           from_name AS fromName, summary, received_at AS receivedAt
    FROM gmail_messages
    WHERE application_id = ?
  `).all(applicationId) as Array<{ gmailId: string; classification: string; subject: string; fromEmail: string; fromName: string; summary: string; receivedAt: string }>;

  const timeline: ApplicationTrackerEvent[] = [
    ...workflow.map((event) => ({
      id: `workflow-${event.id}`,
      source: "workflow" as const,
      eventType: event.toState,
      title: event.fromState ? `${humanState(event.fromState)} → ${humanState(event.toState)}` : humanState(event.toState),
      note: workflowNote(event.note, event.toState),
      createdAt: event.createdAt
    })),
    ...tracker.map((event) => ({
      id: `tracker-${event.id}`,
      source: "tracker" as const,
      eventType: event.eventType,
      title: event.title,
      note: event.note,
      createdAt: event.createdAt
    })),
    ...gmail.map((event) => ({
      id: `gmail-${event.gmailId}`,
      source: "gmail" as const,
      eventType: `EMAIL_${event.classification}`,
      title: `Gmail: ${event.subject || event.classification.toLowerCase().replaceAll("_", " ")}`,
      note: `${event.fromName || event.fromEmail}${event.summary ? ` — ${event.summary}` : ""}`.slice(0, 700),
      createdAt: event.receivedAt
    }))
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { item: toItem(row), timeline };
}

export function updateApplicationTracker(
  applicationId: number,
  input: { nextAction: string; nextActionAt: string | null; notes: string }
) {
  const current = db.prepare(`
    SELECT next_action AS nextAction, next_action_at AS nextActionAt
    FROM applications WHERE id = ?
  `).get(applicationId) as { nextAction: string; nextActionAt: string | null } | undefined;
  if (!current) return false;

  db.prepare(`
    UPDATE applications
    SET next_action = ?, next_action_at = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(input.nextAction.trim(), input.nextActionAt || null, input.notes.trim(), applicationId);

  if (current.nextAction !== input.nextAction.trim() || (current.nextActionAt ?? "") !== (input.nextActionAt ?? "")) {
    const dateNote = input.nextActionAt ? ` · ${input.nextActionAt}` : "";
    const note = input.nextAction.trim() ? `${input.nextAction.trim()}${dateNote}` : "Next action cleared";
    recordTrackerEvent(applicationId, "NEXT_ACTION", "Next action updated", note);
  }
  return true;
}

const outcomeTitle: Record<ApplicationOutcome, string> = {
  ACTIVE: "Outcome reset",
  WAITING: "Waiting for employer response",
  INTERVIEW: "Interview stage reached",
  REJECTED: "Employer rejection recorded",
  OFFER: "Offer received",
  WITHDRAWN: "Application withdrawn"
};

export function setApplicationOutcome(applicationId: number, outcome: ApplicationOutcome, note = "") {
  const current = db.prepare(`
    SELECT id, state, outcome, submitted_at AS submittedAt
    FROM applications WHERE id = ?
  `).get(applicationId) as { id: number; state: string; outcome: string; submittedAt: string | null } | undefined;
  if (!current) return { ok: false as const, reason: "not-found" as const };

  const requiresSubmission = outcome === "WAITING" || outcome === "INTERVIEW" || outcome === "REJECTED" || outcome === "OFFER";
  if (requiresSubmission && !current.submittedAt && current.state !== "SUBMITTED") {
    return { ok: false as const, reason: "not-submitted" as const };
  }

  db.prepare(`
    UPDATE applications
    SET outcome = ?, outcome_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(outcome, applicationId);

  if (current.outcome !== outcome || note.trim()) {
    recordTrackerEvent(applicationId, `OUTCOME_${outcome}`, outcomeTitle[outcome], note.trim(), { fromOutcome: current.outcome, toOutcome: outcome });
  }
  return { ok: true as const };
}

export function addApplicationTrackerNote(applicationId: number, note: string) {
  const exists = db.prepare("SELECT id FROM applications WHERE id = ?").get(applicationId);
  if (!exists) return false;
  recordTrackerEvent(applicationId, "NOTE", "Note added", note.trim());
  return true;
}
