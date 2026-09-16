import assert from "node:assert/strict";
import { ProfileSchema, JobInputSchema, CandidateFactsSchema, JobRequirementsSchema } from "@apply-lite/shared";
import { scoreJob } from "../src/services/scoring.js";
import { localDraft } from "../src/services/cvReview.js";
import { deriveExperienceSummary } from "../src/services/experience.js";
const profile = ProfileSchema.parse({ targetTitles: ["Frontend Developer"], preferredLocations: ["Ireland", "Remote"], remotePreference: "remote", skills: ["React"] });
const required = JobRequirementsSchema.parse({ requiredSkills: ["React"], workplaceType: "remote", requiredExperienceYears: 2 });
for (const location of ["Remote", "Remote - Europe", "EMEA - Remote", "Worldwide"]) {
  const result = scoreJob(profile, JobInputSchema.parse({ title: "Frontend Developer", company: "Example", location, description: "Develop React applications" }), required);
  assert.equal(result.location, 10, location);
  assert.ok(!result.concerns.some(s => s.startsWith("Location may not match")), location);
}
const restricted = scoreJob(profile, JobInputSchema.parse({ title: "Frontend Developer", company: "Example", location: "Remote", description: "Must reside in the United States. Build React applications." }), required);
assert.ok(restricted.location < 10);
const text = "Example Person\nSkills\nExcel, Payroll\nWORK HISTORY\nAccounts Assistant | Example Company | Jan 2021 - Dec 2022 | Dublin\nPrepared payroll reports\nEducation\nExample College";
const draft = localDraft(text);
assert.deepEqual(draft.skills, ["Excel", "Payroll"]); assert.equal(draft.employment[0].title, "Accounts Assistant");
assert.deepEqual(localDraft("Example Person\nSkills\nReact\nSelected Highlights:\nBuilt applications for clients").skills, ["React"]);
assert.deepEqual(localDraft("Example Person\nSkills\nPOWER BI\nC++\nWork History\nExample role").skills, ["POWER BI", "C++"]);
const cv = CandidateFactsSchema.parse({ employment: [{ employer: "Example Agency", title: "Technology Consultant", startDate: "Jan 2021", endDate: "Dec 2022", bullets: ["Built React applications for client portals."] }] });
const job = JobInputSchema.parse({ title: "Frontend Developer", company: "Example", description: "Build responsive React interfaces" });
assert.equal(deriveExperienceSummary(cv, job, required).relevantYears, 2);
cv.employment[0].title = "Nurse"; cv.employment[0].bullets = ["Prepared Excel reports."];
assert.equal(deriveExperienceSummary(cv, job, required).relevantYears, 0);
console.log("Review edge regression PASS: eligible remote scopes, source section boundaries, and generic-title duty evidence.");
