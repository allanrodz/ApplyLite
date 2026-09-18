import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { db } from "../db/database.js";
import { approveLatestDegradedApplicationPackage, getArtifact, getLatestApplicationPackage, regenerateApplicationDocument } from "../services/applicationPackage.js";
import { z } from "zod";
import { generatePackageWorkflow } from "../services/packageWorkflow.js";

const RegenerateDocumentSchema = z.object({
  document: z.enum(["cv", "coverLetter"]),
  cvStyle: z.enum(["balanced", "technical", "impact", "concise"]).optional(),
  emphasis: z.enum(["auto", "skills", "experience", "projects"]).optional(),
  tone: z.enum(["professional", "warm", "confident", "direct"]).optional(),
  length: z.enum(["short", "standard"]).optional()
});

export async function packageRoutes(app: FastifyInstance) {
  app.get<{ Params: { jobId: string } }>("/jobs/:jobId/application-package", async (request, reply) => {
    const jobId = Number(request.params.jobId);
    if (!Number.isFinite(jobId)) return reply.code(400).send({ error: "Invalid job id" });
    return getLatestApplicationPackage(jobId);
  });

  app.post<{ Params: { jobId: string } }>("/jobs/:jobId/application-package/approve-fallback", async (request, reply) => {
    const jobId = Number(request.params.jobId);
    if (!Number.isFinite(jobId)) return reply.code(400).send({ error: "Invalid job id" });
    try {
      return approveLatestDegradedApplicationPackage(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not approve fallback package";
      return reply.code(422).send({ error: message });
    }
  });

  app.post<{ Params: { jobId: string } }>("/jobs/:jobId/application-package/regenerate", async (request, reply) => {
    const jobId = Number(request.params.jobId);
    if (!Number.isFinite(jobId)) return reply.code(400).send({ error: "Invalid job id" });
    try {
      const input = RegenerateDocumentSchema.parse(request.body ?? {});
      return await regenerateApplicationDocument(jobId, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not regenerate document";
      return reply.code(422).send({ error: message });
    }
  });

  app.post<{ Params: { jobId: string } }>("/jobs/:jobId/generate-package", async (request, reply) => {
    const jobId = Number(request.params.jobId);
    const job = db.prepare("SELECT id, title, company FROM jobs WHERE id = ?").get(jobId) as { id: number; title: string; company: string } | undefined;
    if (!job) return reply.code(404).send({ error: "Job not found" });

    request.log.info({ jobId, title: job.title, company: job.company }, "Application package generation started");
    try {
      const result = await generatePackageWorkflow(jobId, "M3 manual package generation");
      request.log.info({ jobId, packageId: result.package.id, audit: result.package.status, artifacts: result.package.artifacts.length }, "Application package generation completed");
      return result.package;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Application package generation failed";
      request.log.error({ err: error, jobId }, "Application package generation failed");
      return reply.code(422).send({ error: message });
    }
  });

  app.get<{ Params: { id: string } }>("/artifacts/:id/preview", async (request, reply) => {
    const id = Number(request.params.id);
    const artifact = getArtifact(id);
    if (!artifact) return reply.code(404).send({ error: "Artifact not found" });
    reply.header("content-type", artifact.mime);
    reply.header("content-disposition", `inline; filename="${artifact.filename.replaceAll('"', '')}"`);
    return reply.send(fs.createReadStream(artifact.absolutePath));
  });

  app.get<{ Params: { id: string } }>("/artifacts/:id/download", async (request, reply) => {
    const id = Number(request.params.id);
    const artifact = getArtifact(id);
    if (!artifact) return reply.code(404).send({ error: "Artifact not found" });
    reply.header("content-type", artifact.mime);
    reply.header("content-disposition", `attachment; filename="${artifact.filename.replaceAll('"', '')}"`);
    return reply.send(fs.createReadStream(artifact.absolutePath));
  });
}
