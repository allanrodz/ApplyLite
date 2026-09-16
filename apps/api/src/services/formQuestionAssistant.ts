import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CandidateFactsSchema,
  JobInputSchema,
  JobRequirementsSchema,
  ProfileSchema,
  ScreeningAnswerSchema,
  type ScreeningAnswer
} from "@apply-lite/shared";
import { db } from "../db/database.js";
import { askOllamaStructured, ensureOllamaReady } from "./ollama.js";

const DraftModelSchema = z.object({
  answers: z.array(z.object({
    question: z.string(),
    answer: z.string(),
    evidenceIds: z.array(z.string()).default([])
  })).max(6).default([])
});

type EvidenceItem = { id: string; label: string; text: string };

const blockedFactPattern = /\b(visa|sponsor(?:ship)?|work permit|work authori[sz]ation|legally authori[sz]ed|citizenship|nationality|ofac|export control|security clearance|worked with (?:us|the company)|worked here|previously employed|former employee|salary|compensation|base pay|pay expectation|notice period|start date|available to start|relocat(?:e|ion)|criminal|conviction|background check|date of birth|\bdob\b|age|gender|sex|race|ethnic|ethnicity|disability|veteran|military|religion|sexual orientation|marital|pronouns?)\b/i;
const profileLinkPattern = /\b(linkedin|github|google scholar|x profile|twitter|website|portfolio|personal site)\b/i;
const openEndedPattern = /\b(why|what|tell|describe|interest|experience|example|achievement|exceptional|ideal candidate|good fit|best fit|motivat|challenge|project|proud|accomplish|strength|contribute|approach|background|skills|impact)\b/i;
const howHeardPattern = /\bhow did you hear (?:about|of) (?:us|this|the role|the position)|how (?:did|have) you (?:find|learn about)\b/i;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function keyFor(question: string) {
  return `live_form_${createHash("sha256").update(normalize(question)).digest("hex").slice(0, 12)}`;
}

function pushEvidence(items: EvidenceItem[], id: string, label: string, text: string) {
  const value = text.trim();
  if (!value) return;
  items.push({ id, label, text: value.slice(0, 1400) });
}

function loadEvidence(jobId: number) {
  const profileRow = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
  const profile = profileRow ? ProfileSchema.parse(JSON.parse(profileRow.data_json)) : ProfileSchema.parse({});

  const cvRow = db.prepare("SELECT facts_json AS factsJson FROM cv_documents ORDER BY id DESC LIMIT 1").get() as { factsJson: string } | undefined;
  const facts = cvRow ? CandidateFactsSchema.parse(JSON.parse(cvRow.factsJson)) : CandidateFactsSchema.parse({ headline: "", summary: "", skills: [], employment: [], education: [], projects: [], certifications: [], languages: [], evidenceNotes: [] });

  const jobRow = db.prepare(`SELECT source_url AS sourceUrl, title, company, location, salary_text AS salaryText, description, analysis_json AS analysisJson, origin FROM jobs WHERE id = ?`).get(jobId) as (Record<string, unknown> & { analysisJson: string; origin: string }) | undefined;
  if (!jobRow) throw new Error("Job not found.");
  const job = JobInputSchema.parse(jobRow);
  let requirements = JobRequirementsSchema.parse({});
  try { requirements = JobRequirementsSchema.parse(JSON.parse(jobRow.analysisJson || "{}")); } catch { /* keep safe defaults */ }

  const items: EvidenceItem[] = [];
  pushEvidence(items, "profile:title", "Current title", profile.currentTitle);
  pushEvidence(items, "profile:summary", "Saved profile summary", profile.summary);
  profile.skills.slice(0, 20).forEach((skill, index) => pushEvidence(items, `profile:skill:${index}`, "Saved skill", skill));
  pushEvidence(items, "cv:headline", "CV headline", facts.headline);
  pushEvidence(items, "cv:summary", "CV summary", facts.summary);
  facts.skills.slice(0, 24).forEach((skill, index) => pushEvidence(items, `cv:skill:${index}`, "CV skill", skill));

  facts.employment.slice(0, 8).forEach((entry, index) => {
    pushEvidence(items, `cv:employment:${index}:meta`, `${entry.title} · ${entry.employer}`, `${entry.title} at ${entry.employer}; ${entry.startDate || "date not stated"} to ${entry.endDate || "Present/date not stated"}`);
    entry.bullets.slice(0, 5).forEach((bullet, bulletIndex) => pushEvidence(items, `cv:employment:${index}:bullet:${bulletIndex}`, `${entry.title} evidence`, bullet));
  });

  facts.projects.slice(0, 8).forEach((project, index) => {
    pushEvidence(items, `cv:project:${index}:meta`, `Project: ${project.name}`, `${project.name}: ${project.description}${project.technologies.length ? ` Technologies: ${project.technologies.join(", ")}.` : ""}`);
    project.bullets.slice(0, 4).forEach((bullet, bulletIndex) => pushEvidence(items, `cv:project:${index}:bullet:${bulletIndex}`, `${project.name} evidence`, bullet));
  });

  pushEvidence(items, "job:meta", "Target job", `${job.title} at ${job.company}${job.location ? `, ${job.location}` : ""}`);
  pushEvidence(items, "job:summary", "Job summary", requirements.summary || job.description.slice(0, 1500));
  requirements.requiredSkills.slice(0, 16).forEach((skill, index) => pushEvidence(items, `job:required:${index}`, "Required skill", skill));
  requirements.responsibilities.slice(0, 10).forEach((responsibility, index) => pushEvidence(items, `job:responsibility:${index}`, "Responsibility", responsibility));
  pushEvidence(items, "job:source", "Posting source", job.sourceUrl);

  const savedAnswers = db.prepare("SELECT key, label, value FROM answer_library WHERE TRIM(value) <> '' ORDER BY id").all() as Array<{ key: string; label: string; value: string }>;
  savedAnswers.slice(0, 30).forEach((answer) => pushEvidence(items, `answer:${answer.key}`, answer.label, answer.value));

  return { job, profile, items, origin: jobRow.origin || "manual" };
}

