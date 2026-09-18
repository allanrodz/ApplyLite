import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { z } from "zod";
import {
  ApplicationPackageGenerationSchema,
  ApplicationPackageSchema,
  ApplicationPackageDetectionSchema,
  CandidateFactsSchema,
  CoverLetterSchema,
  EvidenceAuditSchema,
  JobInputSchema,
  JobRequirementsSchema,
  ProfileSchema,
  ScreeningAnswerSchema,
  TailoredCvSchema,
  type ApplicationPackage,
  type ApplicationPackageGeneration,
  type CandidateFacts,
  type CoverLetter,
  type EvidenceAudit,
  type JobInput,
  type JobRequirements,
  type Profile,
  type ScreeningAnswer,
  type TailoredCv
} from "@apply-lite/shared";
import { config } from "../config.js";
import { db } from "../db/database.js";
import { askOllamaStructured, ensureOllamaReady } from "./ollama.js";

type EvidenceScope = "candidate" | "job" | "answer";
type EvidenceKind = "profile" | "skill" | "employment-meta" | "employment-bullet" | "education-meta" | "education-detail" | "project-meta" | "project-bullet" | "certification" | "language" | "job" | "answer";

type EvidenceItem = {
  id: string;
  scope: EvidenceScope;
  kind: EvidenceKind;
  label: string;
  text: string;
  index?: number;
  childIndex?: number;
  value?: string;
};

const ResumeSummaryPlanSchema = z.object({ text: z.string(), evidenceIds: z.array(z.string()).default([]) });
const ResumePlanSchema = z.object({
  summary: ResumeSummaryPlanSchema,
  skillEvidenceIds: z.array(z.string()).default([]),
  employment: z.array(z.object({ metaEvidenceId: z.string(), bulletEvidenceIds: z.array(z.string()).default([]) })).default([]),
  projects: z.array(z.object({ metaEvidenceId: z.string(), bulletEvidenceIds: z.array(z.string()).default([]) })).default([])
});
const GeneratedScreeningSchema = z.object({
  key: z.string(),
  question: z.string(),
  answer: z.string(),
  evidenceIds: z.array(z.string()).default([])
});

const ScreeningDraftSchema = z.object({
  screeningAnswers: z.array(GeneratedScreeningSchema).max(4).default([])
});

const AuditModelSchema = z.object({
  claims: z.array(z.object({ index: z.number().int().min(0), supported: z.boolean(), reason: z.string() })).default([]),
  warnings: z.array(z.string()).default([])
});

type ClaimForAudit = { section: string; text: string; evidenceIds: string[]; allowedScopes: EvidenceScope[] };

function loadProfile(): Profile {
  const row = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
  return row ? ProfileSchema.parse(JSON.parse(row.data_json)) : ProfileSchema.parse({});
}

type CandidateDocument = { facts: CandidateFacts; rawText: string; sourceName: string };

function loadCandidateDocument(): CandidateDocument {
  const row = db.prepare("SELECT facts_json AS factsJson, raw_text AS rawText, source_name AS sourceName FROM cv_documents ORDER BY id DESC LIMIT 1")
    .get() as { factsJson: string; rawText: string; sourceName: string } | undefined;
  if (!row) throw new Error("Upload and extract a CV before generating an application package.");
  return {
    facts: CandidateFactsSchema.parse(JSON.parse(row.factsJson)),
    rawText: row.rawText || "",
    sourceName: row.sourceName || ""
  };
}

function loadJob(jobId: number): { job: JobInput; requirements: JobRequirements; ats: string } {
  const row = db.prepare(`SELECT source_url AS sourceUrl, title, company, location, salary_text AS salaryText, description, analysis_json AS analysisJson, ats FROM jobs WHERE id = ?`)
    .get(jobId) as (Record<string, unknown> & { analysisJson: string; ats: string }) | undefined;
  if (!row) throw new Error("Job not found.");
  const job = JobInputSchema.parse(row);
  let requirements: JobRequirements;
  try { requirements = JobRequirementsSchema.parse(JSON.parse(row.analysisJson || "{}")); }
  catch { requirements = JobRequirementsSchema.parse({}); }
  return { job, requirements, ats: row.ats };
}

function loadAnswers() {
  return db.prepare("SELECT key, label, value, category FROM answer_library WHERE TRIM(value) <> '' ORDER BY category, label")
    .all() as Array<{ key: string; label: string; value: string; category: string }>;
}

function pushEvidence(items: EvidenceItem[], item: EvidenceItem) {
  if (item.text.trim()) items.push({ ...item, text: item.text.trim().slice(0, 1200) });
}

function buildEvidence(profile: Profile, facts: CandidateFacts, job: JobInput, requirements: JobRequirements) {
  const candidate: EvidenceItem[] = [];
  const jobEvidence: EvidenceItem[] = [];
  const answerEvidence: EvidenceItem[] = [];

  pushEvidence(candidate, { id: "profile:current-title", scope: "candidate", kind: "profile", label: "Current title", text: profile.currentTitle });
  pushEvidence(candidate, { id: "profile:summary", scope: "candidate", kind: "profile", label: "Saved profile summary", text: profile.summary });
  profile.skills.forEach((skill, index) => pushEvidence(candidate, { id: `profile:skill:${index}`, scope: "candidate", kind: "skill", label: "Saved profile skill", text: skill, index, value: skill }));
  pushEvidence(candidate, { id: "cv:headline", scope: "candidate", kind: "profile", label: "CV headline", text: facts.headline });
  pushEvidence(candidate, { id: "cv:summary", scope: "candidate", kind: "profile", label: "CV summary", text: facts.summary });
  facts.skills.forEach((skill, index) => pushEvidence(candidate, { id: `cv:skill:${index}`, scope: "candidate", kind: "skill", label: "CV skill", text: skill, index, value: skill }));

  facts.employment.forEach((entry, index) => {
    pushEvidence(candidate, {
      id: `cv:employment:${index}:meta`, scope: "candidate", kind: "employment-meta", index,
      label: `${entry.title} · ${entry.employer}`,
      text: `${entry.title} at ${entry.employer}; ${entry.startDate || "date not stated"} to ${entry.endDate || "Present/date not stated"}${entry.location ? `; ${entry.location}` : ""}`
    });
    entry.bullets.forEach((bullet, childIndex) => pushEvidence(candidate, {
      id: `cv:employment:${index}:bullet:${childIndex}`, scope: "candidate", kind: "employment-bullet", index, childIndex,
      label: `${entry.title} · ${entry.employer} bullet`, text: bullet
    }));
  });

  facts.education.forEach((entry, index) => {
    pushEvidence(candidate, {
      id: `cv:education:${index}:meta`, scope: "candidate", kind: "education-meta", index,
      label: `${entry.qualification} · ${entry.institution}`,
      text: `${entry.qualification}${entry.field ? ` in ${entry.field}` : ""} at ${entry.institution}; ${entry.startDate || "date not stated"} to ${entry.endDate || "date not stated"}`
    });
    entry.details.forEach((detail, childIndex) => pushEvidence(candidate, {
      id: `cv:education:${index}:detail:${childIndex}`, scope: "candidate", kind: "education-detail", index, childIndex,
      label: `${entry.qualification} detail`, text: detail
    }));
  });

  facts.projects.forEach((entry, index) => {
    pushEvidence(candidate, {
      id: `cv:project:${index}:meta`, scope: "candidate", kind: "project-meta", index,
      label: `Project: ${entry.name}`,
      text: `${entry.name}: ${entry.description}${entry.technologies.length ? ` Technologies: ${entry.technologies.join(", ")}.` : ""}`
    });
    entry.bullets.forEach((bullet, childIndex) => pushEvidence(candidate, {
      id: `cv:project:${index}:bullet:${childIndex}`, scope: "candidate", kind: "project-bullet", index, childIndex,
      label: `${entry.name} bullet`, text: bullet
    }));
  });

  facts.certifications.forEach((item, index) => pushEvidence(candidate, { id: `cv:certification:${index}`, scope: "candidate", kind: "certification", label: "Certification", text: item, index }));
  facts.languages.forEach((item, index) => pushEvidence(candidate, { id: `cv:language:${index}`, scope: "candidate", kind: "language", label: "Language", text: item, index }));

  pushEvidence(jobEvidence, { id: "job:meta", scope: "job", kind: "job", label: "Job", text: `${job.title} at ${job.company}${job.location ? `, ${job.location}` : ""}` });
  pushEvidence(jobEvidence, { id: "job:summary", scope: "job", kind: "job", label: "Job summary", text: requirements.summary || job.description.slice(0, 1200) });
  requirements.requiredSkills.forEach((skill, index) => pushEvidence(jobEvidence, { id: `job:required-skill:${index}`, scope: "job", kind: "job", label: "Required skill", text: skill, index }));
  requirements.preferredSkills.forEach((skill, index) => pushEvidence(jobEvidence, { id: `job:preferred-skill:${index}`, scope: "job", kind: "job", label: "Preferred skill", text: skill, index }));
  requirements.responsibilities.slice(0, 12).forEach((item, index) => pushEvidence(jobEvidence, { id: `job:responsibility:${index}`, scope: "job", kind: "job", label: "Job responsibility", text: item, index }));

  loadAnswers().forEach((answer) => pushEvidence(answerEvidence, {
    id: `answer:${answer.key}`, scope: "answer", kind: "answer", label: answer.label,
    text: `${answer.label}: ${answer.value}`, value: answer.value
  }));

  return { candidate, job: jobEvidence, answers: answerEvidence, all: [...candidate, ...jobEvidence, ...answerEvidence] };
}

