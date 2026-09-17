import { z } from "zod";
import { suggestedRoles } from "../services/cvParsing.js";
import { reviewedCv, savedProfile, writeSetting } from "../services/onboarding.js";
import { db } from "../db/database.js";
import type { FastifyInstance } from "fastify";
import { onboardingStatus } from "../services/onboarding.js";
export async function onboardingRoutes(app: FastifyInstance) {
  app.get("/onboarding/status", async () => onboardingStatus());
  app.get("/profile/role-suggestions", async () => {const cv=reviewedCv();return{cvId:cv?.id||null,suggestions:cv?suggestedRoles(cv.facts):[]};});
  app.post("/profile/role-suggestions/accept", async (req,reply) => {
    const input=z.object({cvId:z.number().int(),titles:z.array(z.string()).max(8),confirmed:z.literal(true)}).parse(req.body);
    const cv=reviewedCv();if(!cv || cv.id!==input.cvId)return reply.code(409).send({error:"The reviewed CV changed. Refresh role suggestions."});
    const allowed=suggestedRoles(cv.facts).map(s=>s.title);if(input.titles.some(t=>!allowed.includes(t)))return reply.code(400).send({error:"Choose displayed suggestions; enter custom titles in Profile."});
    const p=savedProfile();p.targetTitles=[...new Set([...p.targetTitles,...input.titles])];
    db.prepare("INSERT INTO profile(id,data_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=CURRENT_TIMESTAMP").run(JSON.stringify(p));
    writeSetting("acceptedRoleCvId",cv.id);return p;
  });
}
