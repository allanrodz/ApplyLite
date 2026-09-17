import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "applylite-parser-"));
process.env.DATABASE_PATH = path.join(testDir, "test.db");
process.env.STORAGE_PATH = path.join(testDir, "storage");
process.env.APPLYLITE_TEST_MODE = "true";
const { localDraft } = await import("../src/services/cvReview.js");
const { db } = await import("../src/db/database.js");
import { normalizeCvDate,cvDiagnostics,suggestedRoles } from "../src/services/cvParsing.js";
import { deriveExperienceSummary } from "../src/services/experience.js";
const base="Example Person\nEmail: user@example.invalid\nLocation: Dublin, Ireland\nhttps://github.com/example\nSkills\nReact, TypeScript, Python\n";
for(const header of ["Frontend Developer\nExample Ltd\nOct 2024 - Present","Example Ltd\nFrontend Developer\nOct 2024 - Present","Frontend Developer | Example Ltd | Oct 2024 - Present"]){const f=localDraft(base+"Work History\n"+header+"\n- Built React interfaces.\nEducation\nBSc Computing\nExample University\n2020 - 2024");assert.equal(f.employment[0].title,"Frontend Developer");assert.equal(f.employment[0].employer,"Example Ltd");assert.equal(f.employment[0].startDate,"Oct 2024");assert.equal(f.employment[0].endDate,"Present");assert.equal(f.education[0].qualification,"BSc Computing");assert.ok(f.employment[0].bullets.includes("Built React interfaces."));assert.equal(f.githubUrl,"https://github.com/example");assert.equal(f.city,"Dublin");assert.ok(suggestedRoles(f).length>=2);}
const missing=localDraft(base+"Employment\nAccounts Assistant\nExample Company\n- Processed payroll\n");assert.equal(missing.employment[0].startDate,"");assert.ok(cvDiagnostics(missing).missingFields.some(m=>m.path.endsWith("startDate")));
assert.equal(normalizeCvDate("2021").precision,"year");assert.equal(normalizeCvDate("09/2021").normalized,"2021-09");assert.equal(normalizeCvDate("13/2021").normalized,null);assert.equal(normalizeCvDate("Present").precision,"present");
const multi=localDraft(base+"Experience\nFrontend Developer\nExample Ltd\nJan 2020 - Dec 2021\n- Built React\nSoftware Developer\nSecond Ltd\nJan 2021 - Dec 2022\n- Developed Python\nProjects\nSample Dashboard\nA web dashboard\nTechnologies: React, TypeScript\n- Built accessible UI\n");assert.equal(multi.employment.length,2);assert.equal(deriveExperienceSummary(multi).totalYears,3);assert.equal(multi.projects[0].name,"Sample Dashboard");assert.ok(multi.projects[0].technologies.includes("React"));
assert.equal(localDraft(base+"Education\nDiploma in Accounting, Example College").education[0].institution,"Example College");
assert.deepEqual(suggestedRoles(localDraft("Example Person\nSkills\nFood safety\n")),[]);
console.log("CV parsing PASS: multiline/reversed/pipe employment, education, projects, optional dates, non-IT, contacts and overlap");

db.close(); fs.rmSync(testDir, {recursive:true, force:true});
