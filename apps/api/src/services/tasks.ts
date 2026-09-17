import { randomUUID } from "node:crypto";
import { db } from "../db/database.js";
import { taskContext,type TaskContext } from "./taskContext.js";
import { safeAiError } from "./aiProvider.js";
export type TaskStatus="QUEUED"|"RUNNING"|"CANCELLING"|"COMPLETED"|"FAILED"|"CANCELLED"|"INTERRUPTED";
type Row={id:string;kind:string;subject_key:string;status:TaskStatus;phase:string;input_json:string;counters_json:string;result_json:string|null;message:string;error_code:string|null;error_message:string|null;cancel_requested:number;lease:string|null;retry_of:string|null;created_at:string;started_at:string|null;updated_at:string;completed_at:string|null};
export type Task={id:string;kind:string;subjectKey:string;status:TaskStatus;phase:string;counters:Record<string,number>;result:any;message:string;error:{code:string;message:string}|null;createdAt:string;startedAt:string|null;updatedAt:string;completedAt:string|null;retryOf:string|null};
type Handler={run:(input:any,context:TaskContext)=>Promise<unknown>;retryInput?:(input:any)=>unknown;settled?:(input:any,task:Task)=>void};
const handlers=new Map<string,Handler>();let active:{id:string;controller:AbortController;promise:Promise<void>}|null=null;let stopped=false,pending=false;
const row=(id:string)=>db.prepare("SELECT * FROM workflow_tasks WHERE id=?").get(id) as Row|undefined;
function encode(r:Row):Task{return{id:r.id,kind:r.kind,subjectKey:r.subject_key,status:r.status,phase:r.phase,counters:JSON.parse(r.counters_json),result:r.result_json?JSON.parse(r.result_json):null,message:r.message,error:r.error_code?{code:r.error_code,message:r.error_message||""}:null,createdAt:r.created_at,startedAt:r.started_at,updatedAt:r.updated_at,completedAt:r.completed_at,retryOf:r.retry_of};}
export function getTask(id:string){const value=row(id);return value?encode(value):null;}
export function listTasks(limit=15){return(db.prepare("SELECT * FROM workflow_tasks ORDER BY created_at DESC,rowid DESC LIMIT ?").all(Math.max(1,Math.min(100,limit))) as Row[]).map(encode);}
export function latestTask(kind:string,key?:string){const r=(key?db.prepare("SELECT * FROM workflow_tasks WHERE kind=? AND subject_key=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(kind,key):db.prepare("SELECT * FROM workflow_tasks WHERE kind=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(kind)) as Row|undefined;return r?encode(r):null;}
export function registerTaskHandler(kind:string,handler:Handler){handlers.set(kind,handler);}
function notify(id:string){const r=row(id);if(r)handlers.get(r.kind)?.settled?.(JSON.parse(r.input_json),encode(r));}
export function enqueueTask(kind:string,subjectKey:string,input:unknown,retryOf:string|null=null){
 if(!handlers.has(kind))throw new Error("Unsupported background task.");
 const task=db.transaction(()=>{const found=db.prepare("SELECT * FROM workflow_tasks WHERE kind=? AND subject_key=? AND status IN ('QUEUED','RUNNING','CANCELLING')").get(kind,subjectKey) as Row|undefined;if(found)return encode(found);const id=randomUUID();db.prepare("INSERT INTO workflow_tasks(id,kind,subject_key,input_json,message,retry_of) VALUES(?,?,?,?,?,?)").run(id,kind,subjectKey,JSON.stringify(input),"Queued; you may leave this page.",retryOf);return getTask(id)!;})();
 schedule();return task;
}
function schedule(){if(stopped||pending||active)return;pending=true;setImmediate(()=>{pending=false;void pump();});}
async function pump(){
 if(stopped||active)return;
 const candidate=(db.prepare("SELECT * FROM workflow_tasks WHERE status='QUEUED' ORDER BY created_at,rowid").all() as Row[]).find(r=>handlers.has(r.kind));if(!candidate)return;
 const lease=randomUUID(),controller=new AbortController();
 if(!db.prepare("UPDATE workflow_tasks SET status='RUNNING',phase='STARTING',lease=?,started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='QUEUED'").run(lease,candidate.id).changes)return;
 const checkpoint=()=>{controller.signal.throwIfAborted();const current=row(candidate.id);if(!current||current.lease!==lease||current.status!=="RUNNING")throw new DOMException("Task no longer owns its work.","AbortError");};
 const context:TaskContext={id:candidate.id,signal:controller.signal,checkpoint,progress:(phase,counters,message)=>{checkpoint();db.prepare("UPDATE workflow_tasks SET phase=?,counters_json=?,message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease=? AND status='RUNNING'").run(phase,JSON.stringify(counters),message,candidate.id,lease);}};
 const run=async()=>{
  const timer=setInterval(()=>{db.prepare("UPDATE workflow_tasks SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease=? AND status='RUNNING'").run(candidate.id,lease);},5000);timer.unref();
  try{const result=await taskContext.run(context,()=>handlers.get(candidate.kind)!.run(JSON.parse(candidate.input_json),context));checkpoint();db.prepare("UPDATE workflow_tasks SET status='COMPLETED',phase='COMPLETED',result_json=?,message='Completed. Results are saved.',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,lease=NULL WHERE id=? AND lease=? AND status='RUNNING'").run(JSON.stringify(result??null),candidate.id,lease);}
  catch(cause){const error=safeAiError(cause);const state=row(candidate.id);if(state?.lease===lease){const status=state.cancel_requested||controller.signal.aborted?"CANCELLED":"FAILED";db.prepare("UPDATE workflow_tasks SET status=?,phase=?,error_code=?,error_message=?,message=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,lease=NULL WHERE id=? AND lease=?").run(status,status,status==="CANCELLED"?"CANCELLED":error.code,error.message,error.message,candidate.id,lease);}}
  finally{clearInterval(timer);try{notify(candidate.id);}finally{active=null;schedule();}}
 };
 // Start on the next microtask so active is set before any synchronous handler can settle.
 const promise=Promise.resolve().then(run);active={id:candidate.id,controller,promise};
}
export function cancelTask(id:string){const value=row(id);if(!value)return null;if(!["QUEUED","RUNNING","CANCELLING"].includes(value.status))return encode(value);if(value.status==="QUEUED"){db.prepare("UPDATE workflow_tasks SET status='CANCELLED',phase='CANCELLED',cancel_requested=1,message='Cancelled before starting.',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(id);notify(id);}else{db.prepare("UPDATE workflow_tasks SET status='CANCELLING',cancel_requested=1,message='Cancelling active request...',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);if(active?.id===id)active.controller.abort(new DOMException("User cancelled task","AbortError"));}return getTask(id);}
export function cancelSubject(kind:string,key:string){const tasks=db.prepare("SELECT id FROM workflow_tasks WHERE kind=? AND subject_key=? AND status IN ('QUEUED','RUNNING','CANCELLING')").all(kind,key) as {id:string}[];for(const t of tasks)cancelTask(t.id);}
export function retryTask(id:string){const old=row(id);if(!old)throw new Error("Task not found.");if(!["FAILED","CANCELLED","INTERRUPTED"].includes(old.status))throw new Error("Only failed, cancelled or interrupted tasks can be retried.");const input=JSON.parse(old.input_json);return enqueueTask(old.kind,old.subject_key,handlers.get(old.kind)?.retryInput?.(input)??input,id);}
export function recoverTasks(){
 const interrupted=db.prepare("SELECT id FROM workflow_tasks WHERE status IN ('RUNNING','CANCELLING')").all() as {id:string}[];
 db.prepare("UPDATE workflow_tasks SET status='INTERRUPTED',phase='INTERRUPTED',lease=NULL,error_code='PROVIDER_UNAVAILABLE',error_message='ApplyLite stopped before this task finished. Saved partial results remain available.',message='Interrupted; retry when ready.',completed_at=CURRENT_TIMESTAMP WHERE status IN ('RUNNING','CANCELLING')").run();
 db.prepare("UPDATE discovery_runs SET status='INTERRUPTED',completed_at=CURRENT_TIMESTAMP WHERE status='RUNNING'").run();
 for(const t of interrupted)notify(t.id);
}
export function startTaskWorker(){stopped=false;recoverTasks();schedule();}
export async function stopTaskWorker(){stopped=true;if(active){const current=active;db.prepare("UPDATE workflow_tasks SET status='INTERRUPTED',phase='INTERRUPTED',lease=NULL,message='ApplyLite stopped. Retry when ready.',completed_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('RUNNING','CANCELLING')").run(current.id);current.controller.abort(new DOMException("ApplyLite stopped","AbortError"));await current.promise;}}
