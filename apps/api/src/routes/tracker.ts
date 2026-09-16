import type { FastifyInstance } from "fastify";
import {
  ApplicationOutcomeUpdateSchema,
  ApplicationTrackerNoteSchema,
  ApplicationTrackerUpdateSchema
} from "@apply-lite/shared";
import {
  addApplicationTrackerNote,
  buildApplicationTrackerOverview,
  getApplicationTrackerDetail,
  setApplicationOutcome,
  updateApplicationTracker
} from "../services/applicationTracker.js";

export async function trackerRoutes(app: FastifyInstance) {
  app.get("/tracker/overview", async () => buildApplicationTrackerOverview());

  app.get<{ Params: { id: string } }>("/applications/:id/tracker", async (request, reply) => {
    const id = Number(request.params.id);
    const detail = getApplicationTrackerDetail(id);
    if (!detail) return reply.code(404).send({ error: "Application not found" });
    return detail;
  });

  app.put<{ Params: { id: string } }>("/applications/:id/tracker", async (request, reply) => {
    const id = Number(request.params.id);
    const input = ApplicationTrackerUpdateSchema.parse(request.body ?? {});
    if (!updateApplicationTracker(id, input)) return reply.code(404).send({ error: "Application not found" });
    return getApplicationTrackerDetail(id);
  });

  app.post<{ Params: { id: string } }>("/applications/:id/outcome", async (request, reply) => {
    const id = Number(request.params.id);
    const input = ApplicationOutcomeUpdateSchema.parse(request.body ?? {});
    const result = setApplicationOutcome(id, input.outcome, input.note);
    if (!result.ok && result.reason === "not-found") return reply.code(404).send({ error: "Application not found" });
    if (!result.ok && result.reason === "not-submitted") {
      return reply.code(409).send({ error: "Mark the application as submitted before recording an employer outcome." });
    }
    return getApplicationTrackerDetail(id);
  });

  app.post<{ Params: { id: string } }>("/applications/:id/tracker/notes", async (request, reply) => {
    const id = Number(request.params.id);
    const input = ApplicationTrackerNoteSchema.parse(request.body ?? {});
    if (!addApplicationTrackerNote(id, input.note)) return reply.code(404).send({ error: "Application not found" });
    return getApplicationTrackerDetail(id);
  });
}
