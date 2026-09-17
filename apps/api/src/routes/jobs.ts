import { containsTerm } from "../services/matching.js";
import type { FastifyInstance } from "fastify";
import {
  CandidateFactsSchema,
  JobInputSchema,
  JobRequirementsSchema,
  ProfileSchema,
  type CandidateFacts,
  type JobRequirements
} from "@apply-lite/shared";
import { z } from "zod";
import { db } from "../db/database.js";
import { scoreJob } from "../services/scoring.js";
import { applyOutcomeLearning, buildOutcomeLearningModel } from "../services/outcomeLearning.js";
import { extractJobFromUrl } from "../services/jobImport.js";
import { detectAts } from "../automation/detect.js";
import { rememberDiscoverySourceFromUrl } from "../services/discovery.js";

const UrlImportSchema = z.object({ sourceUrl: z.string().min(8) });
const JobWorkspaceStatusSchema = z.object({ status: z.enum(["SCORED", "NOT_PURSUING"]) });

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

function parseRequirements(value: string | undefined): JobRequirements {
  if (!value) return JobRequirementsSchema.parse({});
  try {
    const parsed = JobRequirementsSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : JobRequirementsSchema.parse({});
  } catch {
    return JobRequirementsSchema.parse({});
  }
}

function serializeRows(useOutcomeLearning = true) {
  const profile = loadProfile();
  const facts = loadCandidateFacts();
  const outcomeModel = buildOutcomeLearningModel();
  const rows = db.prepare(`
    SELECT id, source_url AS sourceUrl, title, company, location, salary_text AS salaryText,
           description, score, score_json AS scoreJson, analysis_json AS analysisJson,
           ats, origin, status, created_at AS createdAt, score_kind AS scoreKind, analysis_status AS analysisStatus
    FROM jobs ORDER BY score DESC, created_at DESC
  `).all() as Array<Record<string, unknown> & { scoreJson: string; analysisJson: string; id: number }>;

  return rows.map((row) => {
    const requirements = parseRequirements(row.analysisJson);
    const job = JobInputSchema.parse(row);
    const baseBreakdown = scoreJob(profile, job, requirements, facts);
    if (row.scoreKind === "quick") baseBreakdown.matchedSkills = [...new Set([...profile.skills, ...(facts?.skills || []), ...(facts?.projects.flatMap(p => p.technologies) || [])])].filter(skill => containsTerm(job.description, skill));
    const scoreBreakdown = applyOutcomeLearning(baseBreakdown, job, requirements, useOutcomeLearning, outcomeModel);
    if (useOutcomeLearning) {
      db.prepare("UPDATE jobs SET score = ?, score_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(scoreBreakdown.total, JSON.stringify(scoreBreakdown), row.id);
    }
    return {
      ...row,
      score: scoreBreakdown.total,
      scoreBreakdown,
      requirements,
      scoreJson: undefined,
      analysisJson: undefined
    };
  }).sort((a, b) => Number(b.score) - Number(a.score));
}

export async function jobRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { learned?: string } }>("/jobs", async (request) => {
    const useOutcomeLearning = request.query.learned !== "0" && request.query.learned !== "false";
    return serializeRows(useOutcomeLearning);
  });

  app.post("/jobs", async (request, reply) => {
    const job = JobInputSchema.parse(request.body);
    const requirements = JobRequirementsSchema.parse({});
    const baseBreakdown = scoreJob(loadProfile(), job, requirements, loadCandidateFacts());
    const breakdown = applyOutcomeLearning(baseBreakdown, job, requirements, true);
    const ats = job.sourceUrl ? detectAts(job.sourceUrl) : "manual";

    const result = db.prepare(`
      INSERT INTO jobs (source_url, title, company, location, salary_text, description, score, score_json, analysis_json, ats, status, origin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCORED', 'manual')
    `).run(
      job.sourceUrl,
      job.title,
      job.company,
      job.location,
      job.salaryText,
      job.description,
      breakdown.total,
      JSON.stringify(breakdown),
      JSON.stringify(requirements),
      ats
    );

    reply.code(201);
    return {
      id: Number(result.lastInsertRowid),
      ...job,
      ats,
      requirements,
      score: breakdown.total,
      scoreBreakdown: breakdown
    };
  });

  app.post("/jobs/import-url", async (request, reply) => {
    const input = UrlImportSchema.parse(request.body);
    request.log.info({ sourceUrl: input.sourceUrl }, "Job URL import started");

    try {
      const { extracted, evidence } = await extractJobFromUrl(input.sourceUrl);
      request.log.info({
        finalUrl: evidence.finalUrl,
        ats: evidence.ats,
        chars: evidence.bodyText.length,
        title: extracted.title,
        company: extracted.company
      }, "Job page extracted; scoring against candidate facts");

      const job = JobInputSchema.parse({
        sourceUrl: evidence.finalUrl,
        title: extracted.title,
        company: extracted.company,
        location: extracted.location,
        salaryText: extracted.salaryText,
        description: extracted.description
      });
      const baseBreakdown = scoreJob(loadProfile(), job, extracted.requirements, loadCandidateFacts());
      const breakdown = applyOutcomeLearning(baseBreakdown, job, extracted.requirements, true);

      const result = db.prepare(`
        INSERT INTO jobs (
          source_url, title, company, location, salary_text, description,
          score, score_json, analysis_json, source_text, ats, status, origin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCORED', 'url-import')
      `).run(
        job.sourceUrl,
        job.title,
        job.company,
        job.location,
        job.salaryText,
        job.description,
        breakdown.total,
        JSON.stringify(breakdown),
        JSON.stringify(extracted.requirements),
        evidence.bodyText,
        evidence.ats
      );

      rememberDiscoverySourceFromUrl(job.sourceUrl, job.company, true);

      const response = {
        id: Number(result.lastInsertRowid),
        ...job,
        ats: evidence.ats,
        requirements: extracted.requirements,
        score: breakdown.total,
        scoreBreakdown: breakdown
      };
      request.log.info({ jobId: response.id, score: response.score }, "Job URL import completed");
      reply.code(201);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown job import error";
      request.log.error({ err: error, sourceUrl: input.sourceUrl }, "Job URL import failed");
      return reply.code(422).send({ error: message });
    }
  });

  app.patch<{ Params: { id: string }; Body: { status?: string } }>("/jobs/:id/workspace-status", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "Invalid job id" });
    const input = JobWorkspaceStatusSchema.parse(request.body);
    const result = db.prepare("UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(input.status, id);
    if (!result.changes) return reply.code(404).send({ error: "Job not found" });
    return { ok: true, jobId: id, status: input.status };
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/rescore", async (request, reply) => {
    const id = Number(request.params.id);
    const row = db.prepare(`
      SELECT source_url AS sourceUrl, title, company, location, salary_text AS salaryText,
             description, analysis_json AS analysisJson
      FROM jobs WHERE id = ?
    `).get(id) as (Record<string, unknown> & { analysisJson: string }) | undefined;

    if (!row) return reply.code(404).send({ ok: false, error: "Job not found" });
    const job = JobInputSchema.parse(row);
    const requirements = parseRequirements(row.analysisJson);
    const baseBreakdown = scoreJob(loadProfile(), job, requirements, loadCandidateFacts());
    const breakdown = applyOutcomeLearning(baseBreakdown, job, requirements, true);
    db.prepare("UPDATE jobs SET score = ?, score_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(breakdown.total, JSON.stringify(breakdown), id);
    return { ok: true, score: breakdown.total, scoreBreakdown: breakdown };
  });
}