function evidencePrompt(items: EvidenceItem[]) {
  return items.map((item) => `[${item.id}] (${item.scope}/${item.kind}) ${item.label}: ${item.text}`).join("\n");
}

function resumePlanPrompt(job: JobInput, requirements: JobRequirements, evidence: ReturnType<typeof buildEvidence>) {
  return `You are selecting evidence for a concise ATS-friendly resume tailored to one job.

NON-NEGOTIABLE RULES:
- Use ONLY candidate evidence IDs supplied below.
- Never invent technologies, years, metrics, dates, employers, qualifications, responsibilities, achievements, or personal details.
- DO NOT write new employment or project bullets. Select ONLY existing evidence IDs. The server inserts the exact source text.
- Select only skills represented by candidate skill evidence IDs.
- The summary may be newly worded, but every factual statement must be supported by summary.evidenceIds.
- Prefer the most relevant 3-5 employment entries, up to 4 projects, and the strongest matching skills.
- If evidence is weak, omit it rather than guessing.

TARGET JOB:
${job.title} at ${job.company}
Location: ${job.location || "not specified"}
Required skills: ${requirements.requiredSkills.join(", ") || "not explicitly extracted"}
Preferred skills: ${requirements.preferredSkills.join(", ") || "not explicitly extracted"}
Responsibilities: ${requirements.responsibilities.slice(0, 6).join(" | ") || "not explicitly extracted"}

CANDIDATE EVIDENCE:
${evidencePrompt(evidence.candidate).slice(0, 18_000)}

Return ONLY the resume plan. /no_think`;
}

function coverLetterPrompt(job: JobInput, requirements: JobRequirements, evidence: ReturnType<typeof buildEvidence>) {
  return `Write a concise evidence-grounded cover letter for this job.

RULES:
- Candidate claims may use ONLY candidate or answer evidence IDs below.
- Job/company statements may use job evidence IDs.
- Never invent technologies, years, metrics, dates, employers, qualifications, responsibilities, achievements, legal status, salary expectations, or personal details.
- Keep it to 3 short paragraphs plus salutation and closing.
- closing must contain only the sign-off phrase (for example "Kind regards," or "Sincerely,"). Never include a name or placeholder such as [Your Name].
- Every paragraph must include evidenceIds supporting any factual content.
- Statements of motivation may cite job evidence.
- If evidence is insufficient, use restrained language rather than guessing.

TARGET JOB:
${job.title} at ${job.company}
Location: ${job.location || "not specified"}
Summary: ${requirements.summary || job.description.slice(0, 900)}
Required skills: ${requirements.requiredSkills.join(", ") || "not explicitly extracted"}

EVIDENCE:
${evidencePrompt([...evidence.candidate, ...evidence.job, ...evidence.answers]).slice(0, 18_000)}

Return ONLY the cover letter object. /no_think`;
}

function screeningPrompt(job: JobInput, requirements: JobRequirements, evidence: ReturnType<typeof buildEvidence>) {
  return `Draft up to 3 short, reusable screening answers for this job.

RULES:
- Generate only ordinary job questions such as interest in the role, relevant experience, and why the candidate is a fit.
- Do NOT answer demographic, disability, criminal-history, health, security-clearance, political, religious, or other sensitive questions.
- Candidate claims may use ONLY candidate or answer evidence IDs below.
- Job/company statements may use job evidence IDs.
- Never invent facts. If evidence is insufficient, omit the question.
- Every generated answer must include evidenceIds.

TARGET JOB:
${job.title} at ${job.company}
Summary: ${requirements.summary || job.description.slice(0, 700)}
Required skills: ${requirements.requiredSkills.join(", ") || "not explicitly extracted"}

EVIDENCE:
${evidencePrompt([...evidence.candidate, ...evidence.job, ...evidence.answers]).slice(0, 14_000)}

Return ONLY an object with screeningAnswers. /no_think`;
}

const MATCH_STOP_WORDS = new Set([
  "and", "the", "with", "for", "from", "into", "your", "our", "this", "that", "role", "work", "working",
  "experience", "skills", "skill", "using", "used", "ability", "strong", "knowledge", "including", "across", "within"
]);

function normalizeMatch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchTokens(value: string) {
  return normalizeMatch(value).split(" ").filter((token) => token.length >= 3 && !MATCH_STOP_WORDS.has(token));
}

