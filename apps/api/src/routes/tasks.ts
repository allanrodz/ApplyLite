import type {FastifyInstance} from "fastify";
import {getTask,listTasks,cancelTask,retryTask} from "../services/tasks.js";
export async function taskRoutes(app:FastifyInstance){
 app.get("/tasks",async()=>listTasks());
 app.get<{Params:{id:string}}>("/tasks/:id",async(req,reply)=>getTask(req.params.id)||reply.code(404).send({error:"Task not found."}));
 app.post<{Params:{id:string}}>("/tasks/:id/cancel",async(req,reply)=>cancelTask(req.params.id)||reply.code(404).send({error:"Task not found."}));
 app.post<{Params:{id:string}}>("/tasks/:id/retry",async(req,reply)=>{try{return reply.code(202).send(retryTask(req.params.id));}catch(e){return reply.code(409).send({error:e instanceof Error?e.message:"Could not retry task."});}});
}
