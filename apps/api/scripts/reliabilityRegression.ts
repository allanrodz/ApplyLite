import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { CandidateFactsSchema, ProfileSchema, JobInputSchema, JobRequirementsSchema } from "@apply-lite/shared";

// No actual CVs, credentials, employer requests or live model required.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "applylite-reliability-"));
process.env.DATABASE_PATH = path.join(temp, "test.db");
process.env.STORAGE_PATH = path.join(temp, "storage");
process.env.CV_AI_TIMEOUT_MS = "100";
process.env.APPLYLITE_TEST_MODE = "true";
process.env.OLLAMA_MODEL = "fixture-model";
let mode = "slow", calls = 0;
const mock = http.createServer((req, res) => {
  if (req.url === "/api/tags") { res.setHeader("Content-Type", "application/json"); res.end('{"models":[]}'); return; }
  calls++; req.resume(); const selected = mode;
  setTimeout(() => { if (!res.destroyed) { res.setHeader("Content-Type", "application/json"); res.end(selected === "invalid" ? '{}' : JSON.stringify({ message: { content: JSON.stringify({ fullName: "Example Person", skills: ["Excel", "Imaginary Skill"] }) }, done_reason: "stop" })); } }, selected === "slow" ? 250 : selected === "delayed" ? 60 : 5);
});
await new Promise<void>(resolve => mock.listen(0, "127.0.0.1", resolve));
process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${(mock.address() as import("node:net").AddressInfo).port}`;
const database = await import("../src/db/database.js"); database.initializeDatabase();
const { cvRoutes } = await import("../src/routes/cv.js");
const { aiRoutes } = await import("../src/routes/ai.js");
const { localDraft, groundFacts } = await import("../src/services/cvReview.js");
const { extractCvText } = await import("../src/services/cv.js");
const { skillMatches, targets, planCareerQueries } = await import("../src/services/matching.js");
const { scoreJob } = await import("../src/services/scoring.js");
const { deriveExperienceSummary } = await import("../src/services/experience.js");
const { matchField, rememberMapping } = await import("../src/automation/fieldIntelligence.js");
const app = Fastify(); await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }); await app.register(cvRoutes); await app.register(aiRoutes);
const source = "Example Person\nEmail: person@example.invalid\nPhone: +353 800 000 000\nProfessional summary\nAccounts assistant with payroll and customer service experience.\nSkills\nExcel, Payroll, Customer service\nEmployment\nAccounts Assistant | Example Company | Jan 2021 - Dec 2022 | Dublin\nEducation\nDiploma in Accounting, Example College\nLanguages\nEnglish\n";
let count = 0;
function check(name: string, fn: () => void) { fn(); count++; console.log(`PASS ${name}`); }
async function settled(id: number) {
  for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 20)); const value = (await app.inject({ method: "GET", url: `/cv/drafts/${id}` })).json(); if (value.status !== "enhancing") return value; }
  throw new Error("Enhancement failed to settle");
}
try {
  check("offline import captures explicit contacts and skills without guessing qualifications", () => { const f = localDraft(source); assert.equal(f.fullName, "Example Person"); assert.equal(f.email, "person@example.invalid"); assert.ok(f.skills.includes("Payroll")); assert.equal(f.education[0].qualification, "Diploma in Accounting"); });
  check("AI values require whole source terms", () => { const f = groundFacts({ skills: ["Java", "C", "R", "Excel", "Imaginary Skill"], education: null }, "JavaScript and C++ experience; Excel reports"); assert.deepEqual(f.skills, ["Excel"]); });
  check("precise skills distinguish neighbouring technologies and compound requirements", () => { for (const [a,b] of [["Java","JavaScript"],["C","C++"],["R","Customer service"],["Excel","Excellent communication"],["React","React Native"],["React","React and Python"]]) assert.equal(skillMatches(a,b), false); assert.equal(skillMatches("JS", "JavaScript"), true); assert.equal(skillMatches("Excel", "Microsoft Excel"), true); });
  check("chosen career targets override an unrelated current job", () => { assert.deepEqual(targets({ currentTitle: "Software Engineer", targetTitles: ["Accounts Assistant"] }), ["Accounts Assistant"]); });
  check("non-IT searches expand only chosen career families", () => { const q = planCareerQueries(["Accounts Assistant", "Healthcare Assistant"]); assert.ok(q.includes("Accounts Assistant")); assert.ok(q.includes("Healthcare Assistant")); assert.ok(q.some(s => /payroll/i.test(s))); assert.ok(q.every(s => !/software|cloud|cyber/i.test(s))); assert.deepEqual(planCareerQueries([]), []); });
  check("different professions use their own query families", () => { for (const title of ["Teacher", "Marketing Assistant", "Hotel Receptionist", "Legal Assistant", "Warehouse Operative"]) assert.ok(planCareerQueries([title]).includes(title)); });
  check("unrelated title does not receive current-role credit", () => { const p = ProfileSchema.parse({ currentTitle: "Software Engineer", targetTitles: ["Accounts Assistant"], skills: ["Excel"] }); const job = JobInputSchema.parse({ title: "Software Engineer", company: "Example", description: "Build software services in JavaScript" }); const score = scoreJob(p, job, JobRequirementsSchema.parse({ requiredSkills: ["React"] })); assert.equal(score.title, 0); assert.ok(score.total <= 49); });
  check("empty profile does not get a misleading fit", () => { assert.equal(scoreJob(ProfileSchema.parse({}), JobInputSchema.parse({ title: "Accountant", company: "Example", description: "Prepare monthly financial reports" })).total, 0); });
  check("remote preference alone is not a country match", () => { const score = scoreJob(ProfileSchema.parse({ targetTitles: ["Accountant"], preferredLocations: ["Ireland", "Remote"] }), JobInputSchema.parse({ title: "Accountant", company: "Example", description: "Prepare accounts remotely", location: "US - Remote" }), JobRequirementsSchema.parse({ workplaceType: "remote" })); assert.ok(score.location < 10); assert.ok(score.concerns.some(s => /eligibility/.test(s))); });
  check("missing end dates do not fabricate current employment", () => { assert.equal(deriveExperienceSummary(CandidateFactsSchema.parse({ employment: [{ title: "Accountant", employer: "Example", startDate: "Jan 2010", endDate: "" }] })).parseableEmploymentCount, 0); });
  check("unrelated employment is not relevant years", () => { const f = CandidateFactsSchema.parse({ employment: [{ title: "Nurse", employer: "Example", startDate: "Jan 2020", endDate: "Dec 2023" }] }); const score = scoreJob(ProfileSchema.parse({ yearsExperience: 10 }), JobInputSchema.parse({ title: "Software Engineer", company: "Example", description: "Build web applications" }), JobRequirementsSchema.parse({ requiredExperienceYears: 5 }), f); assert.equal(score.candidateExperienceYears, 0); });
  const control = { label: "", tag: "input", type: "text", name: "", id: "", placeholder: "", autocomplete: "section-user given-name", ariaLabel: "", nearbyText: "", fingerprint: "test" };
  const candidates = [{ key: "first_name", label: "First name", value: "Example", source: "profile" }, { key: "email", label: "Email", value: "person@example.invalid", source: "profile" }] as Parameters<typeof matchField>[2];
  check("autocomplete handles section tokens and hyphens", () => { assert.equal(matchField("generic", control, candidates)?.fieldKey, "first_name"); });
  check("referee email is not filled with candidate email", () => { assert.equal(matchField("generic", { ...control, label: "Referee email", type: "email", autocomplete: "email" }, candidates), null); });
  check("uncertain learned mapping is not promoted to high confidence", () => { rememberMapping({ ats: "generic", descriptor: control, fieldKey: "email", confidence: 0.65, source: "observed-filled-field" }); assert.equal(matchField("generic", { ...control, autocomplete: "" }, candidates), null); });
  check("fresh install has no saved CV", () => { assert.equal(database.db.prepare("SELECT COUNT(*) AS n FROM cv_documents").get() && (database.db.prepare("SELECT COUNT(*) AS n FROM cv_documents").get() as any).n, 0); });
  const before = performance.now(); const imported = await app.inject({ method: "POST", url: "/cv/import-text", payload: { text: source } }); let d = imported.json();
  check("import returns quickly without any model request", () => { assert.equal(imported.statusCode, 201); assert.equal(d.status, "draft"); assert.equal(calls, 0); assert.ok(performance.now() - before < 2000); });
  check("draft is not silently used as reviewed CV evidence", () => { assert.equal((database.db.prepare("SELECT COUNT(*) AS n FROM cv_documents").get() as any).n, 0); });
  const started = await app.inject({ method: "POST", url: `/cv/drafts/${d.id}/enhance`, payload: {} });
  check("enhancement is asynchronous", () => assert.equal(started.statusCode, 202)); d = await settled(d.id);
  check("timeout preserves the full source and editable draft", () => { assert.equal(d.status, "needs_review"); assert.equal(d.rawText, source); assert.equal(d.facts.email, "person@example.invalid"); });
  mode = "invalid"; await app.inject({ method: "POST", url: `/cv/drafts/${d.id}/enhance`, payload: {} }); d = await settled(d.id);
  check("invalid AI output does not erase source fields", () => { assert.equal(d.facts.fullName, "Example Person"); });
  mode = "success"; await app.inject({ method: "POST", url: `/cv/drafts/${d.id}/enhance`, payload: {} }); d = await settled(d.id);
  check("successful AI remains unreviewed and excludes invented skills", () => { assert.equal(d.status, "needs_review"); assert.ok(!d.facts.skills.includes("Imaginary Skill")); });
  const saved = await app.inject({ method: "PUT", url: `/cv/drafts/${d.id}`, payload: { facts: d.facts, revision: d.revision } }); const s = saved.json();
  check("reviewed facts become active evidence", () => { assert.equal(saved.statusCode, 200); assert.equal(s.status, "ready"); assert.ok(s.publishedCvId); });
  const stale = await app.inject({ method: "PUT", url: `/cv/drafts/${d.id}`, payload: { facts: d.facts, revision: d.revision } });
  check("stale edits cannot overwrite newer reviews", () => assert.equal(stale.statusCode, 409));
  const merge = await app.inject({ method: "POST", url: "/cv/current/merge-profile", payload: { cvId: s.publishedCvId } });
  check("reviewed contacts merge without invented search targets", () => { assert.equal(merge.statusCode, 200); assert.equal(merge.json().profile.email, "person@example.invalid"); assert.deepEqual(merge.json().profile.targetTitles, []); });
  const next = (await app.inject({ method: "POST", url: "/cv/import-text", payload: { text: source } })).json(); mode = "delayed";
  await app.inject({ method: "POST", url: `/cv/drafts/${next.id}/enhance`, payload: {} });
  await app.inject({ method: "PUT", url: `/cv/drafts/${next.id}`, payload: { facts: { ...next.facts, headline: "User reviewed headline" }, revision: next.revision } });
  await new Promise(r => setTimeout(r, 150)); const safe = (await app.inject({ method: "GET", url: `/cv/drafts/${next.id}` })).json();
  check("late AI result cannot overwrite a manual save", () => { assert.equal(safe.status, "ready"); assert.equal(safe.facts.headline, "User reviewed headline"); });
  const health = (await app.inject({ method: "GET", url: "/ai/health" })).json();
  check("running Ollama without configured model is not reported ready", () => { assert.equal(health.serviceAvailable, true); assert.equal(health.modelAvailable, false); assert.equal(health.available, false); });
  const plain = await extractCvText(Buffer.from(source), "cv.txt", "text/plain"); check("plain-text parser retains source", () => assert.equal(plain, source.trim()));
  await assert.rejects(() => extractCvText(Buffer.from("bad"), "bad.exe", "application/octet-stream"), /Unsupported/); count++;

  function zipFixture(files: Record<string, string>) {
    const chunks: Buffer[] = [], directory: Buffer[] = []; let offset = 0;
    function crc32(bytes: Buffer) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
    for (const [name, content] of Object.entries(files)) {
      const filename = Buffer.from(name), bytes = Buffer.from(content), crc = crc32(bytes);
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt32LE(crc,14); local.writeUInt32LE(bytes.length,18); local.writeUInt32LE(bytes.length,22); local.writeUInt16LE(filename.length,26);
      const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt32LE(crc,16); central.writeUInt32LE(bytes.length,20); central.writeUInt32LE(bytes.length,24); central.writeUInt16LE(filename.length,28); central.writeUInt32LE(offset,42);
      chunks.push(local,filename,bytes); directory.push(central,filename); offset += local.length + filename.length + bytes.length;
    }
    const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length,8); end.writeUInt16LE(Object.keys(files).length,10); end.writeUInt32LE(central.length,12); end.writeUInt32LE(offset,16);
    return Buffer.concat([...chunks,central,end]);
  }
  const docx = zipFixture({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + source.split("\n").map(line => '<w:p><w:r><w:t>' + line.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</w:t></w:r></w:p>').join("") + '</w:body></w:document>'
  });
  const docxText = await extractCvText(docx, "fixture.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  check("DOCX parser retains source contacts and paragraphs", () => { assert.match(docxText, /Example Person/); assert.match(docxText, /person@example.invalid/); });
  function pdfFixture(text: string) {
    const stream = `BT /F1 12 Tf 50 750 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
    let pdf = "%PDF-1.4\n"; const offsets: number[] = [];
    objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10,"0")} 00000 n `).join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf);
  }
  const pdf = pdfFixture("Example Person - Accounts assistant. Skills: Excel, Payroll. Email: person@example.invalid. Customer service experience.");
  const pdfText = await extractCvText(pdf, "fixture.pdf", "application/pdf");
  check("PDF selectable text is extracted without AI or OCR", () => assert.match(pdfText, /Accounts assistant/));
  async function upload(filename: string, type: string, bytes: Buffer) {
    const boundary = "applylite-fixture-boundary";
    return app.inject({ method: "POST", url: "/cv/upload", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
  }
  const pdfUpload = await upload("fixture.pdf", "application/pdf", pdf);
  check("PDF upload returns a draft rather than waiting for AI", () => { assert.equal(pdfUpload.statusCode, 201); assert.equal(pdfUpload.json().status, "draft"); });
  const blank = await upload("blank.pdf", "application/pdf", pdfFixture(""));
  check("blank/image-only PDF has an actionable error", () => { assert.equal(blank.statusCode, 422); assert.match(blank.json().error, /selectable text/); });
  const docxUpload = await upload("fixture.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx);
  check("DOCX upload saves its complete text", () => { assert.equal(docxUpload.statusCode, 201); assert.match(docxUpload.json().rawText, /Customer service/); });
  const malformed = await upload("bad.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from("invalid document"));
  check("malformed document does not produce a model timeout", () => assert.equal(malformed.statusCode, 422));
  const oversize = await upload("large.txt", "text/plain", Buffer.alloc(10 * 1024 * 1024 + 1, 65));
  check("oversized file rejected cleanly", () => assert.equal(oversize.statusCode, 413));
  console.log(`Reliability regression PASS: ${count} checks (synthetic data only).`);
} finally {
  await app.close(); mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve())); database.db.close();
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
