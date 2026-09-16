import type { FastifyInstance } from "fastify";
import { AnswerInputSchema } from "@apply-lite/shared";
import { db } from "../db/database.js";

export async function answerRoutes(app: FastifyInstance) {
  app.get("/answers", async () => {
    return db.prepare("SELECT id, key, label, value, category, updated_at AS updatedAt FROM answer_library ORDER BY category, label").all();
  });

  app.post("/answers", async (request, reply) => {
    const answer = AnswerInputSchema.parse(request.body);
    const result = db.prepare(`
      INSERT INTO answer_library (key, label, value, category)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET label = excluded.label, value = excluded.value, category = excluded.category, updated_at = CURRENT_TIMESTAMP
    `).run(answer.key, answer.label, answer.value, answer.category);
    reply.code(result.changes ? 201 : 200);
    return { ok: true };
  });
}
