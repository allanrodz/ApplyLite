import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "apply-lite-discovery-"));
process.env.DATABASE_PATH = path.join(root, "apply-lite.db");
process.env.STORAGE_PATH = path.join(root, "storage");
process.env.APPLYLITE_TEST_MODE = "true";

let database: typeof import("../src/db/database.js") | null = null;

try {
  // Mirror the real server startup order. Discovery services expect their
  // SQLite tables to exist before bootstrapDiscoverySources() is called.
  database = await import("../src/db/database.js");
  database.initializeDatabase();

  const discovery = await import("../src/services/discovery.js");

  assert.ok(discovery.STARTER_DISCOVERY_SOURCES.length >= 21, "expected Irish-market, global-remote, plus employer-source catalogue");
  discovery.bootstrapDiscoverySources();
  const sources = discovery.listDiscoverySources();
  assert.ok(sources.length >= 20, "starter sources should be seeded into SQLite");

  const keys = new Set(sources.map((source) => `${source.ats}:${source.boardKey.toLowerCase()}`));
  for (const expected of [
    "greenhouse:telnyx54",
    "greenhouse:sonyinteractiveentertainmentglobal",
    "ashby:kota",
    "ashby:openai",
    "lever:cartrawler",
    "greenhouse:bearingpoint",
    "greenhouse:ridgeline",
    "jobsireland:ireland",
    "irishjobs:ireland",
    "remoteok:global"
  ]) {
    assert.ok(keys.has(expected), `missing starter source ${expected}`);
  }

  const broadQueries = discovery.buildDiscoverySearchQueries([
    "Software Developer",
    "Junior Software Developer",
    "Software Engineer",
    "Junior Software Engineer",
    "Graduate Software Engineer",
    "Technical Support Engineer",
    "QA Automation Engineer",
    "Project Coordinator",
    "Technology Analyst",
    "Junior AI Engineer"
  ], 18, true);
  assert.ok(broadQueries.length > 5, "discovery should search more than the first handful of titles");
  assert.ok(broadQueries.some((query) => /support|service desk|help desk/i.test(query)), "expected support-family query coverage");
  assert.ok(broadQueries.some((query) => /qa|test/i.test(query)), "expected QA-family query coverage");
  assert.ok(broadQueries.some((query) => /project|pmo/i.test(query)), "expected project-family query coverage");
  assert.ok(broadQueries.some((query) => /\bai\b|machine learning/i.test(query)), "expected AI-family query coverage");
  assert.ok(broadQueries.some((query) => /data|business intelligence/i.test(query)), "expected data-family query coverage");
  assert.ok(broadQueries.some((query) => /cloud|devops|infrastructure/i.test(query)), "expected cloud-family query coverage");
  assert.ok(broadQueries.some((query) => /security|soc/i.test(query)), "expected security-family query coverage");

  assert.equal(discovery.titleAlignmentScore("Junior Software Engineer", ["Software Developer"]).aligned, true);
  assert.equal(discovery.titleAlignmentScore("AI Software Engineer I", ["Software Developer"]).aligned, true);
  assert.equal(discovery.titleAlignmentScore("Technical Program Manager", ["IT Project Manager"]).aligned, true);
  assert.equal(discovery.titleAlignmentScore("Fire Engineer", ["Software Engineer"]).aligned, false);
  assert.equal(discovery.titleAlignmentScore("Commercial Manager", ["IT Project Manager"]).aligned, false);

  assert.equal(discovery.entryLevelEligibility("Junior Software Engineer", "0-2 years experience").allowed, true);
  assert.equal(discovery.entryLevelEligibility("Technical Support Engineer", "2 years experience").allowed, true);
  assert.equal(discovery.entryLevelEligibility("Senior Full Stack Engineer", "3 years experience").allowed, false);
  assert.equal(discovery.entryLevelEligibility("Software Engineer", "5+ years experience required").allowed, false);
  assert.equal(discovery.entryLevelEligibility("Applied AI Architect", "Experience building AI systems").allowed, false);
  assert.equal(discovery.entryLevelEligibility("Software Engineer II", "2 years experience").allowed, false);
  assert.equal(discovery.entryLevelEligibility("Frontend Developer", "5+ years overall experience and 2 years React experience").allowed, false);

  assert.equal(discovery.locationEligibility("US - Remote; San Francisco", "Remote role", ["Dublin", "Ireland", "Remote"], "remote").allowed, false);
  assert.equal(discovery.locationEligibility("US - Remote; San Francisco", "Remote role", ["Dublin", "Ireland", "Remote"], "remote", { allowRemoteUS: true }).allowed, true);
  assert.equal(discovery.locationEligibility("Remote", "Remote in the United States only", ["Dublin", "Ireland", "Remote"], "remote", { allowRemoteUS: true }).allowed, true);
  assert.equal(discovery.locationEligibility("Dublin, Ireland", "Hybrid role", ["Dublin", "Ireland", "Remote"], "remote").allowed, true);
  assert.equal(discovery.locationEligibility("Remote - Europe", "Distributed team", ["Dublin", "Ireland", "Remote"], "remote").allowed, true);
  assert.equal(discovery.locationEligibility("Remote", "Distributed team", ["Dublin", "Ireland", "Remote"], "remote").allowed, true);

  console.log("Discovery coverage regression PASS");
  console.log(`Starter sources: ${sources.length}`);
  console.log("Relevance gate: software/project matches preserved; unrelated engineering/management titles rejected.");
  console.log("Location gate: US-scoped remote is opt-in; Ireland/Europe/generic remote preserved.");
  console.log(`Search breadth: ${broadQueries.length} diversified role-family queries generated.`);
  console.log("Diversity: runtime discovery caps the first pass at two deep-analysis slots per employer.");
} finally {
  // better-sqlite3 keeps the database and WAL files open until close().
  // Windows will return EPERM if we try to remove the temporary directory first.
  try {
    database?.db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // Best-effort test cleanup only.
  }
  try {
    database?.db.close();
  } catch {
    // Best-effort test cleanup only.
  }
  fs.rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}
