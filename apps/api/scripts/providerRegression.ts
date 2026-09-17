import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"applylite-provider-"));process.env.DATABASE_PATH=path.join(temp,"test.db");process.env.APPLYLITE_TEST_MODE="true";process.env.GROQ_API_KEY="synthetic-fixture-key";
const {db,initializeDatabase}=await import("../src/db/database.js");initializeDatabase();
const {writeSetting}=await import("../src/services/onboarding.js");const ai=await import("../src/services/aiProvider.js");const real=globalThis.fetch;let cloud=0,local=0,mode="ok";let localBody:any;
globalThis.fetch=async(url,init)=>{if(String(url).startsWith("https://api.groq.com")){cloud++;const body=JSON.parse(String(init?.body||"{}"));assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.response_format.json_schema.schema.additionalProperties,false);return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:"stop"}]}));}local++;if(mode==="fail")return new Response("unavailable",{status:503});const body=JSON.parse(String(init?.body||"{}"));assert.equal(body.stream,false);localBody=body;return new Response(JSON.stringify({message:{content:mode==="invalid"?"not json":'{"ok":true}'},done_reason:"stop"}));};
const schema={type:"object",properties:{ok:{type:"boolean"}},required:["ok"],additionalProperties:false};
try{
 assert.equal((await ai.askAiStructured<any>("fixture",schema)).ok,true);assert.equal(cloud,0);
 mode="fail";writeSetting("aiPreferences",{mode:"local_then_cloud",cloudConsent:false,groqModel:"openai/gpt-oss-20b"});await assert.rejects(ai.askAiStructured("fixture",schema),(e:any)=>e.code==="CONSENT_REQUIRED");assert.equal(cloud,0);
 writeSetting("aiPreferences",{mode:"local_then_cloud",cloudConsent:true,groqModel:"openai/gpt-oss-20b"});assert.equal((await ai.askAiStructured<any>("fixture",schema)).ok,true);assert.equal(cloud,1);
 writeSetting("aiPreferences",{mode:"local_only",cloudConsent:false,groqModel:"openai/gpt-oss-20b"});mode="invalid";await assert.rejects(ai.askAiStructured("fixture",schema),(e:any)=>e.code==="INVALID_STRUCTURED_OUTPUT");
 mode="ok";const legacy=await import("../src/services/ollama.js");
 await legacy.askOllamaStructured("fixture",schema);assert.equal(localBody.options.num_ctx,8192);assert.equal(localBody.options.num_predict,4096);
 await legacy.askOllamaStructured("fixture",schema,{numCtx:6144,numPredict:1600});assert.equal(localBody.options.num_ctx,6144);assert.equal(localBody.options.num_predict,1600);
 await legacy.askOllama("fixture");assert.equal(localBody.options.num_predict,2048);
 assert.ok(!JSON.stringify(ai.publicAiSettings()).includes("synthetic-fixture-key"));assert.equal(ai.safeAiError(new Error("secret CV text")).message.includes("secret CV text"),false);
 console.log("Provider contracts PASS: local default, consent gate, fallback, structured schema, legacy prompt budgets, safe errors and key redaction (mocked providers)");
}finally{globalThis.fetch=real;db.close();fs.rmSync(temp,{recursive:true,force:true});}
