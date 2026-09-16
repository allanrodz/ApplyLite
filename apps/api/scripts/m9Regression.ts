import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const startCwd = process.cwd();
const workspaceRoot = path.resolve(startCwd, "../..");
const repoRoot = fs.existsSync(path.join(workspaceRoot, "package.json")) && fs.existsSync(path.join(workspaceRoot, "apps", "api"))
  ? workspaceRoot
  : startCwd;
process.chdir(repoRoot);
process.env.DATABASE_PATH = "./data/m9-regression.db";
process.env.STORAGE_PATH = "./storage/m9-regression";
process.env.APPLYLITE_TEST_MODE = "true";

const dbFile = path.resolve(repoRoot, "data/m9-regression.db");
const testStorage = path.resolve(repoRoot, "storage/m9-regression");
for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${dbFile}${suffix}`, { force: true });
fs.rmSync(testStorage, { recursive: true, force: true });

const { initializeDatabase, db } = await import("../src/db/database.js");
const { genericAdapter } = await import("../src/automation/adapters/generic.js");
const { ProfileSchema } = await import("@apply-lite/shared");
const { chromium } = await import("playwright");

initializeDatabase();

const profile = ProfileSchema.parse({
  firstName: "Test",
  lastName: "Candidate",
  email: "candidate@example.com",
  phone: "+353 87 000 0000",
  city: "Dublin",
  country: "Ireland",
  currentTitle: "Software Engineer"
});

let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!doctype html>
    <html><head><title>ApplyLite M9 Mock Employer</title></head><body>
      <form>
        <label for="given">Given name</label><input id="given" name="candidate[first_name]" autocomplete="given-name" />
        <label for="email">Work email</label><input id="email" type="email" name="candidate_email" />
        <label for="location">Where are you currently based?</label><input id="location" name="candidate_location" />
        <label><input id="consent" type="checkbox" /> I certify that this application is accurate</label>
        <button id="submit" type="submit" onclick="window.__submitClicks = (window.__submitClicks || 0) + 1; return false;">Submit application</button>
      </form>
    </body></html>`);

  const result = await genericAdapter.prepare({
    page,
    profile,
    answers: [],
    screeningAnswers: []
  });

  assert.equal(await page.locator("#given").inputValue(), "Test", "first name should autofill");
  assert.equal(await page.locator("#email").inputValue(), "candidate@example.com", "email should autofill");
  assert.equal(await page.locator("#location").inputValue(), "Dublin, Ireland", "location should autofill");
  assert.equal(await page.locator("#consent").isChecked(), false, "legal consent checkbox must remain manual");
  assert.equal(await page.evaluate(() => (window as unknown as { __submitClicks?: number }).__submitClicks ?? 0), 0, "final submit must never be clicked");
  assert.equal(result.submitDetected, true, "submit control should be detected for review warning");
  assert.equal(db.pragma("quick_check", { simple: true }), "ok", "SQLite quick_check should pass");

  console.log("M9 regression PASS");
  console.log(`Autofilled: ${result.filled.join(", ")}`);
  console.log(`Manual fields: ${result.manualQuestions.join(", ")}`);
  console.log("Safety invariant: final submit was detected but not clicked.");
} finally {
  await browser?.close();
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${dbFile}${suffix}`, { force: true });
  fs.rmSync(testStorage, { recursive: true, force: true });
}
