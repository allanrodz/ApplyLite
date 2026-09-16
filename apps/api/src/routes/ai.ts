import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { askOllama, ollamaHealth } from "../services/ollama.js";

const PromptSchema = z.object({ prompt: z.string().min(1).max(20_000) });

export async function aiRoutes(app: FastifyInstance) {
  app.get("/ai/health", async () => ({ available: await ollamaHealth() }));

  app.post("/ai/generate", async (request, reply) => {
    const { prompt } = PromptSchema.parse(request.body);
    try {
      return { text: await askOllama(prompt) };
    } catch (error) {
      reply.code(503);
      return { error: error instanceof Error ? error.message : "Ollama unavailable" };
    }
  });
}
