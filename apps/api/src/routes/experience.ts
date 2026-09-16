import type { FastifyInstance } from "fastify";
import { CandidateFactsSchema, ProfileSchema } from "@apply-lite/shared";
import { db } from "../db/database.js";
import { deriveExperienceSummary } from "../services/experience.js";

export async function experienceRoutes(app: FastifyInstance) {
  app.get("/experience/summary", async () => {
    const profileRow = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
    const profile = profileRow ? ProfileSchema.parse(JSON.parse(profileRow.data_json)) : ProfileSchema.parse({});
    const cvRow = db.prepare("SELECT facts_json AS factsJson FROM cv_documents ORDER BY id DESC LIMIT 1").get() as { factsJson: string } | undefined;
    const facts = cvRow ? CandidateFactsSchema.safeParse(JSON.parse(cvRow.factsJson)) : null;
    const summary = deriveExperienceSummary(facts?.success ? facts.data : null);
    return {
      ...summary,
      profileYearsExperience: profile.yearsExperience,
      scoringDefaultYears: summary.technicalYears > 0 ? summary.technicalYears : profile.yearsExperience,
      scoringSource: summary.technicalYears > 0 ? "cv-derived" : profile.yearsExperience > 0 ? "profile" : "unknown"
    };
  });
}
