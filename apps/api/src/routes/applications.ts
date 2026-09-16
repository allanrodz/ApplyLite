import type { FastifyInstance } from "fastify";
import { ApplicationStateSchema, ProfileSchema } from "@apply-lite/shared";
import { z } from "zod";
import { db } from "../db/database.js";
import { prepareApplication } from "../automation/prepare.js";
import {
  closeApplicationBrowser,
  draftCurrentApplicationQuestions,
  fillCurrentApplicationStep,
  getApplicationBrowserStatus,
  startApplicationBrowser
} from "../automation/sessionManager.js";
import { markTrackerSubmitted } from "../services/applicationTracker.js";

const TransitionSchema = z.object({
  toState: ApplicationStateSchema,
  note: z.string().default("")
});

const PrepareSchema = z.object({ resumePath: z.string().optional() });

function getProfile() {
  const row = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
  return row ? ProfileSchema.parse(JSON.parse(row.data_json)) : ProfileSchema.parse({});
}

function answersRecord() {
  const rows = db.prepare("SELECT key, value FROM answer_library").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function transition(id: number, toState: string, note: string) {
  const current = db.prepare("SELECT state FROM applications WHERE id = ?").get(id) as { state: string } | undefined;
  if (!current) return null;
  db.prepare("UPDATE applications SET state = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(toState, id);
  db.prepare("INSERT INTO application_events (application_id, from_state, to_state, note) VALUES (?, ?, ?, ?)").run(id, current.state, toState, note);
  return current.state;
}

export async function applicationRoutes(app: FastifyInstance) {
  app.get("/applications", async () => {
    return db.prepare(`
      SELECT a.id, a.job_id AS jobId, a.state, a.outcome, a.ats, a.last_error AS lastError,
             j.title, j.company, j.source_url AS sourceUrl, j.score,
             a.submitted_score AS submittedScore, a.submitted_at AS submittedAt,
             a.outcome_at AS outcomeAt, a.next_action_at AS nextActionAt,
             a.next_action AS nextAction, a.updated_at AS updatedAt
      FROM applications a JOIN jobs j ON j.id = a.job_id
      ORDER BY a.updated_at DESC
    `).all();
  });

  app.post<{ Params: { jobId: string } }>("/jobs/:jobId/applications", async (request, reply) => {
    const jobId = Number(request.params.jobId);
    const job = db.prepare("SELECT id, ats FROM jobs WHERE id = ?").get(jobId) as { id: number; ats: string } | undefined;
    if (!job) return reply.code(404).send({ error: "Job not found" });
    const existing = db.prepare("SELECT id, state FROM applications WHERE job_id = ? ORDER BY id DESC LIMIT 1").get(jobId) as { id: number; state: string } | undefined;
    if (existing) return { id: existing.id, jobId, state: existing.state };
    const result = db.prepare("INSERT INTO applications (job_id, state, ats) VALUES (?, 'APPROVED', ?)").run(jobId, job.ats);
    const id = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO application_events (application_id, from_state, to_state, note) VALUES (?, NULL, 'APPROVED', 'Created from job')").run(id);
    reply.code(201);
    return { id, jobId, state: "APPROVED" };
  });

  app.post<{ Params: { id: string } }>("/applications/:id/transition", async (request, reply) => {
    const id = Number(request.params.id);
    const input = TransitionSchema.parse(request.body);
    const current = db.prepare("SELECT state FROM applications WHERE id = ?").get(id) as { state: string } | undefined;
    if (!current) return reply.code(404).send({ error: "Application not found" });
    if (input.toState === "SUBMITTED" || input.toState === "SUBMITTING") {
      return reply.code(400).send({ error: "Automatic submission is blocked. Use the M4 'I submitted it' confirmation only after you personally click the employer's final submit control." });
    }
    transition(id, input.toState, input.note);
    return { ok: true, fromState: current.state, toState: input.toState };
  });

  // Legacy one-shot preparer retained for compatibility. M4 uses persistent browser sessions below.
  app.post<{ Params: { id: string } }>("/applications/:id/prepare", async (request, reply) => {
    const id = Number(request.params.id);
    const input = PrepareSchema.parse(request.body ?? {});
    const row = db.prepare(`
      SELECT a.id, a.state, j.source_url AS sourceUrl
      FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.id = ?
    `).get(id) as { id: number; state: string; sourceUrl: string } | undefined;
    if (!row) return reply.code(404).send({ error: "Application not found" });
    if (!row.sourceUrl) return reply.code(400).send({ error: "Job has no source URL" });

    db.prepare("UPDATE applications SET state = 'FILLING', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    try {
      const result = await prepareApplication({
        url: row.sourceUrl,
        profile: getProfile(),
        answers: answersRecord(),
        resumePath: input.resumePath
      });
      const nextState = result.unknownQuestions.length ? "NEEDS_INPUT" : "REVIEW_REQUIRED";
      db.prepare("UPDATE applications SET state = ?, ats = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextState, result.ats, id);
      db.prepare("INSERT INTO application_events (application_id, from_state, to_state, note) VALUES (?, 'FILLING', ?, ?)").run(id, nextState, JSON.stringify(result));
      return { ...result, state: nextState };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preparation failed";
      db.prepare("UPDATE applications SET state = 'FAILED', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(message, id);
      return reply.code(500).send({ error: message });
    }
  });

  app.get<{ Params: { id: string } }>("/applications/:id/browser", async (request, reply) => {
    const id = Number(request.params.id);
    const application = db.prepare("SELECT id FROM applications WHERE id = ?").get(id);
    if (!application) return reply.code(404).send({ error: "Application not found" });
    return getApplicationBrowserStatus(id);
  });

  app.post<{ Params: { id: string } }>("/applications/:id/browser/start", async (request, reply) => {
    const id = Number(request.params.id);
    const application = db.prepare("SELECT id, state FROM applications WHERE id = ?").get(id) as { id: number; state: string } | undefined;
    if (!application) return reply.code(404).send({ error: "Application not found" });
    transition(id, "FILLING", "M4 interactive browser opened; final submission remains manual");
    request.log.info({ applicationId: id }, "M4 browser session starting");
    try {
      const result = await startApplicationBrowser(id);
      const nextState = result.captchaDetected || result.loginDetected || result.unknownQuestions.length || result.manualQuestions.length ? "NEEDS_INPUT" : "REVIEW_REQUIRED";
      db.prepare("UPDATE applications SET ats = ? WHERE id = ?").run(result.ats, id);
      transition(id, nextState, `M4 browser filled current step. ${result.message}`);
      request.log.info({ applicationId: id, ats: result.ats, filled: result.filled.length, uploaded: result.uploaded.length, unknown: result.unknownQuestions.length, manual: result.manualQuestions.length, submitDetected: result.submitDetected }, "M4 current application step prepared");
      return { ...result, state: nextState };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open the application browser";
      db.prepare("UPDATE applications SET state = 'FAILED', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(message, id);
      request.log.error({ err: error, applicationId: id }, "M4 browser session failed");
      return reply.code(422).send({ error: message });
    }
  });

  app.post<{ Params: { id: string } }>("/applications/:id/browser/fill", async (request, reply) => {
    const id = Number(request.params.id);
    const application = db.prepare("SELECT id FROM applications WHERE id = ?").get(id);
    if (!application) return reply.code(404).send({ error: "Application not found" });
    try {
      const result = await fillCurrentApplicationStep(id);
      const nextState = result.captchaDetected || result.loginDetected || result.unknownQuestions.length || result.manualQuestions.length ? "NEEDS_INPUT" : "REVIEW_REQUIRED";
      db.prepare("UPDATE applications SET ats = ? WHERE id = ?").run(result.ats, id);
      transition(id, nextState, `M4 refill current step. ${result.message}`);
      return { ...result, state: nextState };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not refill the current browser step";
      return reply.code(409).send({ error: message });
    }
  });

  app.post<{ Params: { id: string } }>("/applications/:id/browser/draft-answers", async (request, reply) => {
    const id = Number(request.params.id);
    const application = db.prepare("SELECT id FROM applications WHERE id = ?").get(id);
    if (!application) return reply.code(404).send({ error: "Application not found" });
    request.log.info({ applicationId: id }, "M10.6 live form answer drafting started");
    try {
      const result = await draftCurrentApplicationQuestions(id);
      const nextState = result.captchaDetected || result.loginDetected || result.unknownQuestions.length || result.manualQuestions.length ? "NEEDS_INPUT" : "REVIEW_REQUIRED";
      transition(id, nextState, `M10.6 drafted live employer-form answers. ${result.message}`);
      request.log.info({ applicationId: id, drafts: result.formAnswerDrafts.length, remainingUnknown: result.unknownQuestions.length }, "M10.6 live form answer drafting completed");
      return { ...result, state: nextState };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not draft answers for the current employer form";
      request.log.warn({ err: error, applicationId: id }, "M10.6 live form answer drafting failed");
      return reply.code(422).send({ error: message });
    }
  });

  app.post<{ Params: { id: string } }>("/applications/:id/browser/close", async (request, reply) => {
    const id = Number(request.params.id);
    const application = db.prepare("SELECT id, state FROM applications WHERE id = ?").get(id) as { id: number; state: string } | undefined;
    if (!application) return reply.code(404).send({ error: "Application not found" });
    await closeApplicationBrowser(id);
    if (application.state !== "SUBMITTED") transition(id, "REVIEW_REQUIRED", "M4 interactive browser closed without automatic submission");
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/applications/:id/mark-submitted", async (request, reply) => {
    const id = Number(request.params.id);
    const application = db.prepare("SELECT id, state, submitted_at AS submittedAt FROM applications WHERE id = ?").get(id) as { id: number; state: string; submittedAt: string | null } | undefined;
    if (!application) return reply.code(404).send({ error: "Application not found" });
    await closeApplicationBrowser(id);

    let fromState = application.state;
    if (application.state !== "SUBMITTED") {
      fromState = transition(id, "SUBMITTED", "User confirmed they manually submitted the employer application in the visible browser") ?? application.state;
    }
    markTrackerSubmitted(id, "User confirmed they manually submitted the employer application");
    db.prepare(`
      UPDATE application_prep_queue
      SET status = 'SUBMITTED', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
      WHERE application_id = ?
    `).run(id);
    return { ok: true, fromState, toState: "SUBMITTED" };
  });
}
