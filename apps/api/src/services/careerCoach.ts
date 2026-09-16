import { z } from "zod";
import {
  ApplicationOutcomeSchema,
  CandidateFactsSchema,
  CareerCoachOverviewSchema,
  FollowUpDraftSchema,
  InterviewPrepPackSchema,
  JobRequirementsSchema,
  MockInterviewFeedbackSchema,
  ProfileSchema,
  type CandidateFacts,
  type CareerCoachApplication,
  type CareerCoachOverview,
  type FollowUpDraft,
  type InterviewEvidence,
  type InterviewPrepPack,
  type JobRequirements,
  type MockInterviewFeedback,
  type MockInterviewTurn,
  type Profile
} from "@apply-lite/shared";
import { db } from "../db/database.js";
import { askOllamaStructured } from "./ollama.js";

const FOLLOW_UP_AFTER_DAYS = 5;

type EvidenceItem = InterviewEvidence & { kind: string };

type ApplicationContext = {
  applicationId: number;
  jobId: number;
  outcome: string;
  state: string;
  submittedAt: string | null;
  outcomeAt: string | null;
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  description: string;
  requirements: JobRequirements;
  profile: Profile;
  facts: CandidateFacts;
};

const InterviewPlanSchema = z.object({
  roleFocus: z.array(z.object({ topic: z.string(), why: z.string() })).max(8).default([]),
  questions: z.array(z.object({
    category: z.enum(["behavioral", "technical", "role", "candidate", "motivation"]),
    question: z.string(),
    whyAsked: z.string(),
    guidance: z.string(),
    difficulty: z.enum(["warmup", "core", "stretch"]),
    evidenceIds: z.array(z.string()).max(6).default([])
  })).max(12).default([]),
  stories: z.array(z.object({
    title: z.string(),
    prompt: z.string(),
    evidenceIds: z.array(z.string()).max(8).default([])
  })).max(6).default([]),
  refreshTopics: z.array(z.object({
    skill: z.string(),
    reason: z.string(),
    priority: z.enum(["high", "medium", "low"])
  })).max(8).default([]),
  questionsToAsk: z.array(z.string()).max(8).default([])
});

type RawCoachRow = {
  application_id: number;
  job_id: number;
  outcome: string;
  state: string;
  title: string;
  company: string;
  location: string;
  source_url: string;
  submitted_at: string | null;
  outcome_at: string | null;
  next_action: string;
  next_action_at: string | null;
  pack_generated_at: string | null;
  mock_turn_count: number;
};

function parseSqliteDate(value: string | null): number | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
}

