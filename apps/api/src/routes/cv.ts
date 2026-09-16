import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CandidateFactsSchema, ProfileSchema } from "@apply-lite/shared";
import { z } from "zod";
import { db } from "../db/database.js";
import { config } from "../config.js";
import { extractCvText } from "../services/cv.js";
import { localDraft, mergeFacts, enhanceDraft, unique } from "../services/cvReview.js";

const TextInput = z.object({ text: z.string().min(80).max(100_000), sourceName: z.string().min(1).max(300).default("pasted-cv.txt") });
const EditedFacts = z.object({ facts: CandidateFactsSchema, revision: z.number().int().positive() });
const MergeInput = z.object({ cvId: z.number().int().positive() });
type CvRow = { id: number; source_name: string; source_type: string; raw_text: string; facts_json: string; created_at: string };
type DraftRow = CvRow & { status: string; message: string; revision: number; published_cv_id: number | null };
const current = () => db.prepare("SELECT * FROM cv_documents ORDER BY id DESC LIMIT 1").get() as CvRow | undefined;
const draft = (id: number) => db.prepare("SELECT * FROM cv_imports WHERE id=?").get(id) as DraftRow | undefined;
const encode = (row: CvRow) => ({ id: row.id, sourceName: row.source_name, sourceType: row.source_type, rawText: row.raw_text, facts: CandidateFactsSchema.parse(JSON.parse(row.facts_json)), createdAt: row.created_at });
const encodeDraft = (row: DraftRow) => ({ ...encode(row), status: row.status, message: row.message, revision: row.revision, publishedCvId: row.published_cv_id });
let active: number | null = null;
function saveDraft(name: string, type: string, text: string, facts = localDraft(text)) {
  const result = db.prepare("INSERT INTO cv_imports(source_name,source_type,raw_text,facts_json,status,message) VALUES(?,?,?,?,'draft','Review the local draft, or use optional AI enhancement.')").run(name, type, text, JSON.stringify(facts));
  return encodeDraft(draft(Number(result.lastInsertRowid))!);
}
export async function cvRoutes(app: FastifyInstance) {
  // Imports are drafts in a separate table. Existing matching/package code only sees reviewed cv_documents.
  db.exec(`CREATE TABLE IF NOT EXISTS cv_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_name TEXT NOT NULL, source_type TEXT NOT NULL,
    raw_text TEXT NOT NULL, facts_json TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1, published_cv_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.prepare("UPDATE cv_imports SET status='needs_review',message='AI was interrupted; your draft is safe. Edit it or retry.' WHERE status='enhancing'").run();
  app.get("/cv/current", async () => { const row = current(); return row ? encode(row) : null; });
  app.get("/cv/draft", async () => { const row = db.prepare("SELECT * FROM cv_imports ORDER BY id DESC LIMIT 1").get() as DraftRow | undefined; return row ? encodeDraft(row) : null; });
  app.get<{ Params: { id: string } }>("/cv/drafts/:id", async (req, reply) => { const row = draft(Number(req.params.id)); return row ? encodeDraft(row) : reply.code(404).send({ error: "CV draft not found." }); });
  app.post("/cv/drafts/from-current", async (_req, reply) => {
    const row = current();
    return row ? reply.code(201).send(saveDraft(row.source_name, row.source_type, row.raw_text, CandidateFactsSchema.parse(JSON.parse(row.facts_json)))) : reply.code(404).send({ error: "No saved CV yet." });
  });
  app.post("/cv/import-text", async (request, reply) => {
    const data = TextInput.parse(request.body);
    return reply.code(201).send(saveDraft(data.sourceName, "text/plain", data.text));
  });
  app.post("/cv/upload", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Choose a CV file first." });
    let bytes: Buffer;
    try { bytes = await file.toBuffer(); } catch { return reply.code(413).send({ error: "CV uploads must be no larger than 10 MB." }); }
    if (!bytes.length) return reply.code(400).send({ error: "The file is empty." });
    let text: string;
    try { text = await extractCvText(bytes, file.filename, file.mimetype); }
    catch { return reply.code(422).send({ error: "Could not read this file. Use an unencrypted PDF, DOCX, TXT or Markdown document, or paste CV text." }); }
    if (text.length < 80) return reply.code(422).send({ error: "Not enough selectable text was found. Scanned/image-only PDFs need a text-based export or pasted text. OCR is not included." });
    if (text.length > 100_000) return reply.code(413).send({ error: "CV text exceeds 100,000 characters. Use a shorter document." });
    const dir = path.resolve(config.storagePath, "cv"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${randomUUID()}-${path.basename(file.filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)}`), bytes);
    const result = saveDraft(file.filename, file.mimetype, text);
    request.log.info({ draftId: result.id, chars: text.length }, "CV draft saved without waiting for AI");
    return reply.code(201).send(result);
  });
  app.post<{ Params: { id: string } }>("/cv/drafts/:id/enhance", async (req, reply) => {
    const row = draft(Number(req.params.id));
    if (!row) return reply.code(404).send({ error: "Draft not found." });
    if (active !== null) return reply.code(409).send({ error: "Another CV enhancement is running. Your draft can still be edited and saved." });
    if (row.status === "ready") return reply.code(409).send({ error: "This CV is reviewed. Edit it directly or import it again as a new AI draft." });
    if (row.raw_text.length > 30_000) return reply.code(422).send({ error: "Optional AI enhancement supports 30,000 characters. Your full source is saved and editable without AI." });
    active = row.id;
    db.prepare("UPDATE cv_imports SET status='enhancing',message='Optional AI is running. You may edit and save; AI will not overwrite a manual save.' WHERE id=?").run(row.id);
    const run = async () => {
      let facts = CandidateFactsSchema.parse(JSON.parse(row.facts_json));
      let sections = 0;
      try {
        await enhanceDraft(row.raw_text, extra => {
          facts = mergeFacts(facts, extra); sections++;
          const result = db.prepare("UPDATE cv_imports SET facts_json=?,message=? WHERE id=? AND revision=? AND status='enhancing'")
            .run(JSON.stringify(facts), `Processed ${sections} source section(s). Review the final draft before using it.`, row.id, row.revision);
          return result.changes > 0;
        });
        db.prepare("UPDATE cv_imports SET status='needs_review',message='AI draft ready. Check completeness, grouping and dates.',revision=revision+1 WHERE id=? AND revision=? AND status='enhancing'").run(row.id, row.revision);
      } catch {
        db.prepare("UPDATE cv_imports SET status='needs_review',message='AI could not finish. Your source and any extracted draft facts are safe. Edit and save them, or retry later.',revision=revision+1 WHERE id=? AND revision=? AND status='enhancing'").run(row.id, row.revision);
        req.log.warn({ draftId: row.id }, "Optional AI enhancement failed; draft retained");
      } finally { active = null; }
    };
    setImmediate(() => { void run(); });
    return reply.code(202).send(encodeDraft(draft(row.id)!));
  });
  app.put<{ Params: { id: string } }>("/cv/drafts/:id", async (req, reply) => {
    const id = Number(req.params.id), input = EditedFacts.parse(req.body);
    const result = db.transaction(() => {
      const row = draft(id);
      if (!row) return { error: "Draft not found.", status: 404 };
      if (row.revision !== input.revision) return { error: "The saved draft changed. Reload it before saving to avoid overwriting newer changes.", status: 409 };
      const factJson = JSON.stringify(input.facts);
      // Publish a reviewed snapshot. Historical CVs and application artefacts are retained.
      const inserted = db.prepare("INSERT INTO cv_documents(source_name,source_type,raw_text,facts_json) VALUES(?,?,?,?)").run(row.source_name, row.source_type, row.raw_text, factJson);
      db.prepare("UPDATE cv_imports SET facts_json=?,status='ready',message='Reviewed CV saved for matching and documents.',revision=revision+1,published_cv_id=? WHERE id=?").run(factJson, Number(inserted.lastInsertRowid), id);
      return { value: encodeDraft(draft(id)!) };
    })();
    return result.error ? reply.code(result.status!).send({ error: result.error }) : result.value;
  });
  app.post("/cv/current/merge-profile", async (request, reply) => {
    const input = MergeInput.parse(request.body), row = current();
    if (!row || row.id !== input.cvId) return reply.code(409).send({ error: "Reload the latest reviewed CV before merging." });
    const facts = encode(row).facts;
    const stored = db.prepare("SELECT data_json FROM profile WHERE id=1").get() as { data_json: string } | undefined;
    const profile = ProfileSchema.parse(stored ? JSON.parse(stored.data_json) : {});
    const existingName = `${profile.firstName} ${profile.lastName}`.trim().toLocaleLowerCase();
    if (existingName && facts.fullName && existingName !== facts.fullName.toLocaleLowerCase()) return reply.code(409).send({ error: "CV and Profile names differ. Check and edit Profile first. Each installation is a single-person workspace." });
    const parts = facts.fullName.trim().split(/\s+/).filter(Boolean);
    const merged = ProfileSchema.parse({ ...profile, firstName: profile.firstName || parts[0] || "", lastName: profile.lastName || parts.slice(1).join(" "), email: profile.email || facts.email, phone: profile.phone || facts.phone,
      currentTitle: profile.currentTitle || facts.employment[0]?.title || facts.headline, skills: unique([...profile.skills, ...facts.skills]), summary: profile.summary || facts.summary });
    db.prepare("INSERT INTO profile(id,data_json,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=CURRENT_TIMESTAMP").run(JSON.stringify(merged));
    return { ok: true, profile: merged };
  });
}
