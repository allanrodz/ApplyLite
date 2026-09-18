import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";

const temp=fs.mkdtempSync(path.join(os.tmpdir(),"applylite-fast-read-"));
process.env.DATABASE_PATH=path.join(temp,"test.db");
process.env.STORAGE_PATH=path.join(temp,"storage");
process.env.APPLYLITE_TEST_MODE="true";

const {db,initializeDatabase}=await import("../src/db/database.js");
initializeDatabase();
const {getDiscoveryResults}=await import("../src/services/discovery.js");
const {jobRoutes}=await import("../src/routes/jobs.js");
const {profileRoutes}=await import("../src/routes/profile.js");
const {compareUpdate,isNewerVersion}=await import("../src/services/updateStatus.js");

const breakdown=JSON.stringify({total:50,skills:0,title:0,location:0,experience:0,preference:0,matchedSkills:[],missingSkills:[],matchedRequiredSkills:[],missingRequiredSkills:[],reasons:[],concerns:[]});
const requirements=JSON.stringify({});
const insert=db.prepare(`INSERT INTO jobs(source_url,title,company,location,salary_text,description,score,score_json,analysis_json,ats,status,origin,score_kind,analysis_status,pre_score,score_profile_hash)
VALUES(?,?,?,?,?,?,?, ?,?,'lever','SCORED','discovery','quick','not_requested',?,'old-profile')`);
const tx=db.transaction(()=>{
  for(let i=0;i<1200;i++)insert.run(`https://example.invalid/job/${i}`,`Developer ${i}`,"Fixture Co","Ireland","","React TypeScript role",i%101,breakdown,requirements,i%101);
});
tx();

const before=(db.prepare("SELECT score_profile_hash AS hash FROM jobs WHERE id=1").get() as any).hash;
const page=getDiscoveryResults({limit:30});
assert.equal(page.items.length,30);
assert.equal(page.total,1200);
assert.equal(page.counts.all,1200);
assert.equal((db.prepare("SELECT score_profile_hash AS hash FROM jobs WHERE id=1").get() as any).hash,before,"Discovery reads must not synchronously rescore/write every row.");

db.prepare("UPDATE jobs SET status='FOCUSED' WHERE id=1").run();
const api=Fastify();
await api.register(jobRoutes);
await api.register(profileRoutes);
const response=await api.inject({method:"GET",url:"/jobs?workspace=1&learned=0"});
assert.equal(response.statusCode,200);
const workspace=response.json();
assert.equal(workspace.length,1,"Dashboard workspace endpoint should not load the whole discovery inbox.");
assert.equal(workspace[0].id,1);

db.prepare("UPDATE jobs SET analysis_json=?, description=? WHERE id=1")
  .run(JSON.stringify({requiredSkills:["React"],preferredSkills:[],requiredExperienceYears:null,responsibilities:[],qualifications:[],employmentType:"",workplaceType:"unknown",seniority:"",summary:"",warnings:[]}),"Build React interfaces for customers.");
const beforeSkillResponse=await api.inject({method:"GET",url:"/jobs?workspace=1&learned=0"});
const beforeSkillScore=beforeSkillResponse.json()[0].score;
const addSkill=await api.inject({method:"POST",url:"/profile/skills",payload:{skill:"React"}});
assert.equal(addSkill.statusCode,200);
assert.equal(addSkill.json().added,true);
assert.deepEqual(addSkill.json().profile.skills,["React"]);
const duplicate=await api.inject({method:"POST",url:"/profile/skills",payload:{skill:"react"}});
assert.equal(duplicate.statusCode,200);
assert.equal(duplicate.json().added,false,"Skill additions should be case-insensitive and idempotent.");
const afterSkillResponse=await api.inject({method:"GET",url:"/jobs?workspace=1&learned=0"});
const afterSkillScore=afterSkillResponse.json()[0].score;
assert.ok(afterSkillScore>beforeSkillScore,`Adding a verified missing skill should refresh and improve the focused job score (${beforeSkillScore} -> ${afterSkillScore}).`);

const removeSkill=await api.inject({method:"DELETE",url:"/profile/skills",payload:{skill:"React"}});
assert.equal(removeSkill.statusCode,200);
assert.equal(removeSkill.json().removed,true);
assert.deepEqual(removeSkill.json().profile.skills,[]);
assert.deepEqual(removeSkill.json().profile.excludedSkills,["React"]);
const afterRemovalResponse=await api.inject({method:"GET",url:"/jobs?workspace=1&learned=0"});
const afterRemovalScore=afterRemovalResponse.json()[0].score;
assert.ok(afterRemovalScore<afterSkillScore,`Removing a matched skill should immediately reduce/recompute the focused job score (${afterSkillScore} -> ${afterRemovalScore}).`);

const restoreSkill=await api.inject({method:"POST",url:"/profile/skills",payload:{skill:"react"}});
assert.equal(restoreSkill.json().added,true);
assert.deepEqual(restoreSkill.json().profile.excludedSkills,[],"Re-adding a skill must clear its matching exclusion.");

const local="a".repeat(40),remote="b".repeat(40);
assert.deepEqual(compareUpdate(local,"0.16.4",local,"0.16.4"),{updateAvailable:false,comparison:"commit"});
assert.deepEqual(compareUpdate(remote,"0.16.4",local,"0.16.4"),{updateAvailable:true,comparison:"commit"});
assert.deepEqual(compareUpdate(null,"0.16.4",null,"0.16.3"),{updateAvailable:true,comparison:"version"});
assert.equal(isNewerVersion("0.16.4","0.16.4"),false);
assert.equal(isNewerVersion("0.17.0","0.16.9"),true);

await api.close();
db.close();
fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:50});
console.log("Fast read regression PASS: bounded reads, add/remove skill rescoring, exclusion recovery and commit/version update comparison.");
