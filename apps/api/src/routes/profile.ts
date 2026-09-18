import type { FastifyInstance } from "fastify";
import { ProfileSchema } from "@apply-lite/shared";
import { z } from "zod";
import { db } from "../db/database.js";

const AddSkillSchema = z.object({ skill: z.string().trim().min(1).max(100) });

export async function profileRoutes(app: FastifyInstance) {
  app.get("/profile", async () => {
    const row = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
    return row ? ProfileSchema.parse(JSON.parse(row.data_json)) : ProfileSchema.parse({});
  });

  app.post("/profile/skills", async (request) => {
    const { skill } = AddSkillSchema.parse(request.body ?? {});
    const row = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
    const profile = row ? ProfileSchema.parse(JSON.parse(row.data_json)) : ProfileSchema.parse({});
    const exists = profile.skills.some((value) => value.trim().toLowerCase() === skill.toLowerCase());
    if (!exists) profile.skills = [...profile.skills, skill];
    db.prepare(`
      INSERT INTO profile (id, data_json, updated_at)
      VALUES (1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify(profile));
    return { profile, added: !exists };
  });

  app.put("/profile", async (request) => {
    const profile = ProfileSchema.parse(request.body);
    db.prepare(`
      INSERT INTO profile (id, data_json, updated_at)
      VALUES (1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify(profile));
    return profile;
  });
}