function evidencePrompt(items: EvidenceItem[]) {
  return items.map((item) => `[${item.id}] ${item.label}: ${item.text}`).join("\n");
}

export function formQuestionDraftability(question: string, controlType: string) {
  const q = question.trim();
  const type = controlType.toLowerCase();
  if (!q) return { draftable: false, reason: "Empty question" };
  if (blockedFactPattern.test(q)) return { draftable: false, reason: "Personal, legal, compensation, eligibility, or employer-history facts must remain explicit/manual unless already saved." };
  if (profileLinkPattern.test(q)) return { draftable: false, reason: "Profile/social URLs must come from saved profile data, never generated text." };
  if (howHeardPattern.test(q)) return { draftable: true, reason: "Can be derived from the actual job source." };
  if (["textarea", "text", "search"].includes(type) && openEndedPattern.test(q)) return { draftable: true, reason: "Open-ended application question can be drafted from verified evidence." };
  return { draftable: false, reason: "No safe evidence-grounded drafting rule matched this field." };
}

function sourceAnswer(question: string, sourceUrl: string, origin: string): ScreeningAnswer | null {
  if (!howHeardPattern.test(question) || origin !== "discovery") return null;
  let answer = "Company website";
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (host.includes("greenhouse") || host.includes("lever") || host.includes("ashby")) answer = "Company website";
  } catch {
    // Company website remains a conservative description for a direct employer-board discovery.
  }
  return ScreeningAnswerSchema.parse({
    key: keyFor(question),
    question,
    answer,
    evidenceIds: ["job:source"],
    source: "generated",
    needsReview: true
  });
}

export async function draftFormQuestions(jobId: number, questions: Array<{ question: string; controlType: string }>): Promise<ScreeningAnswer[]> {
  const unique = [...new Map(questions.map((item) => [normalize(item.question), item])).values()]
    .filter((item) => formQuestionDraftability(item.question, item.controlType).draftable)
    .slice(0, 6);
  if (!unique.length) return [];

  const { job, items, origin } = loadEvidence(jobId);
  const evidenceById = new Map(items.map((item) => [item.id, item]));
  const safeQuestions = unique.filter((item) => !(howHeardPattern.test(item.question) && origin !== "discovery"));
  const derived = safeQuestions.map((item) => sourceAnswer(item.question, job.sourceUrl, origin)).filter((item): item is ScreeningAnswer => Boolean(item));
  const derivedKeys = new Set(derived.map((item) => normalize(item.question)));
  const aiQuestions = safeQuestions.filter((item) => !derivedKeys.has(normalize(item.question)));
  if (!aiQuestions.length) return derived;

  await ensureOllamaReady();
  const prompt = `You draft concise answers to ACTUAL employer application-form questions for one candidate.

NON-NEGOTIABLE RULES:
- Use ONLY the evidence below. Never invent experience, achievements, technologies, dates, employers, qualifications, metrics, or responsibilities.
- If the evidence is insufficient for a question, OMIT that question from the output rather than guessing.
- Do not answer visa/sponsorship, legal work eligibility, nationality/citizenship, compensation, demographic, prior-employer-history, criminal/background, or other sensitive/factual eligibility questions.
- Do not invent LinkedIn, GitHub, website, Google Scholar, X/Twitter, or other profile URLs.
- Keep each answer direct and natural. Usually 70-140 words; shorter when the question clearly calls for a short response.
- Tailor the answer to ${job.title} at ${job.company}, but do not claim the candidate already has missing required skills.
- Each answer must cite the evidence IDs that support its factual claims.
- Questions below are copied from the live employer form. Preserve the question text exactly in your JSON response.

LIVE FORM QUESTIONS:
${aiQuestions.map((item, index) => `${index + 1}. ${item.question}`).join("\n")}

VERIFIED EVIDENCE:
${evidencePrompt(items).slice(0, 22_000)}

Return only answers you can support. /no_think`;

  const raw = await askOllamaStructured<unknown>(prompt, z.toJSONSchema(DraftModelSchema), { numPredict: 1300, numCtx: 8192, timeoutMs: 90_000 });
  const model = DraftModelSchema.parse(raw);
  const allowedQuestions = new Map(aiQuestions.map((item) => [normalize(item.question), item.question]));
  const generated: ScreeningAnswer[] = [];

  for (const draft of model.answers) {
    const originalQuestion = allowedQuestions.get(normalize(draft.question));
    if (!originalQuestion || !draft.answer.trim()) continue;
    const validEvidenceIds = [...new Set(draft.evidenceIds)].filter((id) => evidenceById.has(id));
    if (!validEvidenceIds.length) continue;
    generated.push(ScreeningAnswerSchema.parse({
      key: keyFor(originalQuestion),
      question: originalQuestion,
      answer: draft.answer.trim().slice(0, 1800),
      evidenceIds: validEvidenceIds,
      source: "generated",
      needsReview: true
    }));
  }

  return [...derived, ...generated];
}
