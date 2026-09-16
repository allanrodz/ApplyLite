import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createApplicationExport,
  createBackup,
  getBackupPath,
  getExportPath,
  getSystemDiagnostics,
  getSystemDoctor,
  listBackups,
  resetLocalData,
  stageRestore
} from "../services/systemMaintenance.js";
import { closeAllApplicationBrowsers } from "../automation/sessionManager.js";

const BackupSchema = z.object({ label: z.string().max(40).optional() });
const ResetSchema = z.object({ confirmation: z.string() });

export async function systemRoutes(app: FastifyInstance) {
  app.get("/system/doctor", async () => getSystemDoctor());
  app.get("/system/diagnostics", async () => getSystemDiagnostics());
  app.get("/system/backups", async () => listBackups());

  app.post("/system/backups", async (request, reply) => {
    try {
      const input = BackupSchema.parse(request.body ?? {});
      return await createBackup(input.label ?? "manual");
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { name: string } }>("/system/backups/:name/download", async (request, reply) => {
    try {
      const filePath = getBackupPath(decodeURIComponent(request.params.name));
      reply.header("content-disposition", `attachment; filename="${filePath.split(/[\\/]/).pop()}"`);
      return reply.send(fs.createReadStream(filePath));
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { name: string } }>("/system/backups/:name/restore", async (request, reply) => {
    try {
      await closeAllApplicationBrowsers();
      return stageRestore(decodeURIComponent(request.params.name));
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { format: string } }>("/system/export/:format", async (request, reply) => {
    const format = request.params.format;
    if (format !== "json" && format !== "csv") return reply.code(400).send({ error: "Format must be json or csv." });
    try {
      return createApplicationExport(format);
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { name: string } }>("/system/exports/:name/download", async (request, reply) => {
    try {
      const filePath = getExportPath(decodeURIComponent(request.params.name));
      reply.header("content-disposition", `attachment; filename="${filePath.split(/[\\/]/).pop()}"`);
      return reply.send(fs.createReadStream(filePath));
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/system/reset", async (request, reply) => {
    try {
      const input = ResetSchema.parse(request.body ?? {});
      await closeAllApplicationBrowsers();
      return await resetLocalData(input.confirmation);
    } catch (error) {
      return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