function daysSince(value: string | null) {
  const time = parseSqliteDate(value);
  if (time == null) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function normalizeOutcome(value: string) {
  const parsed = ApplicationOutcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : "ACTIVE" as const;
}

function toCoachApplication(row: RawCoachRow): CareerCoachApplication {
  return {
    applicationId: row.application_id,
    jobId: row.job_id,
    outcome: normalizeOutcome(row.outcome),
    state: row.state,
    title: row.title,
    company: row.company,
    location: row.location,
    sourceUrl: row.source_url,
    submittedAt: row.submitted_at,
    outcomeAt: row.outcome_at,
    nextAction: row.next_action,
    nextActionAt: row.next_action_at,
    daysWaiting: daysSince(row.submitted_at),
    packGeneratedAt: row.pack_generated_at,
    mockTurnCount: Number(row.mock_turn_count ?? 0)
  };
}

function queryCoachRows(): RawCoachRow[] {
  return db.prepare(`
    SELECT a.id AS application_id, a.job_id, a.outcome, a.state,
           a.submitted_at, a.outcome_at, a.next_action, a.next_action_at,
           j.title, j.company, j.location, j.source_url,
           ip.updated_at AS pack_generated_at,
           (SELECT COUNT(*) FROM mock_interview_turns mit WHERE mit.application_id = a.id) AS mock_turn_count
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    LEFT JOIN interview_packs ip ON ip.application_id = a.id
    WHERE a.submitted_at IS NOT NULL OR a.state = 'SUBMITTED'
    ORDER BY COALESCE(a.outcome_at, a.submitted_at, a.updated_at) DESC, a.id DESC
  `).all() as RawCoachRow[];
}

export function buildCareerCoachOverview(): CareerCoachOverview {
  const all = queryCoachRows().map(toCoachApplication);
  const interviews = all.filter((item) => item.outcome === "INTERVIEW");
  const employerReplyRows = db.prepare(`
    SELECT DISTINCT gm.application_id AS applicationId
    FROM gmail_messages gm
    JOIN applications a ON a.id = gm.application_id
    WHERE gm.application_id IS NOT NULL
      AND gm.classification IN ('INTERVIEW','ASSESSMENT','OFFER','REJECTION','RECRUITER_REPLY')
      AND gm.action_status != 'IGNORED'
      AND gm.classification_confidence >= 0.70
      AND (a.submitted_at IS NULL OR datetime(gm.received_at) >= datetime(a.submitted_at))
  `).all() as Array<{ applicationId: number }>;
  const employerReplyIds = new Set(employerReplyRows.map((row) => row.applicationId));
  const waitingFollowUps = all.filter((item) => item.outcome === "WAITING" && item.daysWaiting >= FOLLOW_UP_AFTER_DAYS && !employerReplyIds.has(item.applicationId));
  const prepPacks = (db.prepare("SELECT COUNT(*) AS count FROM interview_packs").get() as { count: number }).count;
  const mockTurns = (db.prepare("SELECT COUNT(*) AS count FROM mock_interview_turns").get() as { count: number }).count;
  return CareerCoachOverviewSchema.parse({
    interviews,
    waitingFollowUps,
    counts: {
      interviews: interviews.length,
      followUpsDue: waitingFollowUps.length,
      prepPacks,
      mockTurns
    },
    followUpAfterDays: FOLLOW_UP_AFTER_DAYS,
    generatedAt: new Date().toISOString()
  });
}

function loadProfile(): Profile {
  const row = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
  return row ? ProfileSchema.parse(JSON.parse(row.data_json)) : ProfileSchema.parse({});
}

function loadFacts(): CandidateFacts {
  const row = db.prepare("SELECT facts_json FROM cv_documents ORDER BY id DESC LIMIT 1").get() as { facts_json: string } | undefined;
  if (!row) throw new Error("Upload and extract a CV before generating interview preparation.");
  return CandidateFactsSchema.parse(JSON.parse(row.facts_json));
}

function loadApplicationContext(applicationId: number): ApplicationContext {
  const row = db.prepare(`
    SELECT a.id AS applicationId, a.job_id AS jobId, a.outcome, a.state,
           a.submitted_at AS submittedAt, a.outcome_at AS outcomeAt,
           j.title, j.company, j.location, j.source_url AS sourceUrl,
           j.description, j.analysis_json AS analysisJson
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.id = ?
  `).get(applicationId) as {
    applicationId: number;
    jobId: number;
    outcome: string;
    state: string;
    submittedAt: string | null;
    outcomeAt: string | null;
    title: string;
    company: string;
    location: string;
    sourceUrl: string;
    description: string;
    analysisJson: string;
  } | undefined;
  if (!row) throw new Error("Application not found.");
  if (!row.submittedAt && row.state !== "SUBMITTED") throw new Error("Interview preparation is available after an application has been submitted.");
  let requirements: JobRequirements;
  try { requirements = JobRequirementsSchema.parse(JSON.parse(row.analysisJson || "{}")); }
  catch { requirements = JobRequirementsSchema.parse({}); }
  return { ...row, requirements, profile: loadProfile(), facts: loadFacts() };
}

function addEvidence(target: EvidenceItem[], item: EvidenceItem) {
  const text = item.text.trim();
  if (text) target.push({ ...item, text });
}

function buildEvidence(context: ApplicationContext) {
  const candidate: EvidenceItem[] = [];
  const job: EvidenceItem[] = [];
  const { facts, profile, requirements } = context;

  addEvidence(candidate, { id: "cv:headline", scope: "candidate", kind: "headline", label: "Candidate headline", text: facts.headline || profile.currentTitle });
  addEvidence(candidate, { id: "cv:summary", scope: "candidate", kind: "summary", label: "Candidate summary", text: facts.summary || profile.summary });
  facts.skills.forEach((skill, index) => addEvidence(candidate, { id: `cv:skill:${index}`, scope: "candidate", kind: "skill", label: "Skill", text: skill }));
  facts.employment.forEach((entry, index) => {
    addEvidence(candidate, {
      id: `cv:employment:${index}:meta`, scope: "candidate", kind: "employment-meta", label: "Employment",
      text: `${entry.title} at ${entry.employer}${entry.startDate || entry.endDate ? ` (${entry.startDate || "?"} - ${entry.endDate || "?"})` : ""}${entry.location ? `, ${entry.location}` : ""}`
    });
    entry.bullets.forEach((bullet, childIndex) => addEvidence(candidate, {
      id: `cv:employment:${index}:bullet:${childIndex}`, scope: "candidate", kind: "employment-bullet", label: `${entry.title} evidence`, text: bullet
    }));
  });
  facts.projects.forEach((entry, index) => {
    addEvidence(candidate, { id: `cv:project:${index}:meta`, scope: "candidate", kind: "project-meta", label: `Project: ${entry.name}`, text: `${entry.name}: ${entry.description}` });
    entry.bullets.forEach((bullet, childIndex) => addEvidence(candidate, {
      id: `cv:project:${index}:bullet:${childIndex}`, scope: "candidate", kind: "project-bullet", label: `${entry.name} evidence`, text: bullet
    }));
  });
  facts.education.forEach((entry, index) => addEvidence(candidate, {
    id: `cv:education:${index}`, scope: "candidate", kind: "education", label: "Education",
    text: `${entry.qualification}${entry.field ? ` in ${entry.field}` : ""} - ${entry.institution}`
  }));
  facts.certifications.forEach((item, index) => addEvidence(candidate, { id: `cv:certification:${index}`, scope: "candidate", kind: "certification", label: "Certification", text: item }));
  facts.languages.forEach((item, index) => addEvidence(candidate, { id: `cv:language:${index}`, scope: "candidate", kind: "language", label: "Language", text: item }));

  addEvidence(job, { id: "job:meta", scope: "job", kind: "job", label: "Target job", text: `${context.title} at ${context.company}${context.location ? `, ${context.location}` : ""}` });
  addEvidence(job, { id: "job:summary", scope: "job", kind: "job", label: "Role summary", text: requirements.summary || context.description.slice(0, 1200) });
  requirements.requiredSkills.forEach((skill, index) => addEvidence(job, { id: `job:required-skill:${index}`, scope: "job", kind: "required-skill", label: "Required skill", text: skill }));
  requirements.preferredSkills.forEach((skill, index) => addEvidence(job, { id: `job:preferred-skill:${index}`, scope: "job", kind: "preferred-skill", label: "Preferred skill", text: skill }));
  requirements.responsibilities.slice(0, 12).forEach((item, index) => addEvidence(job, { id: `job:responsibility:${index}`, scope: "job", kind: "responsibility", label: "Responsibility", text: item }));

  return { candidate, job, all: [...candidate, ...job] };
}

function evidencePrompt(items: EvidenceItem[]) {
  return items.map((item) => `[${item.id}] (${item.scope}/${item.kind}) ${item.label}: ${item.text}`).join("\n");
}

function normalizeSkill(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

function fallbackPlan(context: ApplicationContext, evidence: ReturnType<typeof buildEvidence>): z.infer<typeof InterviewPlanSchema> {
  const candidateTop = evidence.candidate.filter((item) => item.kind.includes("bullet") || item.kind.includes("meta")).slice(0, 5).map((item) => item.id);
  const candidateSkills = new Set(context.facts.skills.map(normalizeSkill));
  const required = context.requirements.requiredSkills.slice(0, 6);
  const questions: z.infer<typeof InterviewPlanSchema>["questions"] = [
    {
      category: "motivation",
      question: `What interests you about the ${context.title} role at ${context.company}?`,
      whyAsked: "Tests motivation and whether the candidate can connect their goals to the role.",
      guidance: "Connect your interest to the responsibilities in the posting and keep the answer specific to the role.",
      difficulty: "warmup",
      evidenceIds: ["job:meta", "job:summary"]
    },
    {
      category: "candidate",
      question: "Walk me through the experience from your background that is most relevant to this role.",
      whyAsked: "Tests prioritization and relevance of previous experience.",
      guidance: "Choose one or two pieces of evidence and explain what you did, why it mattered, and what you learned.",
      difficulty: "core",
      evidenceIds: candidateTop
    }
  ];
  required.slice(0, 4).forEach((skill, index) => {
    const skillEvidence = evidence.candidate.find((item) => item.kind === "skill" && normalizeSkill(item.text) === normalizeSkill(skill));
    questions.push({
      category: "technical",
      question: skillEvidence ? `How have you used ${skill} in practice?` : `How would you approach a task that requires ${skill}?`,
      whyAsked: `The role lists ${skill} as a required skill.`,
      guidance: skillEvidence ? "Use a concrete example from your verified experience and explain decisions and trade-offs." : "Be explicit about what you know, what you would verify, and how you would close any knowledge gap.",
      difficulty: index < 2 ? "core" : "stretch",
      evidenceIds: skillEvidence ? [skillEvidence.id, `job:required-skill:${index}`] : [`job:required-skill:${index}`]
    });
  });
  questions.push({
    category: "behavioral",
    question: "Tell me about a difficult project or problem and how you handled it.",
    whyAsked: "Tests problem solving, ownership, communication and reflection.",
    guidance: "Use STAR: situation, task, action, result. Keep the action section focused on what you personally did.",
    difficulty: "core",
    evidenceIds: candidateTop
  });
  const storyEvidence = evidence.candidate.filter((item) => item.kind === "employment-bullet" || item.kind === "project-bullet").slice(0, 12);
  const stories = [] as z.infer<typeof InterviewPlanSchema>["stories"];
  for (let i = 0; i < storyEvidence.length; i += 3) {
    const group = storyEvidence.slice(i, i + 3);
    if (!group.length) continue;
    stories.push({
      title: `Verified story anchor ${stories.length + 1}`,
      prompt: "Turn these verified facts into a STAR answer without adding facts that are not present in the evidence.",
      evidenceIds: group.map((item) => item.id)
    });
    if (stories.length >= 4) break;
  }
  const refreshTopics = required.filter((skill) => !candidateSkills.has(normalizeSkill(skill))).map((skill, index) => ({
    skill,
    reason: "Required by the target role but not explicitly present in the current CV skill evidence.",
    priority: index < 3 ? "high" as const : "medium" as const
  }));
  return InterviewPlanSchema.parse({
    roleFocus: required.map((skill) => ({ topic: skill, why: "Explicitly required by the target role." })),
    questions,
    stories,
    refreshTopics,
    questionsToAsk: [
      `What would strong performance in the ${context.title} role look like in the first 90 days?`,
      "What are the biggest technical or delivery challenges the team is working through right now?",
      "How does the team review technical decisions and share knowledge?",
      "What are the next steps in the interview process?"
    ]
  });
}

async function generatePlan(context: ApplicationContext, evidence: ReturnType<typeof buildEvidence>) {
  const prompt = `Create an interview preparation plan for one candidate and one job.\n\nNON-NEGOTIABLE RULES:\n- Candidate facts may be based ONLY on candidate evidence IDs below.\n- Job facts may be based ONLY on job evidence IDs below.\n- Never invent projects, technologies, dates, metrics, employers, responsibilities, qualifications, achievements, or personal details.\n- Questions can test concepts that are not in the candidate evidence, but do not imply the candidate has used them.\n- evidenceIds on candidate/story questions must point to supplied evidence.\n- STAR stories are only anchors: select evidence IDs and give coaching prompts, not fabricated finished stories.\n- guidance must be coaching strategy, not a made-up candidate answer.\n- refreshTopics should focus on explicit job requirements that deserve review.\n- questionsToAsk should be useful, professional questions for the interviewer.\n\nTARGET ROLE:\n${context.title} at ${context.company}\nLocation: ${context.location || "not specified"}\nSummary: ${context.requirements.summary || context.description.slice(0, 1000)}\nRequired skills: ${context.requirements.requiredSkills.join(", ") || "not explicitly extracted"}\nPreferred skills: ${context.requirements.preferredSkills.join(", ") || "not explicitly extracted"}\nResponsibilities: ${context.requirements.responsibilities.slice(0, 8).join(" | ") || "not explicitly extracted"}\n\nVERIFIED EVIDENCE:\n${evidencePrompt(evidence.all).slice(0, 18_000)}\n\nCreate 7-10 likely questions, 3-5 story anchors, concise role focus, refresh topics, and 4-6 questions to ask. /no_think`;
  try {
    const raw = await askOllamaStructured<unknown>(prompt, z.toJSONSchema(InterviewPlanSchema), { numPredict: 2200, numCtx: 8192, timeoutMs: 120_000 });
    return InterviewPlanSchema.parse(raw);
  } catch {
    return fallbackPlan(context, evidence);
  }
}

function hydrateEvidence(ids: string[], evidence: EvidenceItem[], scope?: "candidate" | "job"): InterviewEvidence[] {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    const item = byId.get(id);
    if (!item || (scope && item.scope !== scope) || seen.has(id)) return [];
    seen.add(id);
    return [{ id: item.id, scope: item.scope, label: item.label, text: item.text }];
  });
}

