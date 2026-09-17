import { AsyncLocalStorage } from "node:async_hooks";
export type TaskContext={id:string;signal:AbortSignal;checkpoint:()=>void;progress:(phase:string,counters:Record<string,number>,message:string)=>void};
export const taskContext=new AsyncLocalStorage<TaskContext>();
export const taskSignal=()=>taskContext.getStore()?.signal;
export const taskCheckpoint=()=>taskContext.getStore()?.checkpoint();
export const taskProgress=(phase:string,counters:Record<string,number>,message:string)=>taskContext.getStore()?.progress(phase,counters,message);
export function requestSignal(timeout:number){const active=taskSignal();return AbortSignal.any([AbortSignal.timeout(timeout),...(active?[active]:[])]);}
