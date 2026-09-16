import { db } from "../db/database.js";
import { generateApplicationPackage } from "./applicationPackage.js";
import { getApplicationBrowserStatus } from "../automation/sessionManager.js";

export type PackageWorkflowResult = {
  applicationId: number;
  package: Awaited<ReturnType<typeof generateApplicationPackage>>;
};

type ApplicationRow = { id: number; state: string };
type JobRow = { id: number; ats: string; title: string; company: string };

const BLOCKED_STATES = new Set(["SUBMITTED", "REJECTED_BY_USER", "EXPIRED"]);
let packageGenerationChain: Promise<void> = Promise.resolve();

function loadJob(jobId: number) {
  return db.prepare("SELECT id, ats, title, company FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
}

function ensureApplication(jobId: number, ats: string, note: string): ApplicationRow {
  const existing = db.prepare("SELECT id, state FROM applications WHERE job_id = ? ORDER BY id DESC LIMIT 1")
    .get(jobId) as ApplicationRow | undefined;
  if (existing) return existing;

  const result = db.prepare("INSERT INTO applications (job_id, state, ats) VALUES (?, 'APPROVED', ?)").run(jobId, ats);
  const id = Number(result.lastInsertRowid);
  db.prepare("INSERT INTO application_events (application_id, from_state, to_state, note) VALUES (?, NULL, 'APPROVED', ?)")
    .run(id, note);
  return { id, state: "APPROVED" };
}

function transitionApplication(applicationId: number, fromState: string, toState: string, note: string) {
  db.prepare("UPDATE applications SET state = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(toState, applicationId);
  db.prepare("INSERT INTO application_events (application_id, from_state, to_state, note) VALUES (?, ?, ?, ?)")
    .run(applicationId, fromState, toState, note);
}

async function runPackageWorkflow(jobId: number, source: string): Promise<PackageWorkflowResult> {
  const job = loadJob(jobId);
  if (!job) throw new Error("Job not found");

  const application = ensureApplication(jobId, job.ats, `${source}: application record created`);
  const activeBrowser = getApplicationBrowserStatus(application.id);
  if (activeBrowser?.active) {
    throw new Error("This application already has an active employer browser session. Close it before regenerating the package.");
  }
  if (BLOCKED_STATES.has(application.state)) {
    throw new Error(`Application is already in terminal state ${application.state}; ApplyLite will not regenerate it automatically.`);
  }
  if (application.state === "FILLING" || application.state === "SUBMITTING") {
    throw new Error(`Application is currently ${application.state}; close or finish the browser workflow before regenerating its package.`);
  }

  if (application.state !== "TAILORING") {
    transitionApplication(application.id, application.state, "TAILORING", `${source}: application package generation started`);
  }

  try {
    const generated = await generateApplicationPackage(jobId);
    transitionApplication(
      application.id,
      "TAILORING",
      "REVIEW_REQUIRED",
      `${source}: package ${generated.id} generated; evidence audit: ${generated.status}`
    );
    return { applicationId: application.id, package: generated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Application package generation failed";
    db.prepare("UPDATE applications SET state = 'FAILED', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(message, application.id);
    db.prepare("INSERT INTO application_events (application_id, from_state, to_state, note) VALUES (?, 'TAILORING', 'FAILED', ?)")
      .run(application.id, `${source}: ${message}`);
    throw error;
  }
}

/**
 * Serializes all expensive package generation in the local process. This prevents a manual
 * M3 generation and an M7 background generation from competing for Ollama at the same time.
 */
export function generatePackageWorkflow(jobId: number, source = "M3 manual package generation"): Promise<PackageWorkflowResult> {
  const task = packageGenerationChain.then(
    () => runPackageWorkflow(jobId, source),
    () => runPackageWorkflow(jobId, source)
  );
  packageGenerationChain = task.then(() => undefined, () => undefined);
  return task;
}
