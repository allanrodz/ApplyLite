import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildSkillGrowthOverview, generateSkillLearningPlan, listSkillLearningPlans, setLearningPlanStatus } from "../services/skillGrowth.js";

const PlanInput = z.object({ skill: z.string().min(1).max(120) });
const StatusInput = z.object({ status: z.enum(["suggested", "learning", "built", "paused"]) });

export async function growthRoutes(app: FastifyInstance) {
  app.get("/growth/overview", async () => buildSkillGrowthOverview());
  app.get("/growth/plans", async () => listSkillLearningPlans());
  app.post("/growth/plan", async (request) => {
    const { skill } = PlanInput.parse(request.body);
    return generateSkillLearningPlan(skill.trim());
  });
  app.put<{ Params: { skill: string } }>("/growth/plans/:skill/status", async (request, reply) => {
    const input = StatusInput.parse(request.body);
    const skill = decodeURIComponent(request.params.skill);
    if (!setLearningPlanStatus(skill, input.status)) return reply.code(404).send({ error: "Learning plan not found" });
    return { ok: true };
  });
}
