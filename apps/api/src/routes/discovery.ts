import { registerTaskHandler,enqueueTask,latestTask,getTask,cancelTask,listTasks } from "../services/tasks.js";
import { getDiscoveryResults,analyzeStoredJob } from "../services/discovery.js";
import { readSetting,writeSetting } from "../services/onboarding.js";
import type { FastifyInstance } from "fastify";
import { DiscoveryRunInputSchema } from "@apply-lite/shared";
import { z } from "zod";
import { db } from "../db/database.js";
import {
  listDiscoverySources,
  parseDiscoverySourceUrl,
  rememberDiscoverySourceFromUrl,
  runDiscovery
} from "../services/discovery.js";

const AddSourceSchema = z.object({
  url: z.string().min(8),
  name: z.string().default("")
});

const ToggleSourceSchema = z.object({ enabled: z.boolean() });

export async function discoveryRoutes(app: FastifyInstance) {
  registerTaskHandler("discovery",{run:async input=>runDiscovery(DiscoveryRunInputSchema.parse(input))});
  registerTaskHandler("job_analysis",{run:async input=>analyzeStoredJob(input.jobId)});
  app.get("/discovery/settings",async()=>readSetting("discoveryPreferences",DiscoveryRunInputSchema.parse({})));
  app.post("/discovery/runs",async(req,reply)=>{const input=DiscoveryRunInputSchema.parse(req.body||{});writeSetting("discoveryPreferences",input);const task=enqueueTask("discovery","manual",input);return reply.code(202).send({...task,runId:task.id});});
  app.get("/discovery/runs/latest",async()=>latestTask("discovery"));
  app.get("/discovery/runs",async()=>listTasks(100).filter(t=>t.kind==="discovery"));
  app.get<{Params:{id:string}}>("/discovery/runs/:id",async(req,reply)=>getTask(req.params.id)||reply.code(404).send({error:"Run not found."}));
  app.post<{Params:{id:string}}>("/discovery/runs/:id/cancel",async(req,reply)=>cancelTask(req.params.id)||reply.code(404).send({error:"Run not found."}));
  app.get<{Querystring:Record<string,string>}>("/discovery/results",async req=>{
    const q=req.query;const number=(key:string)=>q[key]===undefined?undefined:Math.max(0,Number(q[key])||0);const bool=(key:string)=>q[key]===undefined?undefined:q[key]==="true"||q[key]==="1";
    return getDiscoveryResults({runId:number("runId"),minScore:number("minScore"),band:q.band,strictTitle:bool("strictTitle"),entryLevelOnly:bool("entryLevelOnly"),hideSenior:bool("hideSenior"),strictLocation:bool("strictLocation"),remoteOnly:bool("remoteOnly"),includeRemoteUS:bool("includeRemoteUS"),analysis:q.analysis,query:q.query,offset:number("offset"),limit:number("limit")});
  });
  app.post<{Params:{id:string}}>("/discovery/jobs/:id/analyze",async(req,reply)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||!db.prepare("SELECT id FROM jobs WHERE id=?").get(id))return reply.code(404).send({error:"Job not found."});return reply.code(202).send(enqueueTask("job_analysis",String(id),{jobId:id}));});
  app.get("/discovery/sources", async () => listDiscoverySources());

  app.post("/discovery/sources", async (request, reply) => {
    const input = AddSourceSchema.parse(request.body);
    const descriptor = parseDiscoverySourceUrl(input.url, input.name);
    const saved = rememberDiscoverySourceFromUrl(descriptor.boardUrl, descriptor.name || input.name, true);
    if (!saved) return reply.code(422).send({ error: "Could not add this discovery source." });
    reply.code(201);
    return saved;
  });

  app.patch<{ Params: { id: string } }>("/discovery/sources/:id", async (request, reply) => {
    const id = Number(request.params.id);
    const input = ToggleSourceSchema.parse(request.body);
    const result = db.prepare("UPDATE discovery_sources SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(input.enabled ? 1 : 0, id);
    if (!result.changes) return reply.code(404).send({ error: "Discovery source not found." });
    return { ok: true };
  });

  app.post("/discovery/run", async (request, reply) => {
    const input = DiscoveryRunInputSchema.parse(request.body ?? {});
    request.log.info({ input }, "Discovery run started");
    try {
      const result = await runDiscovery(input);
      request.log.info({ runId: result.runId, jobsImported: result.jobsImported }, "Discovery run completed");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ err: error }, "Discovery run failed");
      return reply.code(422).send({ error: message });
    }
  });
}
