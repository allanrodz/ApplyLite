import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { CandidateFactsSchema, ProfileSchema } from "@apply-lite/shared";
import { z } from "zod";
import { db } from "../db/database.js";
import { config } from "../config.js";
import { extractCandidateFacts, extractCvText } from "../services/cv.js";

const TextImportSchema = z.object({
  sourceName: z.string().min(1).default("pasted-cv.txt"),
  text: z.string().min(80).max(100_000)
});

function serializeRow(row: Record<string, unknown> & { factsJson: string }) {
  return {
    id: Number(row.id),
    sourceName: String(row.sourceName),
    sourceType: String(row.sourceType),
    rawText: String(row.rawText),
    facts: CandidateFactsSchema.parse(JSON.parse(row.factsJson)),
    createdAt: String(row.createdAt)
  };
}

function latestCv() {
  return db.prepare(`
    SELECT id, source_name AS sourceName, source_type AS sourceType,
           raw_text AS rawText, facts_json AS factsJson, created_at AS createdAt
    FROM cv_documents ORDER BY id DESC LIMIT 1
  `).get() as (Record<string, unknown> & { factsJson: string }) | undefined;
}

async function persistCv(sourceName: string, sourceType: string, rawText: string) {
  const facts = await extractCandidateFacts(rawText);
  const result = db.prepare(`
    INSERT INTO cv_documents (source_name, source_type, raw_text, facts_json)
    VALUES (?, ?, ?, ?)
  `).run(sourceName, sourceType, rawText, JSON.stringify(facts));

  const row = db.prepare(`
    SELECT id, source_name AS sourceName, source_type AS sourceType,
           raw_text AS rawText, facts_json AS factsJson, created_at AS createdAt
    FROM cv_documents WHERE id = ?
  `).get(Number(result.lastInsertRowid)) as Record<string, unknown> & { factsJson: string };

  return serializeRow(row);
}


function splitCandidateName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function mergeUnique(existing: string[], incoming: string[]) {
  const byKey = new Map<string, string>();
  for (const item of [...existing, ...incoming]) {
    const value = item.trim();
    if (value) byKey.set(value.toLowerCase(), value);
  }
  return [...byKey.values()];
}

export async function cvRoutes(app: FastifyInstance) {
  app.get("/cv/current", async () => {
    const row = latestCv();
    return row ? serializeRow(row) : null;
  });

  app.post("/cv/import-text", async (request, reply) => {
    const input = TextImportSchema.parse(request.body);
    request.log.info({ chars: input.text.length }, "CV text received; extracting candidate facts with Ollama");
    const saved = await persistCv(input.sourceName, "text/plain", input.text);
    request.log.info({ cvId: saved.id }, "CV text import completed");
    reply.code(201);
    return saved;
  });

  app.post("/cv/upload", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Choose a CV file first" });

    request.log.info({ filename: file.filename, mimetype: file.mimetype }, "CV upload received");
    const buffer = await file.toBuffer();
    if (!buffer.length) return reply.code(400).send({ error: "Uploaded CV is empty" });

    request.log.info({ bytes: buffer.length }, "Extracting text from CV file");
    const rawText = await extractCvText(buffer, file.filename, file.mimetype);
    if (rawText.length < 80) return reply.code(400).send({ error: "Could not extract enough text from this CV" });
    request.log.info({ chars: rawText.length }, "CV text extracted; starting Ollama fact extraction");

    const storageDir = path.resolve(process.cwd(), config.storagePath, "cv");
    fs.mkdirSync(storageDir, { recursive: true });
    const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    fs.writeFileSync(path.join(storageDir, `${Date.now()}-${safeName}`), buffer);

    const saved = await persistCv(file.filename, file.mimetype, rawText);
    request.log.info({ cvId: saved.id }, "CV upload and fact extraction completed");
    reply.code(201);
    return saved;
  });

  app.post("/cv/current/merge-profile", async (_request, reply) => {
    const row = latestCv();
    if (!row) return reply.code(404).send({ error: "No CV imported yet" });
    const cv = serializeRow(row);

    const existingRow = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
    const profile = existingRow ? ProfileSchema.parse(JSON.parse(existingRow.data_json)) : ProfileSchema.parse({});

    const newestEmployment = cv.facts.employment[0];
    const extractedName = splitCandidateName(cv.facts.fullName);
    const merged = ProfileSchema.parse({
      ...profile,
      firstName: profile.firstName || extractedName.firstName,
      lastName: profile.lastName || extractedName.lastName,
      currentTitle: profile.currentTitle || newestEmployment?.title || cv.facts.headline,
      skills: mergeUnique(profile.skills, cv.facts.skills),
      summary: profile.summary || cv.facts.summary
    });

    db.prepare(`
      INSERT INTO profile (id, data_json, updated_at)
      VALUES (1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify(merged));

    return { ok: true, profile: merged };
  });
}
