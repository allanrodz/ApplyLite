import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { initializeDatabase } from "./db/database.js";
import { profileRoutes } from "./routes/profile.js";
import { answerRoutes } from "./routes/answers.js";
import { jobRoutes } from "./routes/jobs.js";
import { aiRoutes } from "./routes/ai.js";
import { applicationRoutes } from "./routes/applications.js";
import { cvRoutes } from "./routes/cv.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { experienceRoutes } from "./routes/experience.js";
import { packageRoutes } from "./routes/packages.js";
import { bootstrapDiscoverySources } from "./services/discovery.js";
import { closeAllApplicationBrowsers } from "./automation/sessionManager.js";
import { automationRoutes } from "./routes/automation.js";
import { growthRoutes } from "./routes/growth.js";
import { trackerRoutes } from "./routes/tracker.js";
import { outcomeLearningRoutes } from "./routes/outcomeLearning.js";
import { dailyDiscoveryRoutes } from "./routes/dailyDiscovery.js";
import { applicationPrepRoutes } from "./routes/applicationPrep.js";
import { careerCoachRoutes } from "./routes/careerCoach.js";
import { systemRoutes } from "./routes/system.js";
import { gmailRoutes } from "./routes/gmail.js";
import { startDailyDiscoveryScheduler } from "./services/dailyDiscovery.js";
import { startApplicationPrepWorker } from "./services/applicationPrep.js";
import { startGmailSyncScheduler } from "./services/gmail.js";

initializeDatabase();
bootstrapDiscoverySources();

const app = Fastify({ logger: true });
await app.register(cors, {
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    try {
      const url = new URL(origin);
      const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (localHost && /^\d+$/.test(url.port || "80")) return callback(null, true);
    } catch {
      // Fall through to the configured exact origin check.
    }
    if (origin === config.webOrigin) return callback(null, true);
    callback(new Error(`Origin ${origin} is not allowed by ApplyLite local CORS policy`), false);
  }
});
await app.register(multipart, {
  limits: {
    files: 1,
    fileSize: 10 * 1024 * 1024
  }
});

app.get("/health", async () => ({ ok: true, service: "apply-lite-api" }));
await app.register(profileRoutes);
await app.register(answerRoutes);
await app.register(jobRoutes);
await app.register(aiRoutes);
await app.register(applicationRoutes);
await app.register(cvRoutes);
await app.register(discoveryRoutes);
await app.register(experienceRoutes);
await app.register(packageRoutes);
await app.register(automationRoutes);
await app.register(growthRoutes);
await app.register(trackerRoutes);
await app.register(outcomeLearningRoutes);
await app.register(dailyDiscoveryRoutes);
await app.register(applicationPrepRoutes);
await app.register(careerCoachRoutes);
await app.register(systemRoutes);
await app.register(gmailRoutes);

app.setErrorHandler((error: FastifyError, _request, reply) => {
  app.log.error(error);
  const statusCode = typeof error.statusCode === "number" ? error.statusCode : 400;
  reply.code(statusCode).send({ error: error.message });
});

let stopDailyDiscoveryScheduler: (() => void) | null = null;
let stopApplicationPrepWorker: (() => void) | null = null;
let stopGmailSyncScheduler: (() => void) | null = null;

app.addHook("onClose", async () => {
  stopDailyDiscoveryScheduler?.();
  stopApplicationPrepWorker?.();
  stopGmailSyncScheduler?.();
  await closeAllApplicationBrowsers();
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await app.close(); } finally { process.exit(0); }
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "127.0.0.1" });
stopDailyDiscoveryScheduler = startDailyDiscoveryScheduler(app.log);
stopApplicationPrepWorker = startApplicationPrepWorker(app.log);
stopGmailSyncScheduler = startGmailSyncScheduler(app.log);
