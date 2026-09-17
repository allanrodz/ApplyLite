import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApplicationPrepSettingsSchema } from "@apply-lite/shared";
import {
  dismissApplicationPrepItem,
  enqueueBriefForPreparation,
  getApplicationPrepItem,
  getApplicationPrepStatus,
  listApplicationPrepQueue,
  loadApplicationPrepSettings,
  queueJobForPreparation,
  retryApplicationPrepItem,
  saveApplicationPrepSettings
} from "../services/applicationPrep.js";

const SettingsSchema = z.object({
  enabled: z.boolean(),
  maxPackagesPerBrief: z.number().int().min(1).max(5),
  minScore: z.number().min(0).max(100)
});

export async function applicationPrepRoutes(app: FastifyInstance) {
  app.get("/application-prep/settings", async () => loadApplicationPrepSettings());

  app.put("/application-prep/settings", async (request) => {
    return saveApplicationPrepSettings(ApplicationPrepSettingsSchema.parse(SettingsSchema.parse(request.body ?? {})));
  });

  app.get("/application-prep/status", async () => getApplicationPrepStatus());

  app.get<{ Querystring: { limit?: string } }>("/application-prep/queue", async (request) => {
    return listApplicationPrepQueue(Number(request.query.limit ?? 50));
  });

  app.get<{ Params: { id: string } }>("/application-prep/items/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "Invalid preparation item id" });
    const item = getApplicationPrepItem(id);
    return item ?? reply.code(404).send({ error: "Preparation item not found" });
  });

  app.post<{ Params: { briefId: string } }>("/application-prep/briefs/:briefId/queue", async (request, reply) => {
    const briefId = Number(request.params.briefId);
    if (!Number.isFinite(briefId)) return reply.code(400).send({ error: "Invalid brief id" });
    return enqueueBriefForPreparation(briefId, true);
  });

  app.post<{ Params: { jobId: string } }>("/application-prep/jobs/:jobId/queue", async (request, reply) => {
    const jobId = Number(request.params.jobId);
    if (!Number.isFinite(jobId)) return reply.code(400).send({ error: "Invalid job id" });
    try {
      return queueJobForPreparation(jobId, "manual");
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { id: string } }>("/application-prep/items/:id/retry", async (request, reply) => {
    const id = Number(request.params.id);
    try {
      if (!retryApplicationPrepItem(id)) return reply.code(404).send({ error: "Preparation item not found" });
      return { ok: true };
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { id: string } }>("/application-prep/items/:id/dismiss", async (request, reply) => {
    const id = Number(request.params.id);
    try {
      if (!dismissApplicationPrepItem(id)) return reply.code(404).send({ error: "Preparation item not found" });
      return { ok: true };
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