export async function generateInterviewPack(applicationId: number): Promise<InterviewPrepPack> {
  const context = loadApplicationContext(applicationId);
  const evidence = buildEvidence(context);
  const plan = await generatePlan(context, evidence);
  const generatedAt = new Date().toISOString();
  const pack = InterviewPrepPackSchema.parse({
    applicationId,
    jobId: context.jobId,
    title: context.title,
    company: context.company,
    location: context.location,
    roleSummary: context.requirements.summary || context.description.slice(0, 900),
    roleFocus: plan.roleFocus,
    questions: plan.questions.map((item, index) => ({
      id: `q-${index + 1}`,
      category: item.category,
      question: item.question,
      whyAsked: item.whyAsked,
      guidance: item.guidance,
      difficulty: item.difficulty,
      evidence: hydrateEvidence(item.evidenceIds, evidence.all)
    })),
    stories: plan.stories.map((item, index) => ({
      id: `story-${index + 1}`,
      title: item.title,
      prompt: item.prompt,
      evidence: hydrateEvidence(item.evidenceIds, evidence.candidate, "candidate")
    })),
    refreshTopics: plan.refreshTopics,
    questionsToAsk: plan.questionsToAsk,
    generatedAt
  });
  db.prepare(`
    INSERT INTO interview_packs (application_id, payload_json, created_at, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(application_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP
  `).run(applicationId, JSON.stringify(pack));
  return pack;
}

