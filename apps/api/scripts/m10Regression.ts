import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const startCwd = process.cwd();
const workspaceRoot = path.resolve(startCwd, "../..");
const repoRoot = fs.existsSync(path.join(workspaceRoot, "package.json")) && fs.existsSync(path.join(workspaceRoot, "apps", "api"))
  ? workspaceRoot
  : startCwd;
process.chdir(repoRoot);
process.env.DATABASE_PATH = "./data/m10-regression.db";
process.env.STORAGE_PATH = "./storage/m10-regression";
process.env.APPLYLITE_TEST_MODE = "true";

const dbFile = path.resolve(repoRoot, "data/m10-regression.db");
for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${dbFile}${suffix}`, { force: true });

const { initializeDatabase, db } = await import("../src/db/database.js");
const { runGmailRegressionFixtures } = await import("../src/services/gmail.js");
initializeDatabase();

db.prepare(`INSERT INTO jobs (title, company, description, source_url, ats, score) VALUES (?, ?, ?, ?, ?, ?)`)
  .run("Software Engineer", "Example Tech", "Fixture role", "https://jobs.example-tech.com/software-engineer", "generic", 82);
const jobId = Number((db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
db.prepare(`INSERT INTO applications (job_id, state, ats, outcome, submitted_at) VALUES (?, 'SUBMITTED', 'generic', 'WAITING', CURRENT_TIMESTAMP)`)
  .run(jobId);

try {
  const result = runGmailRegressionFixtures();
  assert.equal(result.scope, "https://www.googleapis.com/auth/gmail.readonly", "M10 must request only Gmail read-only scope");
  assert.equal(result.scope.includes("modify"), false, "M10 must not request Gmail modify scope");
  assert.equal(result.interview.classification.classification, "INTERVIEW");
  assert.equal(result.interview.match.applicationId != null, true, "interview fixture should match the Example Tech application");
  assert.equal(result.interview.classification.details.meetingLink.includes("meet.google.com"), true, "meeting link should be extracted");
  assert.equal(result.rejection.classification, "REJECTION");
  assert.equal(result.assessment.classification, "ASSESSMENT");
  assert.equal(result.noise.indeed, false, "Indeed job alerts must not enter Gmail Intelligence");
  assert.equal(result.noise.glassdoor, false, "Glassdoor community/job-alert mail must not enter Gmail Intelligence");
  assert.equal(result.directReplyRelevant, true, "direct application replies should remain relevant");
  assert.equal(db.pragma("quick_check", { simple: true }), "ok");
  assert.ok(Number(db.pragma("user_version", { simple: true })) >= 10, "Gmail schema remains installed after additive migrations");
  assert.ok(db.prepare("SELECT version FROM schema_migrations WHERE version = 10").get(), "Gmail migration history is preserved");
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gmail_messages'").get(), "Gmail data table is preserved");
  console.log("M10 regression PASS");
  console.log("OAuth safety: gmail.readonly only; no send/modify scope.");
  console.log("Classification: interview, rejection and assessment fixtures passed.");
  console.log("Matching: recruiter email matched the synthetic application.");
  console.log("Noise gate: Indeed/Glassdoor alerts rejected; direct application reply preserved.");
} finally {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${dbFile}${suffix}`, { force: true });
}
