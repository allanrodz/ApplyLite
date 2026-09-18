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
    const normalized = skill.toLowerCase();
    const exists = profile.skills.some((value) => value.trim().toLowerCase() === normalized);
    if (!exists) profile.skills = [...profile.skills, skill];
    profile.excludedSkills = (profile.excludedSkills ?? []).filter((value) => value.trim().toLowerCase() !== normalized);
    db.prepare(`
      INSERT INTO profile (id, data_json, updated_at)
      VALUES (1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify(profile));
    return { profile, added: !exists };
  });

  app.delete("/profile/skills", async (request) => {
    const { skill } = AddSkillSchema.parse(request.body ?? {});
    const row = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
    const profile = row ? ProfileSchema.parse(JSON.parse(row.data_json)) : ProfileSchema.parse({});
    const normalized = skill.toLowerCase();
    const nextSkills = profile.skills.filter((value) => value.trim().toLowerCase() !== normalized);
    const wasExplicitSkill = nextSkills.length !== profile.skills.length;
    const wasExcluded = (profile.excludedSkills ?? []).some((value) => value.trim().toLowerCase() === normalized);
    const removed = wasExplicitSkill || !wasExcluded;
    if (removed) {
      profile.skills = nextSkills;
      if (!wasExcluded) profile.excludedSkills = [...(profile.excludedSkills ?? []), skill];
      db.prepare(`
        INSERT INTO profile (id, data_json, updated_at)
        VALUES (1, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP
      `).run(JSON.stringify(profile));
    }
    return { profile, removed };
  });

  app.put("/profile", async (request) => {
    const profile = ProfileSchema.parse(request.body);
    const explicit = new Set(profile.skills.map((value) => value.trim().toLowerCase()));
    profile.excludedSkills = (profile.excludedSkills ?? []).filter((value) => !explicit.has(value.trim().toLowerCase()));
    db.prepare(`
      INSERT INTO profile (id, data_json, updated_at)
      VALUES (1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify(profile));
    return profile;
  });
}