export function getInterviewPack(applicationId: number): InterviewPrepPack | null {
  const row = db.prepare("SELECT payload_json FROM interview_packs WHERE application_id = ?").get(applicationId) as { payload_json: string } | undefined;
  if (!row) return null;
  try { return InterviewPrepPackSchema.parse(JSON.parse(row.payload_json)); }
  catch { return null; }
}

export function listMockInterviewTurns(applicationId: number): MockInterviewTurn[] {
  const rows = db.prepare(`
    SELECT id, application_id AS applicationId, question_id AS questionId, question, answer,
           feedback_json AS feedbackJson, created_at AS createdAt
    FROM mock_interview_turns
    WHERE application_id = ?
    ORDER BY id DESC
  `).all(applicationId) as Array<{ id: number; applicationId: number; questionId: string; question: string; answer: string; feedbackJson: string; createdAt: string }>;
  return rows.flatMap((row) => {
    try {
      return [{
        id: row.id,
        applicationId: row.applicationId,
        questionId: row.questionId,
        question: row.question,
        answer: row.answer,
        feedback: MockInterviewFeedbackSchema.parse(JSON.parse(row.feedbackJson)),
        createdAt: row.createdAt
      }];
    } catch { return []; }
  });
}

export async function scoreMockInterviewAnswer(applicationId: number, questionId: string, answer: string): Promise<MockInterviewTurn> {
  const pack = getInterviewPack(applicationId);
  if (!pack) throw new Error("Generate the interview prep pack before starting mock practice.");
  const question = pack.questions.find((item) => item.id === questionId);
  if (!question) throw new Error("Interview question not found in the current prep pack.");
  const context = loadApplicationContext(applicationId);
  const evidence = buildEvidence(context);
  const feedbackPrompt = `Act as a strict but constructive interview coach. Evaluate the candidate answer against the target role and VERIFIED candidate evidence.\n\nRULES:\n- Do not assume a claim is true unless it is supported by the verified evidence below.\n- unsupportedClaims should contain short snippets or concise descriptions of claims in the answer that are not supported by the supplied candidate evidence.\n- Do not penalize opinions, intentions, explanations of approach, or general technical knowledge merely because they are not CV facts.\n- Score structure, relevance, use of evidence, and clarity from 0-100.\n- Give practical improvements.\n- suggestedStructure should describe how to improve the answer; do not invent a replacement story.\n\nROLE: ${context.title} at ${context.company}\nQUESTION: ${question.question}\nWHY ASKED: ${question.whyAsked}\nANSWER:\n${answer.slice(0, 6000)}\n\nVERIFIED CANDIDATE EVIDENCE:\n${evidencePrompt(evidence.candidate).slice(0, 15_000)}\n\nReturn only the feedback object. /no_think`;
  const raw = await askOllamaStructured<unknown>(feedbackPrompt, z.toJSONSchema(MockInterviewFeedbackSchema), { numPredict: 1200, numCtx: 8192, timeoutMs: 90_000 });
  const feedback: MockInterviewFeedback = MockInterviewFeedbackSchema.parse(raw);
  const info = db.prepare(`
    INSERT INTO mock_interview_turns (application_id, question_id, question, answer, feedback_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(applicationId, questionId, question.question, answer.trim(), JSON.stringify(feedback));
  return {
    id: Number(info.lastInsertRowid),
    applicationId,
    questionId,
    question: question.question,
    answer: answer.trim(),
    feedback,
    createdAt: new Date().toISOString()
  };
}

function candidateName(profile: Profile, facts: CandidateFacts) {
  return [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || facts.fullName.trim();
}

function readableDate(value: string | null) {
  const time = parseSqliteDate(value);
  if (time == null) return "recently";
  return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Dublin" }).format(new Date(time));
}

export function createFollowUpDraft(applicationId: number, kind: "follow_up" | "thank_you"): FollowUpDraft {
  const context = loadApplicationContext(applicationId);
  const name = candidateName(context.profile, context.facts);
  const signoff = name ? `Kind regards,\n${name}` : "Kind regards,";
  const subject = kind === "follow_up"
    ? `Following up - ${context.title}`
    : `Thank you - ${context.title} interview`;
  const body = kind === "follow_up"
    ? `Dear Hiring Team,\n\nI wanted to follow up on my application for the ${context.title} position at ${context.company}, submitted ${readableDate(context.submittedAt)}. I remain very interested in the opportunity and would be grateful for any update you can share on the hiring process.\n\nPlease let me know if I can provide any additional information.\n\n${signoff}`
    : `Dear Hiring Team,\n\nThank you for taking the time to speak with me about the ${context.title} position at ${context.company}. I appreciated the opportunity to discuss the role and remain very interested in the position.\n\nPlease let me know if I can provide any additional information as the process continues.\n\n${signoff}`;
  db.prepare(`
    INSERT INTO followup_drafts (application_id, kind, subject, body, created_at, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(application_id, kind) DO UPDATE SET subject = excluded.subject, body = excluded.body, updated_at = CURRENT_TIMESTAMP
  `).run(applicationId, kind, subject, body);
  const row = db.prepare(`
    SELECT id, application_id AS applicationId, kind, subject, body, created_at AS createdAt, updated_at AS updatedAt
    FROM followup_drafts WHERE application_id = ? AND kind = ?
  `).get(applicationId, kind);
  return FollowUpDraftSchema.parse(row);
}

export function listFollowUpDrafts(applicationId: number): FollowUpDraft[] {
  const rows = db.prepare(`
    SELECT id, application_id AS applicationId, kind, subject, body, created_at AS createdAt, updated_at AS updatedAt
    FROM followup_drafts WHERE application_id = ? ORDER BY updated_at DESC
  `).all(applicationId);
  return z.array(FollowUpDraftSchema).parse(rows);
}
