import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"applylite-onboard-"));process.env.DATABASE_PATH=path.join(temp,"test.db");process.env.APPLYLITE_TEST_MODE="true";
const {db,initializeDatabase}=await import("../src/db/database.js");initializeDatabase();
const {onboardingStatus,writeSetting}=await import("../src/services/onboarding.js");
try {
 assert.equal(onboardingStatus().nextStep,"upload");
 db.prepare("INSERT INTO cv_documents(source_name,source_type,raw_text,facts_json) VALUES('fixture','text/plain','fixture','{}')").run();
 assert.equal(onboardingStatus().nextStep,"merge");writeSetting("profileCvId",1);assert.equal(onboardingStatus().nextStep,"target_titles");
 db.prepare("INSERT INTO profile(id,data_json) VALUES(1,?)").run(JSON.stringify({targetTitles:["Accounts Assistant"]}));
 assert.equal(onboardingStatus().readyForDiscovery,true);assert.equal(onboardingStatus().hasPreferredLocations,false);
 const before=(db.prepare("SELECT COUNT(*) n FROM cv_documents").get() as any).n;initializeDatabase();assert.equal((db.prepare("SELECT COUNT(*) n FROM cv_documents").get() as any).n,before);
 console.log("Onboarding and idempotent additive migration PASS");
} finally {db.close();fs.rmSync(temp,{recursive:true,force:true});}
