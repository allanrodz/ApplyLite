import type { FastifyInstance } from "fastify";
import { buildOutcomeLearningModel } from "../services/outcomeLearning.js";

export async function outcomeLearningRoutes(app: FastifyInstance) {
  app.get("/outcome-learning/model", async () => buildOutcomeLearningModel());
}
