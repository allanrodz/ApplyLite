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
 console.log("Discovery workflow PASS: persist all scores, survive AI failure, strict view filter, stable IDs, run membership and deep analysis");
}finally{db.close();fs.rmSync(temp,{recursive:true,force:true});}
