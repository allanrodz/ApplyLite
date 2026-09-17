import { providerDiagnostics,probeProvider,publicAiSettings,saveAiPreferences } from "../services/aiProvider.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { askOllama } from "../services/ollama.js";

const PromptSchema = z.object({ prompt: z.string().min(1).max(20_000) });

export async function aiRoutes(app: FastifyInstance) {
  app.get("/ai/settings",async()=>publicAiSettings());
  app.put("/ai/settings",async req=>saveAiPreferences(z.object({mode:z.enum(["local_only","local_then_cloud","cloud_preferred"]),cloudConsent:z.boolean(),groqModel:z.enum(["openai/gpt-oss-20b","openai/gpt-oss-120b"]),groqApiKey:z.string().max(500).optional(),clearKey:z.boolean().optional()}).parse(req.body)));
  app.get("/ai/providers",async()=>providerDiagnostics());
  app.post("/ai/providers/test",async req=>probeProvider(z.object({provider:z.enum(["ollama","groq"])}).parse(req.body).provider));
  app.get("/ai/health", async () => {
    try {
      const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error("Ollama service unavailable");
      const body = await response.json() as { models?: { name?: string; model?: string }[] };
      const models = (body.models || []).flatMap(m => [m.name || "", m.model || ""]).filter(Boolean);
      const normalize = (name: string) => name.includes(":") ? name : `${name}:latest`;
      const modelAvailable = models.some(name => normalize(name) === normalize(config.ollamaModel));
      return { available: modelAvailable, serviceAvailable: true, modelAvailable, model: config.ollamaModel };
    } catch { return { available: false, serviceAvailable: false, modelAvailable: false, model: config.ollamaModel }; }
  });

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
