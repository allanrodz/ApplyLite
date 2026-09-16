import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  buildCareerCoachOverview,
  createFollowUpDraft,
  generateInterviewPack,
  getInterviewPack,
  listFollowUpDrafts,
  listMockInterviewTurns,
  scoreMockInterviewAnswer
} from "../services/careerCoach.js";

const MockAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().min(20).max(8000)
});

const FollowUpSchema = z.object({
  kind: z.enum(["follow_up", "thank_you"])
});

export async function careerCoachRoutes(app: FastifyInstance) {
  app.get("/career-coach/overview", async () => buildCareerCoachOverview());

  app.get<{ Params: { id: string } }>("/career-coach/applications/:id/interview-pack", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid application id" });
    return { pack: getInterviewPack(id) };
  });

  app.post<{ Params: { id: string } }>("/career-coach/applications/:id/interview-pack", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid application id" });
    try {
      request.log.info({ applicationId: id }, "M8 interview prep generation started");
      const pack = await generateInterviewPack(id);
      request.log.info({ applicationId: id, questions: pack.questions.length, stories: pack.stories.length }, "M8 interview prep generation completed");
      return { pack };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ err: error, applicationId: id }, "M8 interview prep generation failed");
      return reply.code(422).send({ error: message });
    }
  });

  app.get<{ Params: { id: string } }>("/career-coach/applications/:id/mock-turns", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid application id" });
    return { turns: listMockInterviewTurns(id) };
  });

  app.post<{ Params: { id: string } }>("/career-coach/applications/:id/mock", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid application id" });
    const input = MockAnswerSchema.parse(request.body ?? {});
    try {
      return { turn: await scoreMockInterviewAnswer(id, input.questionId, input.answer) };
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { id: string } }>("/career-coach/applications/:id/follow-ups", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid application id" });
    return { drafts: listFollowUpDrafts(id) };
  });

  app.post<{ Params: { id: string } }>("/career-coach/applications/:id/follow-ups", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "Invalid application id" });
    const input = FollowUpSchema.parse(request.body ?? {});
    try {
      return { draft: createFollowUpDraft(id, input.kind) };
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
