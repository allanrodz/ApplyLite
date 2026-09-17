import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";
import {DiscoveryRunInputSchema,JobRequirementsSchema} from "@apply-lite/shared";
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"applylite-discovery-flow-"));process.env.DATABASE_PATH=path.join(temp,"test.db");process.env.APPLYLITE_TEST_MODE="true";
const {db,initializeDatabase}=await import("../src/db/database.js");initializeDatabase();const d=await import("../src/services/discovery.js");
try{
 db.prepare("INSERT INTO profile(id,data_json) VALUES(1,?)").run(JSON.stringify({targetTitles:["Frontend Developer"],skills:["React"],preferredLocations:["Ireland"],remotePreference:"remote"}));
 d.rememberDiscoverySourceFromUrl("https://jobs.lever.co/fixture","Fixture");
 const post=(title:string,location:string,description:string,id:string)=>({title,company:"Fixture",location,description,salaryText:"",sourceUrl:`https://jobs.lever.co/fixture/${id}`,ats:"lever" as const,evidence:{requestedUrl:"",finalUrl:`https://jobs.lever.co/fixture/${id}`,ats:"lever",pageTitle:title,heading:title,metaDescription:description,bodyText:description,jobPostingJsonLd:"{}"}});
 const postings=[post("Frontend Developer","Remote - Europe","Build responsive React interfaces and maintain accessible web pages for customers.","1"),post("Senior Nurse","Boston, USA","This is an on-site nursing role requiring specialist clinical qualifications and patient care experience.","2"),post("Accounts Assistant","Dublin","Prepare accounting reports and monthly payroll records for the business team.","3")];let calls=0;
 const deps={fetchSource:async()=>postings,analyze:async()=>{calls++;throw new Error("Model unavailable fixture");}};
 const output=await d.runDiscovery(DiscoveryRunInputSchema.parse({minFinalScore:99,maxDeepAnalysis:1}),deps);assert.equal(output.jobsSaved,3);assert.equal(calls,1);assert.equal(d.getDiscoveryResults().counts.all,3);assert.ok(d.getDiscoveryResults().items.some(j=>j.score<50));assert.ok(d.getDiscoveryResults().items.some(j=>j.analysisStatus==="failed"));assert.equal(d.getDiscoveryResults({strictTitle:true}).total,1);
 const repeat=await d.runDiscovery(DiscoveryRunInputSchema.parse({maxDeepAnalysis:0}),deps);assert.equal(repeat.jobsImported,0);assert.equal(d.getDiscoveryResults({runId:repeat.runId}).total,3);
 const job=d.getDiscoveryResults({strictTitle:true}).items[0];await d.analyzeStoredJob(job.id,async()=>JobRequirementsSchema.parse({requiredSkills:["React"],workplaceType:"remote"}));assert.equal(d.getDiscoveryResults({analysis:"deep"}).total,1);assert.equal(d.getDiscoveryResults({analysis:"quick"}).total,2);
 // A URL-imported job may have detailed requirements without a discovery-cache entry.
 const detailed=JobRequirementsSchema.parse({requiredSkills:["TypeScript"],qualifications:["Computer science degree"],workplaceType:"remote"});
 const manual=post("Frontend Developer","Remote - Europe","Build and maintain TypeScript interfaces in a product team with an accessible design system.","manual");
 const manualId=Number(db.prepare("INSERT INTO jobs(source_url,title,company,location,description,analysis_json,score_kind,analysis_status,origin) VALUES(?,?,?,?,?,?,'legacy','complete','url')").run(manual.sourceUrl,manual.title,manual.company,manual.location,manual.description,JSON.stringify(detailed)).lastInsertRowid);
 const appId=Number(db.prepare("INSERT INTO applications(job_id,state) VALUES(?,'SUBMITTED')").run(manualId).lastInsertRowid);
 await d.runDiscovery(DiscoveryRunInputSchema.parse({maxDeepAnalysis:0}),{fetchSource:async()=>[manual]});
 let retained=db.prepare("SELECT analysis_json,score_kind,analysis_status FROM jobs WHERE id=?").get(manualId) as any;
 assert.deepEqual(JSON.parse(retained.analysis_json),detailed);assert.equal(retained.score_kind,"legacy");assert.equal(retained.analysis_status,"complete");
 assert.equal((db.prepare("SELECT job_id FROM applications WHERE id=?").get(appId) as any).job_id,manualId);
 await d.runDiscovery(DiscoveryRunInputSchema.parse({maxDeepAnalysis:0}),{fetchSource:async()=>[{...manual,description:manual.description+" Updated responsibilities."}]});
 retained=db.prepare("SELECT analysis_json,analysis_status FROM jobs WHERE id=?").get(manualId) as any;
 assert.deepEqual(JSON.parse(retained.analysis_json),detailed);assert.equal(retained.analysis_status,"stale");
 // Make learning active, then prove an explicit disabled run stays disabled even for deep scores.
 for(let i=0;i<3;i++)db.prepare("INSERT INTO applications(job_id,state,outcome,submitted_at) VALUES(?,'SUBMITTED','INTERVIEW',CURRENT_TIMESTAMP)").run(job.id);
 const {buildOutcomeLearningModel}=await import("../src/services/outcomeLearning.js");assert.equal(buildOutcomeLearningModel().active,true);
 const fresh=post("Frontend Developer","Remote - Europe","Develop React components and accessible frontend experiences for enterprise customers.","fresh");
 const withoutLearning=await d.runDiscovery(DiscoveryRunInputSchema.parse({maxDeepAnalysis:1,useOutcomeLearning:false}),{fetchSource:async()=>[fresh],analyze:async()=>JobRequirementsSchema.parse({requiredSkills:["React"],workplaceType:"remote"})});
 const unlearned=d.getDiscoveryResults({runId:withoutLearning.runId}).items[0];assert.equal(unlearned.scoreKind,"deep");assert.equal(unlearned.scoreBreakdown.outcomeLearningActive,false);assert.equal(unlearned.scoreBreakdown.outcomeAdjustment,0);
 // A cancelled request must leave the previous valid quick data and non-failure status intact.
 const quick=d.getDiscoveryResults({analysis:"quick"}).items.find(j=>j.scoreKind==="quick")!;
 const before=db.prepare("SELECT analysis_json,score,score_kind,analysis_status FROM jobs WHERE id=?").get(quick.id) as any;
 const {taskContext}=await import("../src/services/taskContext.js");const controller=new AbortController();
 await assert.rejects(taskContext.run({id:"cancel-fixture",signal:controller.signal,checkpoint:()=>controller.signal.throwIfAborted(),progress:()=>{}},()=>d.analyzeStoredJob(quick.id,async()=>{controller.abort(new DOMException("Cancelled fixture","AbortError"));throw controller.signal.reason;})));
 assert.deepEqual(db.prepare("SELECT analysis_json,score,score_kind,analysis_status FROM jobs WHERE id=?").get(quick.id),before);
 console.log("Discovery workflow PASS: persist all scores, survive AI failure, strict view filter, stable IDs, run membership, detailed-analysis retention, outcome preference and cancellation");
}finally{db.close();fs.rmSync(temp,{recursive:true,force:true});}
