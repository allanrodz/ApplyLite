import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export const config = {
  port: Number(process.env.API_PORT ?? 4310),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  databasePath: process.env.DATABASE_PATH ?? "./data/apply-lite.db",
  storagePath: process.env.STORAGE_PATH ?? "./storage",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen3:8b",
  ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 180_000),
  browserHeadless: (process.env.BROWSER_HEADLESS ?? "false").toLowerCase() === "true"
};
