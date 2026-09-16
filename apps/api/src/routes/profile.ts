import type { FastifyInstance } from "fastify";
import { ProfileSchema } from "@apply-lite/shared";
import { db } from "../db/database.js";

export async function profileRoutes(app: FastifyInstance) {
  app.get("/profile", async () => {
    const row = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
    return row ? ProfileSchema.parse(JSON.parse(row.data_json)) : ProfileSchema.parse({});
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