function itemOverlapScore(text: string, target: string) {
  const haystack = normalizeMatch(text);
  const tokens = matchTokens(target);
  if (!haystack || !tokens.length) return 0;
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function candidateSkillEvidence(requirements: JobRequirements, evidence: ReturnType<typeof buildEvidence>) {
  const skillItems = evidence.candidate.filter((item) => item.kind === "skill" && (item.value || item.text));
  const orderedRequirements = [...requirements.requiredSkills, ...requirements.preferredSkills];
  const selected: EvidenceItem[] = [];
  const seen = new Set<string>();

  for (const requirement of orderedRequirements) {
    const req = normalizeMatch(requirement);
    for (const item of skillItems) {
      const value = (item.value || item.text).trim();
      const skill = normalizeMatch(value);
      if (!skill || seen.has(item.id)) continue;
      const direct = req.includes(skill) || skill.includes(req);
      const tokenHit = matchTokens(value).some((token) => req.includes(token));
      if (!direct && !tokenHit) continue;
      selected.push(item);
      seen.add(item.id);
    }
  }
  return selected;
}

function rankCandidateEvidence(items: EvidenceItem[], targetText: string) {
  return [...items].sort((a, b) => itemOverlapScore(b.text, targetText) - itemOverlapScore(a.text, targetText));
}

function formatNaturalList(values: string[]) {
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function roleFamilyHeadline(job: JobInput, selectedSkills: string[]) {
  const title = job.title.toLowerCase();
  let family = "SOFTWARE DEVELOPMENT";
  if (/project manager|project coordinator|delivery manager|pmo/.test(title)) family = "IT PROJECT MANAGEMENT";
  else if (/front.?end|react/.test(title)) family = "FRONTEND DEVELOPMENT";
  else if (/support|implementation|solutions? consultant/.test(title)) family = "TECHNICAL SUPPORT & SOFTWARE";
  else if (/\b(ai|machine learning|mlops|data engineer)/.test(title)) family = "AI & SOFTWARE ENGINEERING";
  else if (/qa|test automation|quality/.test(title)) family = "QA & TEST AUTOMATION";

  const conciseSkills = selectedSkills
    .filter((skill) => skill.length <= 28 && !/[()]/.test(skill))
    .slice(0, 4);
  return [family, ...conciseSkills].join(" | ");
}

function fallbackResumePlan(
  job: JobInput,
  requirements: JobRequirements,
  profile: Profile,
  facts: CandidateFacts,
  evidence: ReturnType<typeof buildEvidence>
): z.infer<typeof ResumePlanSchema> {
  const ids = new Set(evidence.candidate.map((item) => item.id));
  const summaryEvidenceIds = [
    facts.summary && ids.has("cv:summary") ? "cv:summary" : "",
    !facts.summary && profile.summary && ids.has("profile:summary") ? "profile:summary" : "",
    facts.headline && ids.has("cv:headline") ? "cv:headline" : ""
  ].filter(Boolean);

  const targetText = [
    job.title,
    requirements.summary,
    ...requirements.requiredSkills,
    ...requirements.preferredSkills,
    ...requirements.responsibilities
  ].join(" ");

  const matchedSkills = candidateSkillEvidence(requirements, evidence);
  const remainingSkills = rankCandidateEvidence(
    evidence.candidate.filter((item) => item.kind === "skill" && !matchedSkills.some((matched) => matched.id === item.id)),
    targetText
  );
  const skillEvidenceIds = [...matchedSkills, ...remainingSkills].slice(0, 14).map((item) => item.id);

  const employment = facts.employment.map((entry, index) => {
    const bullets = entry.bullets.map((bullet, childIndex) => ({
      id: `cv:employment:${index}:bullet:${childIndex}`,
      score: itemOverlapScore(bullet, targetText)
    })).sort((a, b) => b.score - a.score);
    const score = bullets.reduce((total, bullet) => total + bullet.score, 0)
      + itemOverlapScore(`${entry.title} ${entry.employer}`, targetText);
    return {
      score,
      index,
      metaEvidenceId: `cv:employment:${index}:meta`,
      bulletEvidenceIds: bullets.slice(0, 4).map((bullet) => bullet.id)
    };
  }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 5)
    .map(({ metaEvidenceId, bulletEvidenceIds }) => ({ metaEvidenceId, bulletEvidenceIds }));

  const projects = facts.projects.map((entry, index) => {
    const projectText = `${entry.name} ${entry.description} ${entry.technologies.join(" ")} ${entry.bullets.join(" ")}`;
    const bullets = entry.bullets.map((bullet, childIndex) => ({
      id: `cv:project:${index}:bullet:${childIndex}`,
      score: itemOverlapScore(bullet, targetText)
    })).sort((a, b) => b.score - a.score);
    return {
      score: itemOverlapScore(projectText, targetText),
      index,
      metaEvidenceId: `cv:project:${index}:meta`,
      bulletEvidenceIds: bullets.slice(0, 4).map((bullet) => bullet.id)
    };
  }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 4)
    .map(({ metaEvidenceId, bulletEvidenceIds }) => ({ metaEvidenceId, bulletEvidenceIds }));

  return ResumePlanSchema.parse({
    summary: { text: facts.summary || profile.summary || facts.headline || profile.currentTitle || "", evidenceIds: summaryEvidenceIds },
    skillEvidenceIds,
    employment,
    projects
  });
}

function shortResponsibility(value: string) {
  const cleaned = value.trim().replace(/[.;]+$/, "").replace(/^([A-Z])(?=[a-z])/, (letter) => letter.toLowerCase());
  return cleaned.length <= 150 ? cleaned : `${cleaned.slice(0, 147).trim()}...`;
}

function fallbackCoverLetter(job: JobInput, requirements: JobRequirements, evidence: ReturnType<typeof buildEvidence>): CoverLetter {
  const jobMeta = evidence.job.find((item) => item.id === "job:meta") ?? evidence.job[0];
  const jobResponsibilities = evidence.job.filter((item) => item.id.startsWith("job:responsibility:"));
  const matchedSkills = candidateSkillEvidence(requirements, evidence).slice(0, 4);
  const skillNames = Array.from(new Set(matchedSkills.map((item) => item.value || item.text).filter(Boolean)));
  const summaryEvidence = evidence.candidate.find((item) => item.id === "cv:summary")
    ?? evidence.candidate.find((item) => item.id === "profile:summary");

  const firstResponsibility = requirements.responsibilities[0] ? shortResponsibility(requirements.responsibilities[0]) : "the engineering work described in the posting";
  const secondResponsibility = requirements.responsibilities[1] ? shortResponsibility(requirements.responsibilities[1]) : "reliable production systems";

  const paragraphOneEvidence = [jobMeta?.id, jobResponsibilities[0]?.id, jobResponsibilities[1]?.id].filter((id): id is string => Boolean(id));
  const paragraphTwoEvidence = [...matchedSkills.map((item) => item.id), summaryEvidence?.id].filter((id): id is string => Boolean(id));
  const paragraphThreeEvidence = [jobMeta?.id, jobResponsibilities[0]?.id, ...matchedSkills.slice(0, 2).map((item) => item.id)].filter((id): id is string => Boolean(id));

  const paragraphTwo = skillNames.length
    ? `My CV documents experience with ${formatNaturalList(skillNames)}${summaryEvidence ? ", alongside broader software development and automation work" : ""}. This gives me a practical foundation for the role while keeping the application grounded in skills I can verify.`
    : `My CV documents a software-development background that I would bring to this role. I have kept this application focused on experience I can verify rather than claiming tools or domain knowledge that are not yet in my CV.`;

  return CoverLetterSchema.parse({
    salutation: "Dear Hiring Team,",
    paragraphs: [
      {
        text: `I am applying for the ${job.title} position at ${job.company}. I am particularly interested in the role's focus on ${firstResponsibility} and ${secondResponsibility}.`,
        evidenceIds: paragraphOneEvidence
      },
      { text: paragraphTwo, evidenceIds: paragraphTwoEvidence },
      {
        text: `I would welcome the opportunity to bring this foundation to ${job.company}, contribute to ${firstResponsibility}, and deepen my experience with the parts of the stack that are newer to me.`,
        evidenceIds: paragraphThreeEvidence
      }
    ],
    closing: "Kind regards,"
  });
}

function hydrateResume(plan: z.infer<typeof ResumePlanSchema>, job: JobInput, profile: Profile, facts: CandidateFacts, evidence: EvidenceItem[]): TailoredCv {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const selectedSkills = Array.from(new Set(plan.skillEvidenceIds
    .map((id) => byId.get(id))
    .filter((item): item is EvidenceItem => Boolean(item && item.scope === "candidate" && item.kind === "skill"))
    .map((item) => item.value || item.text)
    .filter(Boolean))).slice(0, 18);

  const employment = plan.employment.flatMap((selection) => {
    const meta = byId.get(selection.metaEvidenceId);
    if (!meta || meta.scope !== "candidate" || meta.kind !== "employment-meta" || meta.index === undefined) return [];
    const source = facts.employment[meta.index];
    if (!source) return [];
    let bullets = selection.bulletEvidenceIds.flatMap((id) => {
      const item = byId.get(id);
      if (!item || item.kind !== "employment-bullet" || item.index !== meta.index || item.childIndex === undefined) return [];
      const text = source.bullets[item.childIndex];
      return text ? [{ text, evidenceIds: [id] }] : [];
    }).slice(0, 5);
    if (!bullets.length) bullets = source.bullets.slice(0, 3).map((text, childIndex) => ({ text, evidenceIds: [`cv:employment:${meta.index}:bullet:${childIndex}`] }));
    return [{ ...source, bullets }];
  });

  const projects = plan.projects.flatMap((selection) => {
    const meta = byId.get(selection.metaEvidenceId);
    if (!meta || meta.scope !== "candidate" || meta.kind !== "project-meta" || meta.index === undefined) return [];
    const source = facts.projects[meta.index];
    if (!source) return [];
    let bullets = selection.bulletEvidenceIds.flatMap((id) => {
      const item = byId.get(id);
      if (!item || item.kind !== "project-bullet" || item.index !== meta.index || item.childIndex === undefined) return [];
      const text = source.bullets[item.childIndex];
      return text ? [{ text, evidenceIds: [id] }] : [];
    }).slice(0, 4);
    if (!bullets.length) bullets = source.bullets.slice(0, 3).map((text, childIndex) => ({ text, evidenceIds: [`cv:project:${meta.index}:bullet:${childIndex}`] }));
    return [{ ...source, bullets }];
  });

  const fallbackEmployment = facts.employment.slice(0, 4).map((source, index) => ({
    ...source,
    bullets: source.bullets.slice(0, 3).map((text, childIndex) => ({ text, evidenceIds: [`cv:employment:${index}:bullet:${childIndex}`] }))
  }));

  return TailoredCvSchema.parse({
    headline: roleFamilyHeadline(job, selectedSkills.length ? selectedSkills : facts.skills),
    summary: plan.summary.text || facts.summary || profile.summary,
    summaryEvidenceIds: plan.summary.evidenceIds.filter((id) => byId.get(id)?.scope === "candidate"),
    skills: selectedSkills.length ? selectedSkills : facts.skills.slice(0, 18),
    employment: employment.length ? employment : fallbackEmployment,
    education: facts.education,
    projects: projects.length ? projects : facts.projects.slice(0, 3).map((source, index) => ({
      ...source,
      bullets: source.bullets.slice(0, 3).map((text, childIndex) => ({ text, evidenceIds: [`cv:project:${index}:bullet:${childIndex}`] }))
    }))
  });
}

function addAnswerLibraryDrafts(generated: ScreeningAnswer[], evidence: EvidenceItem[]) {
  const copied = evidence
    .filter((item) => item.scope === "answer" && item.value)
    .slice(0, 8)
    .map((item) => ScreeningAnswerSchema.parse({
      key: item.id.replace(/^answer:/, ""),
      question: item.label,
      answer: item.value,
      evidenceIds: [item.id],
      source: "answer-library",
      needsReview: false
    }));
  const seen = new Set(generated.map((item) => item.question.trim().toLowerCase()));
  return [...generated, ...copied.filter((item) => !seen.has(item.question.trim().toLowerCase()))];
}

function claimsForAudit(tailoredCv: TailoredCv, coverLetter: CoverLetter, answers: ScreeningAnswer[]): ClaimForAudit[] {
  const claims: ClaimForAudit[] = [];
  if (tailoredCv.summary.trim()) claims.push({
    section: "resume summary", text: tailoredCv.summary, evidenceIds: tailoredCv.summaryEvidenceIds, allowedScopes: ["candidate", "answer"]
  });
  coverLetter.paragraphs.forEach((paragraph, index) => claims.push({
    section: `cover letter paragraph ${index + 1}`, text: paragraph.text, evidenceIds: paragraph.evidenceIds, allowedScopes: ["candidate", "answer", "job"]
  }));
  answers.filter((answer) => answer.source === "generated").forEach((answer) => claims.push({
    section: `screening answer: ${answer.question}`, text: answer.answer, evidenceIds: answer.evidenceIds, allowedScopes: ["candidate", "answer", "job"]
  }));
  return claims;
}

async function auditGeneratedClaims(claims: ClaimForAudit[], evidence: EvidenceItem[]): Promise<EvidenceAudit> {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const deterministicFlags: z.infer<typeof EvidenceAuditSchema>["flaggedClaims"] = [];

  claims.forEach((claim) => {
    if (!claim.evidenceIds.length) {
      deterministicFlags.push({ section: claim.section, text: claim.text, reason: "No supporting evidence IDs were supplied.", evidenceIds: [] });
      return;
    }
    const invalid = claim.evidenceIds.filter((id) => {
      const item = byId.get(id);
      return !item || !claim.allowedScopes.includes(item.scope);
    });
    if (invalid.length) deterministicFlags.push({
      section: claim.section, text: claim.text,
      reason: `Invalid or disallowed evidence IDs: ${invalid.join(", ")}`,
      evidenceIds: claim.evidenceIds
    });
  });

  const validClaims = claims.map((claim, index) => ({
    index,
    section: claim.section,
    text: claim.text,
    evidence: claim.evidenceIds.map((id) => byId.get(id)).filter(Boolean).map((item) => `[${item!.id}] ${item!.text}`)
  }));

  let modelWarnings: string[] = [];
  const semanticFlags: z.infer<typeof EvidenceAuditSchema>["flaggedClaims"] = [];
  try {
    const prompt = `You are a strict factual support auditor. For each generated claim, decide whether the supplied evidence fully supports the factual content. Do not reward plausible inference. Aspirational language and statements of interest need no candidate proof, but concrete experience, skills, achievements, dates, qualifications, company facts, and numerical claims must be supported. Mark a claim unsupported if it adds material facts beyond the evidence.

CLAIMS:
${validClaims.map((claim) => `#${claim.index} ${claim.section}\nCLAIM: ${claim.text}\nEVIDENCE:\n${claim.evidence.join("\n") || "(none)"}`).join("\n\n").slice(0, 24_000)}

Return one result for every claim index. /no_think`;
    const audited = AuditModelSchema.parse(await askOllamaStructured<unknown>(prompt, z.toJSONSchema(AuditModelSchema), { numPredict: 1400, numCtx: 8192, timeoutMs: 75_000 }));
    modelWarnings = audited.warnings;
    for (const result of audited.claims) {
      if (result.supported) continue;
      const claim = claims[result.index];
      if (!claim) continue;
      semanticFlags.push({ section: claim.section, text: claim.text, reason: result.reason || "The semantic auditor could not verify this claim.", evidenceIds: claim.evidenceIds });
    }
  } catch (error) {
    modelWarnings.push(`Semantic evidence audit could not complete: ${error instanceof Error ? error.message : "unknown error"}. Review generated prose manually.`);
  }

  const unique = [...deterministicFlags, ...semanticFlags].filter((flag, index, all) =>
    all.findIndex((item) => item.section === flag.section && item.text === flag.text) === index
  );
  return EvidenceAuditSchema.parse({
    status: unique.length || modelWarnings.length ? "REVIEW" : "PASS",
    checkedClaims: claims.length,
    supportedClaims: Math.max(0, claims.length - unique.length),
    flaggedClaims: unique,
    warnings: modelWarnings
  });
}

const NAME_BLOCKLIST = new Set([
  "ai", "api", "software", "engineer", "engineering", "developer", "development", "project", "manager",
  "management", "consultant", "analyst", "data", "cloud", "mlops", "machine", "learning", "computing",
  "student", "frontend", "backend", "full", "stack", "resume", "cv", "curriculum", "vitae", "profile"
]);

function looksLikeHumanName(value: string) {
  const line = value.trim().replace(/\s+/g, " ");
  if (!line || line.length > 70 || /[@|·:/\\]|\d/.test(line)) return false;
  const parts = line.split(" ").filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return false;
  if (parts.some((part) => NAME_BLOCKLIST.has(part.toLowerCase().replace(/[^a-z]/g, "")))) return false;
  return parts.every((part) => /^[A-Za-zÀ-ÖØ-öø-ÿ'’-]+$/.test(part));
}

function inferNameFromRawText(rawText: string) {
  for (const rawLine of rawText.split(/\r?\n/).slice(0, 14)) {
    const line = rawLine.trim();
    if (looksLikeHumanName(line)) return line.replace(/\s+/g, " ");
  }
  return "";
}

function inferNameFromSourceName(sourceName: string) {
  const base = path.basename(sourceName, path.extname(sourceName)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (looksLikeHumanName(base)) return base;
  const parts = base.split(" ").filter(Boolean);
  const kept: string[] = [];
  for (const part of parts) {
    const normalized = part.toLowerCase().replace(/[^a-z]/g, "");
    if (NAME_BLOCKLIST.has(normalized)) break;
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ'’-]+$/.test(part)) break;
    kept.push(part);
  }
  const candidate = kept.join(" ");
  return looksLikeHumanName(candidate) ? candidate : "";
}

function resolveCandidateName(profile: Profile, facts: CandidateFacts, rawText: string, sourceName: string) {
  const profileName = [profile.firstName, profile.lastName].map((part) => part.trim()).filter(Boolean).join(" ");
  if (profileName) return profileName;
  if (facts.fullName?.trim()) return facts.fullName.trim();
  return inferNameFromRawText(rawText) || inferNameFromSourceName(sourceName) || "Candidate";
}

function sanitizeClosing(value: string) {
  const withoutPlaceholder = (value || "")
    .replace(/\[(?:your\s+)?name\]/gi, "")
    .replace(/\{\{\s*(?:candidate[_\s-]*)?name\s*\}\}/gi, "")
    .replace(/<\s*(?:your\s+)?name\s*>/gi, "")
    .trim();
  const firstLine = withoutPlaceholder.split(/\r?\n/)[0]?.trim() || "";
  return firstLine || "Kind regards,";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] ?? character));
}

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "application";
}

function cvHtml(profile: Profile, cv: TailoredCv, candidateName: string) {
  const contact = [profile.email, profile.phone, profile.city, profile.country].filter(Boolean).map(escapeHtml).join(" · ");
  const links = [profile.linkedinUrl, profile.githubUrl, profile.portfolioUrl].filter(Boolean).map((url) => `<span>${escapeHtml(url)}</span>`).join(" · ");
  const employment = cv.employment.map((entry) => `
    <section><div class="row"><div><h2>${escapeHtml(entry.title)}</h2><strong>${escapeHtml(entry.employer)}</strong></div><div class="date">${escapeHtml(entry.startDate)} – ${escapeHtml(entry.endDate || "Present")}</div></div>
    ${entry.location ? `<div class="sub">${escapeHtml(entry.location)}</div>` : ""}
    <ul>${entry.bullets.map((bullet) => `<li>${escapeHtml(bullet.text)}</li>`).join("")}</ul></section>`).join("");
  const projects = cv.projects.map((entry) => `
    <section><h2>${escapeHtml(entry.name)}</h2><div class="sub">${escapeHtml(entry.technologies.join(" · "))}</div><p>${escapeHtml(entry.description)}</p><ul>${entry.bullets.map((bullet) => `<li>${escapeHtml(bullet.text)}</li>`).join("")}</ul></section>`).join("");
  const education = cv.education.map((entry) => `
    <section><div class="row"><div><h2>${escapeHtml(entry.qualification)}${entry.field ? ` — ${escapeHtml(entry.field)}` : ""}</h2><strong>${escapeHtml(entry.institution)}</strong></div><div class="date">${escapeHtml(entry.startDate)} – ${escapeHtml(entry.endDate)}</div></div>${entry.details.length ? `<ul>${entry.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>` : ""}</section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:15mm 16mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:10.5pt;line-height:1.38;margin:0}h1{font-size:23pt;margin:0 0 3px}h2{font-size:11.5pt;margin:0 0 2px}h3{font-size:10pt;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #cfd5df;padding-bottom:4px;margin:16px 0 9px}.headline{font-size:11.5pt;color:#42516a;margin-bottom:6px}.contact,.links,.sub,.date{font-size:9pt;color:#5b6677}.links{margin-top:2px}.summary{margin:12px 0}.skills{display:flex;flex-wrap:wrap;gap:5px}.skill{border:1px solid #d8dde6;border-radius:3px;padding:2px 6px}.row{display:flex;justify-content:space-between;gap:18px}.date{white-space:nowrap}section{break-inside:avoid;margin-bottom:9px}ul{margin:5px 0 0;padding-left:17px}li{margin:2px 0}p{margin:5px 0}strong{font-weight:600}
  </style></head><body>
  <h1>${escapeHtml(candidateName)}</h1>
  <div class="headline">${escapeHtml(cv.headline)}</div><div class="contact">${contact}</div><div class="links">${links}</div>
  <p class="summary">${escapeHtml(cv.summary)}</p>
  <h3>Core skills</h3><div class="skills">${cv.skills.map((skill) => `<span class="skill">${escapeHtml(skill)}</span>`).join("")}</div>
  <h3>Experience</h3>${employment}
  ${cv.projects.length ? `<h3>Selected projects</h3>${projects}` : ""}
  ${cv.education.length ? `<h3>Education</h3>${education}` : ""}
  </body></html>`;
}

function coverLetterHtml(profile: Profile, job: JobInput, coverLetter: CoverLetter, candidateName: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:22mm}body{font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:11pt;line-height:1.55;margin:0}.header{margin-bottom:34px}.name{font-size:19pt;font-weight:700}.meta{font-size:9.5pt;color:#667286;margin-top:4px}.date{margin:28px 0 24px}p{margin:0 0 15px}.closing{margin-top:24px}
  </style></head><body><div class="header"><div class="name">${escapeHtml(candidateName)}</div><div class="meta">${escapeHtml([profile.email, profile.phone, profile.city, profile.country].filter(Boolean).join(" · "))}</div></div><div class="date">${escapeHtml(new Date().toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" }))}</div><p><strong>${escapeHtml(job.title)}</strong><br>${escapeHtml(job.company)}${job.location ? `<br>${escapeHtml(job.location)}` : ""}</p><p>${escapeHtml(coverLetter.salutation || "Dear Hiring Team,")}</p>${coverLetter.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph.text)}</p>`).join("")}<p class="closing">${escapeHtml(sanitizeClosing(coverLetter.closing))}<br>${escapeHtml(candidateName)}</p></body></html>`;
}

function cvText(profile: Profile, cv: TailoredCv, candidateName: string) {
  const lines = [
    candidateName, cv.headline,
    [profile.email, profile.phone, profile.city, profile.country].filter(Boolean).join(" | "), "",
    "SUMMARY", cv.summary, "", "SKILLS", cv.skills.join(" | "), "", "EXPERIENCE"
  ];
  cv.employment.forEach((entry) => {
    lines.push(`${entry.title} | ${entry.employer} | ${entry.startDate} - ${entry.endDate || "Present"}`);
    if (entry.location) lines.push(entry.location);
    entry.bullets.forEach((bullet) => lines.push(`- ${bullet.text}`));
    lines.push("");
  });
  if (cv.projects.length) {
    lines.push("PROJECTS");
    cv.projects.forEach((entry) => {
      lines.push(entry.name, entry.description);
      if (entry.technologies.length) lines.push(`Technologies: ${entry.technologies.join(", ")}`);
      entry.bullets.forEach((bullet) => lines.push(`- ${bullet.text}`));
      lines.push("");
    });
  }
  if (cv.education.length) {
    lines.push("EDUCATION");
    cv.education.forEach((entry) => lines.push(`${entry.qualification}${entry.field ? ` in ${entry.field}` : ""} | ${entry.institution} | ${entry.startDate} - ${entry.endDate}`));
  }
  return lines.join("\n");
}

function coverLetterText(coverLetter: CoverLetter, candidateName: string) {
  return [coverLetter.salutation || "Dear Hiring Team,", "", ...coverLetter.paragraphs.flatMap((paragraph) => [paragraph.text, ""]), sanitizeClosing(coverLetter.closing), candidateName].join("\n");
}

function screeningText(answers: ScreeningAnswer[]) {
  return answers.map((answer) => `${answer.question}\n${answer.answer}\n${answer.needsReview ? "[Review before use]" : "[From your saved Answer Library]"}`).join("\n\n---\n\n");
}

async function renderPdf(html: string, outputPath: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: outputPath, format: "A4", printBackground: true });
  } finally {
    await browser.close();
  }
}

function artifactMime(filename: string) {
  if (filename.endsWith(".pdf")) return "application/pdf";
  if (filename.endsWith(".json")) return "application/json";
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function artifactRows(packageId: number) {
  const rows = db.prepare("SELECT id, kind, path FROM generated_artifacts WHERE package_id = ? ORDER BY id").all(packageId) as Array<{ id: number; kind: string; path: string }>;
  return rows.map((row) => ({ id: row.id, kind: row.kind, filename: path.basename(row.path), downloadUrl: `/artifacts/${row.id}/download` }));
}

export function getArtifact(id: number) {
  const row = db.prepare("SELECT id, kind, path FROM generated_artifacts WHERE id = ?").get(id) as { id: number; kind: string; path: string } | undefined;
  if (!row) return null;
  const storageRoot = path.resolve(process.cwd(), config.storagePath);
  const absolutePath = path.resolve(process.cwd(), row.path);
  const relative = path.relative(storageRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(absolutePath)) return null;
  return { ...row, absolutePath, filename: path.basename(row.path), mime: artifactMime(row.path) };
}

function packageGenerationFromFailures(failedStages: ApplicationPackageGeneration["failedStages"]): ApplicationPackageGeneration {
  const unique = Array.from(new Set(failedStages));
  const criticalFailure = unique.includes("resume") || unique.includes("cover-letter");
  const mode: ApplicationPackageGeneration["mode"] = unique.length === 0
    ? "AI"
    : unique.includes("resume") && unique.includes("cover-letter")
      ? "FALLBACK"
      : "MIXED";

  let message = "Generated with local AI and evidence auditing.";
  if (criticalFailure) {
    message = "Local AI could not complete one or more core documents. ApplyLite created an evidence-grounded fallback for review, but will not auto-upload this package. Regenerate it before opening the application assistant.";
  } else if (unique.length) {
    message = "Core documents were generated, but one or more supporting AI stages need review.";
  }

  return ApplicationPackageGenerationSchema.parse({
    mode,
    readyToUse: !criticalFailure,
    failedStages: unique,
    message
  });
}

function inferGenerationFromAudit(audit: EvidenceAudit, stored?: unknown) {
  if (stored) {
    const parsed = ApplicationPackageGenerationSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
  }
  const failed: ApplicationPackageGeneration["failedStages"] = [];
  const warnings = audit.warnings.join("\n").toLowerCase();
  if (warnings.includes("ai resume selection could not complete")) failed.push("resume");
  if (warnings.includes("ai cover-letter drafting could not complete")) failed.push("cover-letter");
  if (warnings.includes("ai screening-answer drafting could not complete")) failed.push("screening");
  if (warnings.includes("semantic evidence audit could not complete")) failed.push("audit");
  return packageGenerationFromFailures(failed);
}

export function approveLatestDegradedApplicationPackage(jobId: number): ApplicationPackage {
  const row = db.prepare(`SELECT id, payload_json AS payloadJson, audit_json AS auditJson FROM application_packages WHERE job_id = ? ORDER BY id DESC LIMIT 1`)
    .get(jobId) as { id: number; payloadJson: string; auditJson: string } | undefined;
  if (!row) throw new Error("Generate an application package before approving a fallback.");

  const payload = JSON.parse(row.payloadJson) as {
    tailoredCv: TailoredCv;
    coverLetter: CoverLetter;
    screeningAnswers: ScreeningAnswer[];
    generation?: unknown;
  };
  const audit = EvidenceAuditSchema.parse(JSON.parse(row.auditJson));
  const generation = inferGenerationFromAudit(audit, payload.generation);

  if (generation.readyToUse) {
    const existing = getLatestApplicationPackage(jobId);
    if (!existing) throw new Error("Application package could not be reloaded.");
    return existing;
  }

  if (audit.flaggedClaims.length > 0) {
    throw new Error("This fallback still contains unsupported factual claims. Regenerate it before using the application assistant.");
  }

  const approvedGeneration = ApplicationPackageGenerationSchema.parse({
    ...generation,
    readyToUse: true,
    message: "You explicitly reviewed this evidence-grounded fallback. ApplyLite may use its CV and cover letter in the application assistant, but every field and document still requires your review before final submission."
  });
  payload.generation = approvedGeneration;
  db.prepare("UPDATE application_packages SET payload_json = ? WHERE id = ?")
    .run(JSON.stringify(payload), row.id);

  const application = db.prepare("SELECT id, state FROM applications WHERE job_id = ? ORDER BY id DESC LIMIT 1")
    .get(jobId) as { id: number; state: string } | undefined;
  if (application && !["SUBMITTED", "REJECTED_BY_USER", "EXPIRED"].includes(application.state)) {
    db.prepare("UPDATE applications SET state = 'REVIEW_REQUIRED', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(application.id);
    db.prepare("INSERT INTO application_events (application_id, from_state, to_state, note) VALUES (?, ?, 'REVIEW_REQUIRED', ?)")
      .run(application.id, application.state, `User explicitly approved reviewed fallback package ${row.id} for the application assistant`);
  }

  const approved = getLatestApplicationPackage(jobId);
  if (!approved) throw new Error("Application package could not be reloaded after approval.");
  return approved;
}

export function getLatestApplicationPackage(jobId: number): ApplicationPackage | null {
  const row = db.prepare(`SELECT id, job_id AS jobId, status, payload_json AS payloadJson, audit_json AS auditJson, created_at AS createdAt FROM application_packages WHERE job_id = ? ORDER BY id DESC LIMIT 1`)
    .get(jobId) as { id: number; jobId: number; status: "PASS" | "REVIEW"; payloadJson: string; auditJson: string; createdAt: string } | undefined;
  if (!row) return null;
  const payload = JSON.parse(row.payloadJson) as { tailoredCv: TailoredCv; coverLetter: CoverLetter; screeningAnswers: ScreeningAnswer[]; generation?: unknown; aiDetection?: unknown };
  const audit = EvidenceAuditSchema.parse(JSON.parse(row.auditJson));
  const generation = inferGenerationFromAudit(audit, payload.generation);
  return ApplicationPackageSchema.parse({
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    tailoredCv: payload.tailoredCv,
    coverLetter: payload.coverLetter,
    screeningAnswers: payload.screeningAnswers,
    generation,
    aiDetection: ApplicationPackageDetectionSchema.parse(payload.aiDetection ?? {}),
    audit,
    artifacts: artifactRows(row.id),
    createdAt: row.createdAt
  });
}


export function saveApplicationPackageDetection(jobId: number, document: "cv" | "coverLetter", detection: unknown): ApplicationPackage {
  const row = db.prepare(`SELECT id, payload_json AS payloadJson FROM application_packages WHERE job_id = ? ORDER BY id DESC LIMIT 1`)
    .get(jobId) as { id: number; payloadJson: string } | undefined;
  if (!row) throw new Error("Generate an application package before running an AI-content check.");

  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
  const current = ApplicationPackageDetectionSchema.parse(payload.aiDetection ?? {});
  const next = ApplicationPackageDetectionSchema.parse({ ...current, [document]: detection });
  payload.aiDetection = next;
  db.prepare("UPDATE application_packages SET payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(JSON.stringify(payload), row.id);

  const updated = getLatestApplicationPackage(jobId);
  if (!updated) throw new Error("Application package could not be reloaded after the AI-content check.");
  return updated;
}

export type DocumentRegenerationOptions = {
  document: "cv" | "coverLetter";
  cvStyle?: "balanced" | "technical" | "impact" | "concise";
  emphasis?: "auto" | "skills" | "experience" | "projects";
  tone?: "professional" | "warm" | "confident" | "direct";
  length?: "short" | "standard";
  flaggedPassages?: string[];
};

function resumeVariationPrompt(
  job: JobInput,
  requirements: JobRequirements,
  evidence: ReturnType<typeof buildEvidence>,
  previous: TailoredCv,
  options: DocumentRegenerationOptions
) {
  const style = options.cvStyle ?? "balanced";
  const emphasis = options.emphasis ?? "auto";
  const flagged = (options.flaggedPassages ?? []).slice(0, 12).join("\n---\n");
  const variation = `
VARIATION REQUEST:
- Create a fresh CV variant. Keep all factual claims evidence-grounded.
- Do not copy the previous summary wording unless necessary for factual accuracy.
- CV style: ${style}.
- Emphasis: ${emphasis === "auto" ? "choose the strongest job-relevant evidence" : emphasis}.
- "technical" favors relevant technical evidence; "impact" favors concrete contribution evidence; "concise" uses fewer, stronger selections; "balanced" mixes skills, experience and projects.
- Employment/project bullet text is still selected verbatim by evidence ID; never rewrite or embellish source bullets.
- Previous summary to vary: ${previous.summary.slice(0, 1200)}
${flagged ? `- External detector highlighted the passages below. Treat that only as a style signal: make the generated summary/headline feel more natural and specific where evidence permits. Never rewrite source employment/project bullets or invent facts just to change a detector score.\nHIGHLIGHTED PASSAGES:\n${flagged}` : ""}
`;
  return resumePlanPrompt(job, requirements, evidence).replace(
    "Return ONLY the resume plan. /no_think",
    `${variation}\nReturn ONLY the resume plan. /no_think`
  );
}

function coverLetterVariationPrompt(
  job: JobInput,
  requirements: JobRequirements,
  evidence: ReturnType<typeof buildEvidence>,
  previous: CoverLetter,
  options: DocumentRegenerationOptions
) {
  const tone = options.tone ?? "professional";
  const length = options.length ?? "standard";
  const previousText = previous.paragraphs.map((paragraph) => paragraph.text).join("\n").slice(0, 2600);
  const flagged = (options.flaggedPassages ?? []).slice(0, 12).join("\n---\n");
  const variation = `
VARIATION REQUEST:
- Write a materially fresh version while keeping every factual statement tied to supplied evidence IDs.
- Tone: ${tone}.
- Length: ${length === "short" ? "short; about 180-230 words total" : "standard; about 250-350 words total"}.
- Avoid reusing distinctive phrasing from the previous version where a truthful alternative exists.
- Do not add new facts merely to make the wording different.
- Previous version to vary:
${previousText}
${flagged ? `- External detector highlighted the passages below. Use them only as a style cue: rewrite them in a more natural, specific voice while preserving exactly the same supported facts. Do not optimize blindly for a detector score and do not add unsupported claims.\nHIGHLIGHTED PASSAGES:\n${flagged}` : ""}
`;
  return coverLetterPrompt(job, requirements, evidence).replace(
    "Return ONLY the cover letter object. /no_think",
    `${variation}\nReturn ONLY the cover letter object. /no_think`
  );
}

async function persistPackageVariant(
  jobId: number,
  profile: Profile,
  candidateName: string,
  job: JobInput,
  requirements: JobRequirements,
  tailoredCv: TailoredCv,
  coverLetter: CoverLetter,
  screeningAnswers: ScreeningAnswer[],
  generation: ApplicationPackageGeneration,
  audit: EvidenceAudit,
  aiDetection: unknown = {}
): Promise<ApplicationPackage> {
  const detection = ApplicationPackageDetectionSchema.parse(aiDetection ?? {});
  const payload = { tailoredCv, coverLetter, screeningAnswers, generation, aiDetection: detection };
  const result = db.prepare(`INSERT INTO application_packages (job_id, status, payload_json, audit_json) VALUES (?, ?, ?, ?)`)
    .run(jobId, audit.status, JSON.stringify(payload), JSON.stringify(audit));
  const packageId = Number(result.lastInsertRowid);

  const slug = `${safeFilename(job.company)}-${safeFilename(job.title)}`;
  const relativeDir = path.join(config.storagePath, "generated", `job-${jobId}`, `package-${packageId}`);
  const absoluteDir = path.resolve(process.cwd(), relativeDir);
  fs.mkdirSync(absoluteDir, { recursive: true });

  const files: Array<{ kind: string; filename: string; content?: string }> = [
    { kind: "tailored_cv_txt", filename: `${slug}-cv.txt`, content: cvText(profile, tailoredCv, candidateName) },
    { kind: "cover_letter_txt", filename: `${slug}-cover-letter.txt`, content: coverLetterText(coverLetter, candidateName) },
    { kind: "screening_answers_txt", filename: `${slug}-screening-answers.txt`, content: screeningText(screeningAnswers) },
    { kind: "evidence_audit_json", filename: `${slug}-evidence-audit.json`, content: JSON.stringify(audit, null, 2) },
    { kind: "package_json", filename: `${slug}-package.json`, content: JSON.stringify({ job, requirements, ...payload, audit }, null, 2) }
  ];
  files.forEach((file) => fs.writeFileSync(path.join(absoluteDir, file.filename), file.content ?? "", "utf8"));

  const cvPdfName = `${slug}-cv.pdf`;
  const coverPdfName = `${slug}-cover-letter.pdf`;
  let finalAudit = audit;
  try {
    await renderPdf(cvHtml(profile, tailoredCv, candidateName), path.join(absoluteDir, cvPdfName));
    await renderPdf(coverLetterHtml(profile, job, coverLetter, candidateName), path.join(absoluteDir, coverPdfName));
    files.unshift({ kind: "tailored_cv_pdf", filename: cvPdfName }, { kind: "cover_letter_pdf", filename: coverPdfName });
  } catch (error) {
    finalAudit = EvidenceAuditSchema.parse({
      ...audit,
      status: "REVIEW",
      warnings: [...audit.warnings, `PDF rendering failed: ${error instanceof Error ? error.message : "unknown error"}. Text artifacts are still available.`]
    });
    db.prepare("UPDATE application_packages SET status = ?, audit_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(finalAudit.status, JSON.stringify(finalAudit), packageId);
    fs.writeFileSync(path.join(absoluteDir, `${slug}-evidence-audit.json`), JSON.stringify(finalAudit, null, 2), "utf8");
  }

  const insertArtifact = db.prepare("INSERT INTO generated_artifacts (job_id, package_id, kind, path, metadata_json) VALUES (?, ?, ?, ?, ?)");
  const tx = db.transaction(() => {
    for (const file of files) {
      const filePath = path.join(relativeDir, file.filename).replaceAll("\\", "/");
      insertArtifact.run(jobId, packageId, file.kind, filePath, JSON.stringify({ filename: file.filename }));
    }
  });
  tx();

  db.prepare(`
    UPDATE application_prep_queue
    SET package_id = ?, audit_status = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE job_id = ? AND status IN ('READY', 'NEEDS_REVIEW')
  `).run(packageId, finalAudit.status, finalAudit.status === "PASS" ? "READY" : "NEEDS_REVIEW", jobId);

  return ApplicationPackageSchema.parse({
    id: packageId,
    jobId,
    status: finalAudit.status,
    tailoredCv,
    coverLetter,
    screeningAnswers,
    generation,
    aiDetection: detection,
    audit: finalAudit,
    artifacts: artifactRows(packageId),
    createdAt: new Date().toISOString()
  });
}

export async function regenerateApplicationDocument(jobId: number, options: DocumentRegenerationOptions): Promise<ApplicationPackage> {
  const previous = getLatestApplicationPackage(jobId);
  if (!previous) throw new Error("Generate an application package before regenerating an individual document.");

  const profile = loadProfile();
  const candidateDocument = loadCandidateDocument();
  const facts = candidateDocument.facts;
  const candidateName = resolveCandidateName(profile, facts, candidateDocument.rawText, candidateDocument.sourceName);
  const { job, requirements } = loadJob(jobId);
  const evidence = buildEvidence(profile, facts, job, requirements);

  await ensureOllamaReady();

  let tailoredCv = previous.tailoredCv;
  let coverLetter = previous.coverLetter;
  let clearedStage: ApplicationPackageGeneration["failedStages"][number];

  if (options.document === "cv") {
    const raw = await askOllamaStructured<unknown>(
      resumeVariationPrompt(job, requirements, evidence, previous.tailoredCv, options),
      z.toJSONSchema(ResumePlanSchema),
      { numPredict: 1500, numCtx: 8192, timeoutMs: 120_000 }
    );
    tailoredCv = hydrateResume(ResumePlanSchema.parse(raw), job, profile, facts, evidence.all);
    clearedStage = "resume";
  } else {
    const raw = await askOllamaStructured<unknown>(
      coverLetterVariationPrompt(job, requirements, evidence, previous.coverLetter, options),
      z.toJSONSchema(CoverLetterSchema),
      { numPredict: 1000, numCtx: 8192, timeoutMs: 90_000 }
    );
    coverLetter = CoverLetterSchema.parse(raw);
    clearedStage = "cover-letter";
  }

  const audit = await auditGeneratedClaims(claimsForAudit(tailoredCv, coverLetter, previous.screeningAnswers), evidence.all);
  const failedStages = previous.generation.failedStages.filter((stage) => stage !== clearedStage && stage !== "audit");
  if (audit.warnings.some((warning) => warning.startsWith("Semantic evidence audit could not complete:"))) failedStages.push("audit");
  const generation = packageGenerationFromFailures(failedStages);

  const preservedDetection = options.document === "cv"
    ? { coverLetter: previous.aiDetection.coverLetter }
    : { cv: previous.aiDetection.cv };

  return persistPackageVariant(
    jobId,
    profile,
    candidateName,
    job,
    requirements,
    tailoredCv,
    coverLetter,
    previous.screeningAnswers,
    generation,
    audit,
    preservedDetection
  );
}

export async function generateApplicationPackage(jobId: number): Promise<ApplicationPackage> {
  const profile = loadProfile();
  const candidateDocument = loadCandidateDocument();
  const facts = candidateDocument.facts;
  const candidateName = resolveCandidateName(profile, facts, candidateDocument.rawText, candidateDocument.sourceName);
  const { job, requirements } = loadJob(jobId);
  const evidence = buildEvidence(profile, facts, job, requirements);

  // Do not silently create another degraded package when the local model is simply offline.
  // For the default local Ollama setup this also attempts to start `ollama serve` once.
  await ensureOllamaReady();

  const generationWarnings: string[] = [];
  const failedStages: ApplicationPackageGeneration["failedStages"] = [];

  let resumePlan: z.infer<typeof ResumePlanSchema>;
  try {
    const raw = await askOllamaStructured<unknown>(resumePlanPrompt(job, requirements, evidence), z.toJSONSchema(ResumePlanSchema), { numPredict: 1500, numCtx: 8192, timeoutMs: 120_000 });
    resumePlan = ResumePlanSchema.parse(raw);
  } catch (error) {
    failedStages.push("resume");
    resumePlan = fallbackResumePlan(job, requirements, profile, facts, evidence);
    generationWarnings.push(`AI resume selection could not complete: ${error instanceof Error ? error.message : "unknown error"}. ApplyLite used a job-targeted deterministic CV fallback.`);
  }
  const tailoredCv = hydrateResume(resumePlan, job, profile, facts, evidence.all);

  let coverLetter: CoverLetter;
  try {
    const raw = await askOllamaStructured<unknown>(coverLetterPrompt(job, requirements, evidence), z.toJSONSchema(CoverLetterSchema), { numPredict: 900, numCtx: 8192, timeoutMs: 90_000 });
    coverLetter = CoverLetterSchema.parse(raw);
  } catch (error) {
    failedStages.push("cover-letter");
    coverLetter = fallbackCoverLetter(job, requirements, evidence);
    generationWarnings.push(`AI cover-letter drafting could not complete: ${error instanceof Error ? error.message : "unknown error"}. ApplyLite used a job-specific evidence-grounded fallback letter.`);
  }

  let generatedAnswers: ScreeningAnswer[] = [];
  try {
    const raw = await askOllamaStructured<unknown>(screeningPrompt(job, requirements, evidence), z.toJSONSchema(ScreeningDraftSchema), { numPredict: 900, numCtx: 6144, timeoutMs: 75_000 });
    const draft = ScreeningDraftSchema.parse(raw);
    generatedAnswers = draft.screeningAnswers.map((item) => ScreeningAnswerSchema.parse({ ...item, source: "generated", needsReview: true }));
  } catch (error) {
    failedStages.push("screening");
    generationWarnings.push(`AI screening-answer drafting could not complete: ${error instanceof Error ? error.message : "unknown error"}. Saved Answer Library responses are still included.`);
  }
  const screeningAnswers = addAnswerLibraryDrafts(generatedAnswers, evidence.answers);

  let audit = await auditGeneratedClaims(claimsForAudit(tailoredCv, coverLetter, screeningAnswers), evidence.all);
  if (audit.warnings.some((warning) => warning.startsWith("Semantic evidence audit could not complete:"))) failedStages.push("audit");
  const generation = packageGenerationFromFailures(failedStages);
  if (generationWarnings.length || !generation.readyToUse) {
    audit = EvidenceAuditSchema.parse({
      ...audit,
      status: "REVIEW",
      warnings: [...audit.warnings, ...generationWarnings]
    });
  }

  const initialPayload = { tailoredCv, coverLetter, screeningAnswers, generation, aiDetection: {} };
  const result = db.prepare(`INSERT INTO application_packages (job_id, status, payload_json, audit_json) VALUES (?, ?, ?, ?)`)
    .run(jobId, audit.status, JSON.stringify(initialPayload), JSON.stringify(audit));
  const packageId = Number(result.lastInsertRowid);

  const slug = `${safeFilename(job.company)}-${safeFilename(job.title)}`;
  const relativeDir = path.join(config.storagePath, "generated", `job-${jobId}`, `package-${packageId}`);
  const absoluteDir = path.resolve(process.cwd(), relativeDir);
  fs.mkdirSync(absoluteDir, { recursive: true });

  const files: Array<{ kind: string; filename: string; content?: string }> = [
    { kind: "tailored_cv_txt", filename: `${slug}-cv.txt`, content: cvText(profile, tailoredCv, candidateName) },
    { kind: "cover_letter_txt", filename: `${slug}-cover-letter.txt`, content: coverLetterText(coverLetter, candidateName) },
    { kind: "screening_answers_txt", filename: `${slug}-screening-answers.txt`, content: screeningText(screeningAnswers) },
    { kind: "evidence_audit_json", filename: `${slug}-evidence-audit.json`, content: JSON.stringify(audit, null, 2) },
    { kind: "package_json", filename: `${slug}-package.json`, content: JSON.stringify({ job, requirements, ...initialPayload, audit }, null, 2) }
  ];
  files.forEach((file) => fs.writeFileSync(path.join(absoluteDir, file.filename), file.content ?? "", "utf8"));

  const cvPdfName = `${slug}-cv.pdf`;
  const coverPdfName = `${slug}-cover-letter.pdf`;
  try {
    await renderPdf(cvHtml(profile, tailoredCv, candidateName), path.join(absoluteDir, cvPdfName));
    await renderPdf(coverLetterHtml(profile, job, coverLetter, candidateName), path.join(absoluteDir, coverPdfName));
    files.unshift({ kind: "tailored_cv_pdf", filename: cvPdfName }, { kind: "cover_letter_pdf", filename: coverPdfName });
  } catch (error) {
    audit = EvidenceAuditSchema.parse({
      ...audit,
      status: "REVIEW",
      warnings: [...audit.warnings, `PDF rendering failed: ${error instanceof Error ? error.message : "unknown error"}. Text artifacts are still available.`]
    });
    db.prepare("UPDATE application_packages SET status = ?, audit_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(audit.status, JSON.stringify(audit), packageId);
    fs.writeFileSync(path.join(absoluteDir, `${slug}-evidence-audit.json`), JSON.stringify(audit, null, 2), "utf8");
  }

  const insertArtifact = db.prepare("INSERT INTO generated_artifacts (job_id, package_id, kind, path, metadata_json) VALUES (?, ?, ?, ?, ?)");
  const tx = db.transaction(() => {
    for (const file of files) {
      const filePath = path.join(relativeDir, file.filename).replaceAll("\\", "/");
      insertArtifact.run(jobId, packageId, file.kind, filePath, JSON.stringify({ filename: file.filename }));
    }
  });
  tx();

  return ApplicationPackageSchema.parse({
    id: packageId,
    jobId,
    status: audit.status,
    tailoredCv,
    coverLetter,
    screeningAnswers,
    generation,
    aiDetection: {},
    audit,
    artifacts: artifactRows(packageId),
    createdAt: new Date().toISOString()
  });
}
