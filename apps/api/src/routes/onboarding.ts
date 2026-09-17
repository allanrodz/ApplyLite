import type { FastifyInstance } from "fastify";
import { onboardingStatus } from "../services/onboarding.js";
export async function onboardingRoutes(app: FastifyInstance) {
  app.get("/onboarding/status", async () => onboardingStatus());
}
