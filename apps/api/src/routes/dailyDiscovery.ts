import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DailyDiscoverySettingsSchema } from "@apply-lite/shared";
import {
  getDailyDiscoveryStatus,
  getLatestDailyDiscoveryBrief,
  listDailyDiscoveryBriefs,
  loadDailyDiscoverySettings,
  runDailyDiscovery,
  saveDailyDiscoverySettings,
  updateDailyDiscoveryItemStatus
} from "../services/dailyDiscovery.js";

const SettingsUpdateSchema = z.object({
  enabled: z.boolean(),
  runTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  targetTitles: z.array(z.string()),
  locations: z.array(z.string()),
  minPreScore: z.number().min(0).max(100),
  minFinalScore: z.number().min(0).max(100),
  maxDeepAnalysis: z.number().int().min(1).max(20),
  analysisConcurrency: z.number().int().min(1).max(4),
  shortlistSize: z.number().int().min(1).max(10),
  useOutcomeLearning: z.boolean()
});

const ItemStatusSchema = z.object({
  status: z.enum(["NEW", "REVIEWED", "DISMISSED"])
});

export async function dailyDiscoveryRoutes(app: FastifyInstance) {
  app.get("/daily-discovery/settings", async () => loadDailyDiscoverySettings());

  app.put("/daily-discovery/settings", async (request) => {
    const input = SettingsUpdateSchema.parse(request.body ?? {});
    const current = loadDailyDiscoverySettings();
    return saveDailyDiscoverySettings(DailyDiscoverySettingsSchema.parse({
      ...current,
      ...input,
      lastRunDate: current.lastRunDate,
      lastStartedAt: current.lastStartedAt,
      lastCompletedAt: current.lastCompletedAt,
      lastError: current.lastError
    }));
  });

  app.get("/daily-discovery/status", async () => getDailyDiscoveryStatus());

  app.get("/daily-discovery/briefs/latest", async () => getLatestDailyDiscoveryBrief());

  app.get<{ Querystring: { limit?: string } }>("/daily-discovery/briefs", async (request) => {
    return listDailyDiscoveryBriefs(Number(request.query.limit ?? 10));
  });

  app.post("/daily-discovery/run-now", async (request, reply) => {
    request.log.info("M6 manual daily discovery started");
    try {
      const result = await runDailyDiscovery("manual");
      request.log.info({ briefId: result.id, shortlistCount: result.shortlistCount }, "M6 manual daily discovery completed");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ err: error }, "M6 manual daily discovery failed");
      return reply.code(422).send({ error: message });
    }
  });

  app.patch<{ Params: { id: string } }>("/daily-discovery/items/:id", async (request, reply) => {
    const id = Number(request.params.id);
    const input = ItemStatusSchema.parse(request.body ?? {});
    const updated = updateDailyDiscoveryItemStatus(id, input.status);
    if (!updated) return reply.code(404).send({ error: "Daily brief item not found." });
    return { ok: true };
  });
}
