import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { DiscoveryRunInputSchema, JobRequirementsSchema } from "@apply-lite/shared";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "applylite-workflow-api-"));
process.env.DATABASE_PATH = path.join(temp, "test.db");
process.env.STORAGE_PATH = path.join(temp, "storage");
process.env.APPLYLITE_TEST_MODE = "true";
process.env.AI_MODE = "local_only";
const {db, initializeDatabase} = await import("../src/db/database.js");
initializeDatabase();
const tasks = await import("../src/services/tasks.js");
const {cvRoutes} = await import("../src/routes/cv.js");
const {onboardingRoutes} = await import("../src/routes/onboarding.js");
const {profileRoutes} = await import("../src/routes/profile.js");
const {taskRoutes} = await import("../src/routes/tasks.js");
const {discoveryRoutes} = await import("../src/routes/discovery.js");
const discovery = await import("../src/services/discovery.js");
const sourceText = "Example Person\nEmail: user@example.invalid\nSkills\nReact, TypeScript\nWork History\nFrontend Developer\nExample Ltd\nJan 2022 - Present\n- Built React interfaces and tested components.\nEducation\nBSc Computing\nExample University\n2018 - 2021";
let failure = true;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({done:true,message:{content:failure?"invalid JSON":"{}"}}),{headers:{"content-type":"application/json"}});
const app=Fastify();
await app.register(cvRoutes);await app.register(profileRoutes);await app.register(onboardingRoutes);await app.register(taskRoutes);
const posting=(id:string,title:string,description:string)=>({title,company:"Fixture Employer",location:"Ireland",salaryText:"",description,sourceUrl:`https://jobs.lever.co/fixture/${id}`,ats:"lever" as const,evidence:{requestedUrl:"",finalUrl:`https://jobs.lever.co/fixture/${id}`,ats:"lever",pageTitle:title,heading:title,metaDescription:"",bodyText:description,jobPostingJsonLd:"{}"}});
const postings=[posting("1","Frontend Developer","Build accessible React interfaces for customers and test frontend components."),posting("2","Senior Nurse","Provide patient care within a nursing team. Clinical registration required for this hospital position.")];
await app.register(discoveryRoutes,{dependencies:{fetchSource:async()=>{await new Promise(r=>setTimeout(r,120));return postings;},analyze:async()=>JobRequirementsSchema.parse({requiredSkills:["React"]})}});
discovery.rememberDiscoverySourceFromUrl("https://jobs.lever.co/fixture","Fixture");
async function request(method:any,url:string,payload?:any){const result=await app.inject({method,url,...(payload?{payload}:{})});return{status:result.statusCode,body:result.json()};}
async function terminal(id:string){for(let i=0;i<300;i++){const t=tasks.getTask(id)!;if(!["QUEUED","RUNNING","CANCELLING"].includes(t.status))return t;await new Promise(r=>setTimeout(r,10));}throw new Error("Task failed to settle");}
let release:()=>void=()=>{};
try{
 const imported=await request("POST","/cv/import-text",{text:sourceText});assert.equal(imported.status,201);let draft=imported.body;
 assert.equal(draft.facts.employment[0].employer,"Example Ltd");assert.equal(draft.facts.education[0].qualification,"BSc Computing");
 // Place a CV behind another task to verify a queued AI settlement cannot invalidate Save.
 tasks.registerTaskHandler("fixture_block",{run:()=>new Promise<void>(resolve=>{release=resolve;})});
 const blocked=tasks.enqueueTask("fixture_block","one",{});await new Promise(r=>setTimeout(r,30));
 const queued=await request("POST",`/cv/drafts/${draft.id}/enhance`,{});assert.equal(queued.status,202);
 const saved=await request("PUT",`/cv/drafts/${draft.id}`,{facts:draft.facts,revision:draft.revision});assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.status,"ready");assert.equal(tasks.getTask(queued.body.task.id)?.status,"CANCELLED");release();await terminal(blocked.id);
 const merged=await request("POST","/cv/current/merge-profile",{cvId:saved.body.publishedCvId});assert.equal(merged.status,200);assert.deepEqual(merged.body.profile.targetTitles,[]);
 const suggestions=(await request("GET","/profile/role-suggestions")).body;assert.ok(suggestions.suggestions.some((s:any)=>s.title==="Frontend Developer"));
 assert.equal((await request("POST","/profile/role-suggestions/accept",{cvId:suggestions.cvId,titles:["Frontend Developer"],confirmed:false})).status>=400,true);
 assert.equal((await request("POST","/profile/role-suggestions/accept",{cvId:suggestions.cvId,titles:["Frontend Developer"],confirmed:true})).status,200);
 assert.equal((await request("GET","/onboarding/status")).body.readyForDiscovery,true);
 draft=(await request("POST","/cv/drafts/from-current",{})).body;
 const enhancing=await request("POST",`/cv/drafts/${draft.id}/enhance`,{});const failed=await terminal(enhancing.body.task.id);assert.equal(failed.status,"FAILED");assert.equal(failed.error?.code,"INVALID_STRUCTURED_OUTPUT");assert.equal((await request("GET",`/cv/drafts/${draft.id}`)).body.rawText,sourceText);
 failure=false;const retried=await request("POST",`/tasks/${failed.id}/retry`,{});assert.equal(retried.status,202);assert.equal((await terminal(retried.body.id)).status,"COMPLETED");
 const run=await request("POST","/discovery/runs",DiscoveryRunInputSchema.parse({maxDeepAnalysis:0,minFinalScore:99}));assert.equal(run.status,202);assert.ok(["QUEUED","RUNNING"].includes(run.body.status));
 // Observers can disappear/reconnect; no response stream owns the task.
 await new Promise(r=>setTimeout(r,250));const complete=await terminal(run.body.id);assert.equal(complete.status,"COMPLETED");
 assert.equal((await request("GET","/discovery/runs/latest")).body.id,run.body.id);
 const results=(await request("GET","/discovery/results")).body;assert.equal(results.counts.all,2);assert.ok(results.items.some((j:any)=>j.score<50));
 assert.equal((await request("GET","/discovery/results?strictTitle=true")).body.total,1);
 const another=await request("POST","/discovery/runs",DiscoveryRunInputSchema.parse({}));await request("POST",`/tasks/${another.body.id}/cancel`,{});assert.equal((await terminal(another.body.id)).status,"CANCELLED");assert.equal(discovery.getDiscoveryResults().counts.all,2);
 const before=db.prepare("SELECT count(*) AS n FROM jobs").get();initializeDatabase();assert.deepEqual(db.prepare("SELECT count(*) AS n FROM jobs").get(),before);
 console.log("Workflow API PASS: offline import, queued-save race, role consent, classified AI failure, safe retry, 202 tasks, reconnect, broad results, cancellation and migration preservation.");
}finally{release();await tasks.stopTaskWorker();await app.close();db.close();globalThis.fetch=originalFetch;fs.rmSync(temp,{recursive:true,force:true});}
