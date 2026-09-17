import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(apiRoot, "../..");
function readEnv(dir: string) { const file = path.join(dir, ".env"); return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {}; }
const rootEnv = readEnv(root), legacyEnv = readEnv(apiRoot);
// Preserve established API-local settings; new installs can use one root .env.
const env = { ...rootEnv, ...legacyEnv, ...process.env };
function positive(key: string, fallback: number) { const n = Number(env[key]); return Number.isInteger(n) && n > 0 ? n : fallback; }
function localPath(key: string, fallback: string) {
  const value = env[key] || fallback;
  if (path.isAbsolute(value)) return value;
  if (process.env[key]) return path.resolve(process.cwd(), value);
  if (legacyEnv[key]) return path.resolve(apiRoot, value);
  const atRoot = path.resolve(root, value), atLegacy = path.resolve(apiRoot, value);
  return !fs.existsSync(atRoot) && fs.existsSync(atLegacy) ? atLegacy : atRoot;
}
export const config = {
  aiMode: (["local_only","local_then_cloud","cloud_preferred"].includes(env.AI_MODE || "") ? env.AI_MODE : "local_only") as "local_only"|"local_then_cloud"|"cloud_preferred",
  cloudAiConsent: env.CLOUD_AI_CONSENT === "true", groqModel: env.GROQ_MODEL || "openai/gpt-oss-20b", groqApiKey: env.GROQ_API_KEY || "",
  version: "0.15.0", port: positive("API_PORT", 4310), webOrigin: env.WEB_ORIGIN || "http://localhost:5173",
  databasePath: localPath("DATABASE_PATH", "./data/apply-lite.db"), storagePath: localPath("STORAGE_PATH", "./storage"),
  ollamaBaseUrl: (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, ""), ollamaModel: env.OLLAMA_MODEL || "qwen3:4b",
  ollamaTimeoutMs: positive("OLLAMA_TIMEOUT_MS", 180_000), cvAiTimeoutMs: positive("CV_AI_TIMEOUT_MS", 180_000),
  browserHeadless: (env.BROWSER_HEADLESS || "false").toLowerCase() === "true"
};
