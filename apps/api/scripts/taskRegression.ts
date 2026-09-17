import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"applylite-task-"));process.env.DATABASE_PATH=path.join(temp,"test.db");process.env.APPLYLITE_TEST_MODE="true";
const{db,initializeDatabase}=await import("../src/db/database.js");initializeDatabase();const tasks=await import("../src/services/tasks.js");let writes=0;
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function terminal(id:string){for(let i=0;i<100;i++){await wait(10);const t=tasks.getTask(id)!;if(!["QUEUED","RUNNING","CANCELLING"].includes(t.status))return t;}throw new Error("Task never settled");}
try{
 tasks.registerTaskHandler("fixture",{async run(input,c){c.progress("TESTING",{done:0,total:1},"Testing fixture");await wait(input.delay||10);c.checkpoint();writes++;return{ok:true};}});
 const t=tasks.enqueueTask("fixture","one",{});assert.equal(tasks.enqueueTask("fixture","one",{}).id,t.id);assert.equal((await terminal(t.id)).status,"COMPLETED");assert.equal(writes,1);
 const cancelled=tasks.enqueueTask("fixture","two",{delay:100});await wait(10);tasks.cancelTask(cancelled.id);assert.equal((await terminal(cancelled.id)).status,"CANCELLED");assert.equal(writes,1);
 const interrupted=tasks.enqueueTask("fixture","three",{delay:100});await wait(10);await tasks.stopTaskWorker();assert.equal(tasks.getTask(interrupted.id)!.status,"INTERRUPTED");assert.equal(writes,1);
 tasks.startTaskWorker();const retry=tasks.retryTask(interrupted.id);assert.notEqual(retry.id,interrupted.id);assert.equal((await terminal(retry.id)).status,"COMPLETED");assert.equal(writes,2);
 assert.equal(tasks.listTasks().length,4);console.log("Persistent tasks PASS: idempotency, saved result, cancellation fencing, shutdown and retry");
}finally{await tasks.stopTaskWorker();db.close();fs.rmSync(temp,{recursive:true,force:true});}
