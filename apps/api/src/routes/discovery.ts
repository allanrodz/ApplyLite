import type { FastifyInstance } from "fastify";
import { DiscoveryRunInputSchema } from "@apply-lite/shared";
import { z } from "zod";
import { db } from "../db/database.js";
import {
  listDiscoverySources,
  parseDiscoverySourceUrl,
  rememberDiscoverySourceFromUrl,
  runDiscovery
} from "../services/discovery.js";

const AddSourceSchema = z.object({
  url: z.string().min(8),
  name: z.string().default("")
});

const ToggleSourceSchema = z.object({ enabled: z.boolean() });

export async function discoveryRoutes(app: FastifyInstance) {
  app.get("/discovery/sources", async () => listDiscoverySources());

  app.post("/discovery/sources", async (request, reply) => {
    const input = AddSourceSchema.parse(request.body);
    const descriptor = parseDiscoverySourceUrl(input.url, input.name);
    const saved = rememberDiscoverySourceFromUrl(descriptor.boardUrl, descriptor.name || input.name, true);
    if (!saved) return reply.code(422).send({ error: "Could not add this discovery source." });
    reply.code(201);
    return saved;
  });

  app.patch<{ Params: { id: string } }>("/discovery/sources/:id", async (request, reply) => {
    const id = Number(request.params.id);
    const input = ToggleSourceSchema.parse(request.body);
    const result = db.prepare("UPDATE discovery_sources SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(input.enabled ? 1 : 0, id);
    if (!result.changes) return reply.code(404).send({ error: "Discovery source not found." });
    return { ok: true };
  });

  app.post("/discovery/run", async (request, reply) => {
    const input = DiscoveryRunInputSchema.parse(request.body ?? {});
    request.log.info({ input }, "Discovery run started");
    try {
      const result = await runDiscovery(input);
      request.log.info({ runId: result.runId, jobsImported: result.jobsImported }, "Discovery run completed");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ err: error }, "Discovery run failed");
      return reply.code(422).send({ error: message });
    }
  });
}
