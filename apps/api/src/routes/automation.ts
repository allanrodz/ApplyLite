import type { FastifyInstance } from "fastify";
import { listMappings } from "../automation/fieldIntelligence.js";
import { db } from "../db/database.js";

export async function automationRoutes(app: FastifyInstance) {
  app.get("/automation/mappings", async () => listMappings());

  app.delete<{ Params: { id: string } }>("/automation/mappings/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid mapping id" });
    db.prepare("DELETE FROM field_mappings WHERE id = ?").run(id);
    return { ok: true };
  });
}
