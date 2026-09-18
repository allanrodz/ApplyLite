import { z } from "zod";

export const ApplicationStateSchema = z.enum([
  "DISCOVERED",
  "SCORED",
  "APPROVED",
  "TAILORING",
  "READY",
  "FILLING",
  "REVIEW_REQUIRED",
  "SUBMITTING",
  "SUBMITTED",
  "NEEDS_INPUT",
  "UNSUPPORTED",
  "FAILED",
  "REJECTED_BY_USER",
  "EXPIRED"
]);

export type ApplicationState = z.infer<typeof ApplicationStateSchema>;

export const ProfileSchema = z.object({
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  city: z.string().default(""),
  country: z.string().default(""),
  linkedinUrl: z.string().default(""),
  githubUrl: z.string().default(""),
  portfolioUrl: z.string().default(""),
  googleScholarUrl: z.string().default(""),
  xUrl: z.string().default(""),
  currentTitle: z.string().default(""),
  targetTitles: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  excludedSkills: z.array(z.string()).default([]),
  yearsExperience: z.number().min(0).default(0),
  preferredLocations: z.array(z.string()).default([]),
  remotePreference: z.enum(["any", "remote", "hybrid", "onsite"]).default("any"),
  minimumSalary: z.number().min(0).nullable().default(null),
  workAuthorization: z.string().default(""),
  summary: z.string().default("")
});

export type Profile = z.infer<typeof ProfileSchema>;

export const EmploymentFactSchema = z.object({
  employer: z.string().default(""),
  title: z.string().default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""),
  location: z.string().default(""),
  bullets: z.array(z.string()).default([])
});

export const EducationFactSchema = z.object({
  institution: z.string().default(""),
  qualification: z.string().default(""),
  field: z.string().default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""),
  details: z.array(z.string()).default([])
});

export const ProjectFactSchema = z.object({
  name: z.string().default(""),
  description: z.string().default(""),
  technologies: z.array(z.string()).default([]),
  bullets: z.array(z.string()).default([])
});

export const CandidateFactsSchema = z.object({
  linkedinUrl: z.string().default(""),
  githubUrl: z.string().default(""),
  portfolioUrl: z.string().default(""),
  city: z.string().default(""),
  country: z.string().default(""),
  fullName: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  headline: z.string().default(""),
  summary: z.string().default(""),
  skills: z.array(z.string()).default([]),
  employment: z.array(EmploymentFactSchema).default([]),
  education: z.array(EducationFactSchema).default([]),
  projects: z.array(ProjectFactSchema).default([]),
  certifications: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  evidenceNotes: z.array(z.string()).default([])
});

export type CandidateFacts = z.infer<typeof CandidateFactsSchema>;

export const CvDocumentSchema = z.object({
  id: z.number(),
  sourceName: z.string(),
  sourceType: z.string(),
  rawText: z.string(),
  facts: CandidateFactsSchema,
  createdAt: z.string()
});

export type CvDocument = z.infer<typeof CvDocumentSchema>;

export const JobInputSchema = z.object({
  sourceUrl: z.string().default(""),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().default(""),
  salaryText: z.string().default(""),
  description: z.string().min(20)
});

export type JobInput = z.infer<typeof JobInputSchema>;

export const JobRequirementsSchema = z.object({
  requiredSkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  requiredExperienceYears: z.number().min(0).nullable().default(null),
  responsibilities: z.array(z.string()).default([]),
  qualifications: z.array(z.string()).default([]),
  employmentType: z.string().default(""),
  workplaceType: z.enum(["remote", "hybrid", "onsite", "unknown"]).default("unknown"),
  seniority: z.string().default(""),
  summary: z.string().default(""),
  warnings: z.array(z.string()).default([])
});

export type JobRequirements = z.infer<typeof JobRequirementsSchema>;

export const ExtractedJobSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  salaryText: z.string(),
  description: z.string(),
  requirements: JobRequirementsSchema
});

export type ExtractedJob = z.infer<typeof ExtractedJobSchema>;

export const AnswerInputSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string(),
  category: z.string().default("general")
});

export type AnswerInput = z.infer<typeof AnswerInputSchema>;

export const ExperienceEvidenceSchema = z.object({
  employer: z.string(),
  title: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  years: z.number().min(0),
  relevance: z.string()
});

export const ExperienceSummarySchema = z.object({
  totalYears: z.number().min(0),
  technicalYears: z.number().min(0),
  relevantYears: z.number().min(0),
  parseableEmploymentCount: z.number().int().min(0),
  relevantEmployment: z.array(ExperienceEvidenceSchema),
  warnings: z.array(z.string())
});

export type ExperienceSummary = z.infer<typeof ExperienceSummarySchema>;

export const DiscoverySourceSchema = z.object({
  id: z.number().int(),
  ats: z.enum(["lever", "ashby", "greenhouse", "jobsireland", "irishjobs", "remoteok"]),
  boardKey: z.string(),
  name: z.string(),
  boardUrl: z.string(),
  enabled: z.boolean(),
  learned: z.boolean(),
  lastScanAt: z.string().nullable(),
  lastError: z.string().nullable()
});

export type DiscoverySource = z.infer<typeof DiscoverySourceSchema>;

export const DiscoveryRunInputSchema = z.object({
  targetTitles: z.array(z.string()).optional(),
  locations: z.array(z.string()).optional(),
  minPreScore: z.number().min(0).max(100).default(0),
  minFinalScore: z.number().min(0).max(100).default(0),
  maxDeepAnalysis: z.number().int().min(0).max(20).default(0),
  analysisConcurrency: z.number().int().min(1).max(4).default(1),
  useOutcomeLearning: z.boolean().default(true),
  entryLevelOnly: z.boolean().default(false),
  broadEntryLevelIT: z.boolean().default(false),
  includeRemoteUS: z.boolean().default(false)
});

export type DiscoveryRunInput = z.infer<typeof DiscoveryRunInputSchema>;

export interface ScoreBreakdown {
  total: number;
  skills: number;
  title: number;
  location: number;
  experience: number;
  preference: number;
  candidateExperienceYears: number;
  candidateTechnicalExperienceYears: number;
  experienceSource: "cv-derived" | "profile" | "unknown";
  experienceEvidence: z.infer<typeof ExperienceEvidenceSchema>[];
  matchedSkills: string[];
  missingSkills: string[];
  matchedRequiredSkills: string[];
  missingRequiredSkills: string[];
  matchedPreferredSkills: string[];
  missingPreferredSkills: string[];
  reasons: string[];
  concerns: string[];
  baseTotal?: number;
  outcomeAdjustment?: number;
  outcomeConfidence?: number;
  outcomeSamples?: number;
  outcomeReasons?: string[];
  outcomeLearningActive?: boolean;
}

export const OutcomeLearningFeatureSchema = z.object({
  kind: z.enum(["skill", "title"]),
  key: z.string(),
  label: z.string(),
  samples: z.number().int().min(0),
  interviews: z.number().int().min(0),
  offers: z.number().int().min(0),
  rejections: z.number().int().min(0),
  signal: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  adjustment: z.number()
});

export type OutcomeLearningFeature = z.infer<typeof OutcomeLearningFeatureSchema>;

export const OutcomeLearningModelSchema = z.object({
  enabled: z.boolean(),
  active: z.boolean(),
  submittedApplications: z.number().int().min(0),
  labelledApplications: z.number().int().min(0),
  minimumLabelledApplications: z.number().int().min(1),
  globalConfidence: z.number().min(0).max(1),
  features: z.array(OutcomeLearningFeatureSchema),
  generatedAt: z.string(),
  note: z.string()
});

export type OutcomeLearningModel = z.infer<typeof OutcomeLearningModelSchema>;

export const EvidenceAuditFlagSchema = z.object({
  section: z.string(),
  text: z.string(),
  reason: z.string(),
  evidenceIds: z.array(z.string()).default([])
});

export const EvidenceAuditSchema = z.object({
  status: z.enum(["PASS", "REVIEW"]),
  checkedClaims: z.number().int().min(0),
  supportedClaims: z.number().int().min(0),
  flaggedClaims: z.array(EvidenceAuditFlagSchema).default([]),
  warnings: z.array(z.string()).default([])
});

export type EvidenceAudit = z.infer<typeof EvidenceAuditSchema>;

export const TailoredCvBulletSchema = z.object({
  text: z.string(),
  evidenceIds: z.array(z.string()).min(1)
});

export const TailoredCvEmploymentSchema = z.object({
  employer: z.string(),
  title: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string(),
  bullets: z.array(TailoredCvBulletSchema)
});

export const TailoredCvEducationSchema = z.object({
  institution: z.string(),
  qualification: z.string(),
  field: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  details: z.array(z.string())
});

export const TailoredCvProjectSchema = z.object({
  name: z.string(),
  description: z.string(),
  technologies: z.array(z.string()),
  bullets: z.array(TailoredCvBulletSchema)
});

export const TailoredCvSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  summaryEvidenceIds: z.array(z.string()).default([]),
  skills: z.array(z.string()),
  employment: z.array(TailoredCvEmploymentSchema),
  education: z.array(TailoredCvEducationSchema),
  projects: z.array(TailoredCvProjectSchema)
});

export type TailoredCv = z.infer<typeof TailoredCvSchema>;

export const CoverLetterParagraphSchema = z.object({
  text: z.string(),
  evidenceIds: z.array(z.string()).default([])
});

export const CoverLetterSchema = z.object({
  salutation: z.string(),
  paragraphs: z.array(CoverLetterParagraphSchema),
  closing: z.string()
});

export type CoverLetter = z.infer<typeof CoverLetterSchema>;

export const ScreeningAnswerSchema = z.object({
  key: z.string(),
  question: z.string(),
  answer: z.string(),
  evidenceIds: z.array(z.string()).default([]),
  source: z.enum(["generated", "answer-library"]),
  needsReview: z.boolean().default(true)
});

export type ScreeningAnswer = z.infer<typeof ScreeningAnswerSchema>;

export const GeneratedArtifactSchema = z.object({
  id: z.number().int(),
  kind: z.string(),
  filename: z.string(),
  downloadUrl: z.string()
});

export const ApplicationPackageGenerationSchema = z.object({
  mode: z.enum(["AI", "MIXED", "FALLBACK"]),
  readyToUse: z.boolean(),
  failedStages: z.array(z.enum(["resume", "cover-letter", "screening", "audit"])).default([]),
  message: z.string().default("")
});

export type ApplicationPackageGeneration = z.infer<typeof ApplicationPackageGenerationSchema>;

export const ApplicationPackageSchema = z.object({
  id: z.number().int(),
  jobId: z.number().int(),
  status: z.enum(["PASS", "REVIEW"]),
  tailoredCv: TailoredCvSchema,
  coverLetter: CoverLetterSchema,
  screeningAnswers: z.array(ScreeningAnswerSchema),
  audit: EvidenceAuditSchema,
  generation: ApplicationPackageGenerationSchema.default({
    mode: "AI",
    readyToUse: true,
    failedStages: [],
    message: "Generated with local AI."
  }),
  artifacts: z.array(GeneratedArtifactSchema).default([]),
  createdAt: z.string()
});

export type ApplicationPackage = z.infer<typeof ApplicationPackageSchema>;

// M4 interactive browser application assistant
export const AutomationFieldResultSchema = z.object({
  label: z.string(),
  controlType: z.string(),
  status: z.enum(["filled", "uploaded", "unknown", "manual", "skipped"]),
  source: z.string().default(""),
  detail: z.string().default(""),
  fieldKey: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0),
  learned: z.boolean().default(false)
});

export type AutomationFieldResult = z.infer<typeof AutomationFieldResultSchema>;

export const BrowserSessionResultSchema = z.object({
  active: z.boolean(),
  applicationId: z.number().int(),
  jobId: z.number().int(),
  ats: z.string(),
  finalUrl: z.string(),
  pageTitle: z.string().default(""),
  filled: z.array(z.string()).default([]),
  uploaded: z.array(z.string()).default([]),
  unknownQuestions: z.array(z.string()).default([]),
  manualQuestions: z.array(z.string()).default([]),
  formAnswerDrafts: z.array(ScreeningAnswerSchema).default([]),
  fieldResults: z.array(AutomationFieldResultSchema).default([]),
  submitDetected: z.boolean(),
  captchaDetected: z.boolean(),
  loginDetected: z.boolean(),
  resumeFilename: z.string().default(""),
  coverLetterFilename: z.string().default(""),
  message: z.string().default(""),
  lastScanAt: z.string()
});

export type BrowserSessionResult = z.infer<typeof BrowserSessionResultSchema>;


// M4.1 adaptive field intelligence
export const AutofillMappingSchema = z.object({
  id: z.number().int(),
  ats: z.string(),
  fingerprint: z.string(),
  fieldKey: z.string(),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  seenCount: z.number().int().min(1),
  source: z.string(),
  lastSeenAt: z.string()
});

export type AutofillMapping = z.infer<typeof AutofillMappingSchema>;

export const SkillGrowthItemSchema = z.object({
  skill: z.string(),
  status: z.enum(["missing", "existing"]),
  priority: z.number().min(0),
  requiredCount: z.number().int().min(0),
  preferredCount: z.number().int().min(0),
  totalJobCount: z.number().int().min(0),
  exampleJobs: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([])
});

export const SkillGrowthOverviewSchema = z.object({
  missing: z.array(SkillGrowthItemSchema),
  deepen: z.array(SkillGrowthItemSchema),
  jobsAnalyzed: z.number().int().min(0),
  candidateSkillCount: z.number().int().min(0),
  generatedAt: z.string()
});

export type SkillGrowthItem = z.infer<typeof SkillGrowthItemSchema>;
export type SkillGrowthOverview = z.infer<typeof SkillGrowthOverviewSchema>;

export const LearningMaterialSchema = z.object({
  title: z.string(),
  type: z.enum(["official-docs", "tutorial", "reference", "search"]),
  url: z.string(),
  note: z.string().default("")
});

export const LearningProjectSchema = z.object({
  title: z.string(),
  goal: z.string(),
  milestones: z.array(z.string()).default([]),
  deliverables: z.array(z.string()).default([]),
  stretchGoals: z.array(z.string()).default([]),
  portfolioProof: z.array(z.string()).default([])
});

export const SkillLearningPlanSchema = z.object({
  skill: z.string(),
  mode: z.enum(["learn", "deepen"]),
  whyNow: z.string(),
  currentEvidence: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),
  objectives: z.array(z.string()).default([]),
  project: LearningProjectSchema,
  materials: z.array(LearningMaterialSchema).default([]),
  status: z.enum(["suggested", "learning", "built", "paused"]).default("suggested"),
  createdAt: z.string()
});

export type SkillLearningPlan = z.infer<typeof SkillLearningPlanSchema>;

// M5 application tracker + outcomes
export const ApplicationOutcomeSchema = z.enum([
  "ACTIVE",
  "WAITING",
  "INTERVIEW",
  "REJECTED",
  "OFFER",
  "WITHDRAWN"
]);

export type ApplicationOutcome = z.infer<typeof ApplicationOutcomeSchema>;

export const ApplicationTrackerStageSchema = z.enum([
  "PREPARING",
  "APPLIED",
  "INTERVIEW",
  "OFFER",
  "CLOSED"
]);

export type ApplicationTrackerStage = z.infer<typeof ApplicationTrackerStageSchema>;

export const ApplicationTrackerItemSchema = z.object({
  id: z.number().int(),
  jobId: z.number().int(),
  state: z.string(),
  outcome: ApplicationOutcomeSchema,
  stage: ApplicationTrackerStageSchema,
  ats: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string().default(""),
  sourceUrl: z.string().default(""),
  score: z.number(),
  submittedScore: z.number().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  submittedAt: z.string().nullable().default(null),
  outcomeAt: z.string().nullable().default(null),
  nextActionAt: z.string().nullable().default(null),
  nextAction: z.string().default(""),
  notes: z.string().default("")
});

export type ApplicationTrackerItem = z.infer<typeof ApplicationTrackerItemSchema>;

export const ApplicationTrackerEventSchema = z.object({
  id: z.string(),
  source: z.enum(["workflow", "tracker", "gmail"]),
  eventType: z.string(),
  title: z.string(),
  note: z.string().default(""),
  createdAt: z.string()
});

export type ApplicationTrackerEvent = z.infer<typeof ApplicationTrackerEventSchema>;

export const ApplicationTrackerMetricsSchema = z.object({
  applicationCount: z.number().int().min(0),
  preparingCount: z.number().int().min(0),
  submittedCount: z.number().int().min(0),
  waitingCount: z.number().int().min(0),
  interviewCount: z.number().int().min(0),
  offerCount: z.number().int().min(0),
  rejectedCount: z.number().int().min(0),
  withdrawnCount: z.number().int().min(0),
  responseCount: z.number().int().min(0),
  responseRate: z.number().min(0).max(100),
  interviewRate: z.number().min(0).max(100),
  offerRate: z.number().min(0).max(100),
  averageSubmittedScore: z.number().nullable(),
  averageInterviewScore: z.number().nullable(),
  averageRejectedScore: z.number().nullable(),
  averageOfferScore: z.number().nullable()
});

export type ApplicationTrackerMetrics = z.infer<typeof ApplicationTrackerMetricsSchema>;

export const ApplicationTrackerOverviewSchema = z.object({
  items: z.array(ApplicationTrackerItemSchema),
  metrics: ApplicationTrackerMetricsSchema,
  generatedAt: z.string()
});

export type ApplicationTrackerOverview = z.infer<typeof ApplicationTrackerOverviewSchema>;

export const ApplicationTrackerDetailSchema = z.object({
  item: ApplicationTrackerItemSchema,
  timeline: z.array(ApplicationTrackerEventSchema)
});

export type ApplicationTrackerDetail = z.infer<typeof ApplicationTrackerDetailSchema>;

export const ApplicationTrackerUpdateSchema = z.object({
  nextAction: z.string().max(300).default(""),
  nextActionAt: z.string().nullable().default(null),
  notes: z.string().max(5000).default("")
});

export const ApplicationOutcomeUpdateSchema = z.object({
  outcome: ApplicationOutcomeSchema,
  note: z.string().max(2000).default("")
});

export const ApplicationTrackerNoteSchema = z.object({
  note: z.string().min(1).max(3000)
});

// M6 — Daily Autonomous Discovery
export const DailyDiscoverySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  runTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("08:00"),
  targetTitles: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  minPreScore: z.number().min(0).max(100).default(25),
  minFinalScore: z.number().min(0).max(100).default(60),
  maxDeepAnalysis: z.number().int().min(1).max(20).default(12),
  analysisConcurrency: z.number().int().min(1).max(4).default(2),
  shortlistSize: z.number().int().min(1).max(10).default(5),
  useOutcomeLearning: z.boolean().default(true),
  lastRunDate: z.string().nullable().default(null),
  lastStartedAt: z.string().nullable().default(null),
  lastCompletedAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null)
});

export type DailyDiscoverySettings = z.infer<typeof DailyDiscoverySettingsSchema>;

export const DailyDiscoveryItemSchema = z.object({
  id: z.number().int(),
  briefId: z.number().int(),
  jobId: z.number().int(),
  rank: z.number().int().min(1),
  status: z.enum(["NEW", "REVIEWED", "DISMISSED"]),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  sourceUrl: z.string(),
  ats: z.string(),
  score: z.number(),
  baseScore: z.number(),
  outcomeAdjustment: z.number(),
  matchedRequiredSkills: z.array(z.string()),
  missingRequiredSkills: z.array(z.string()),
  reasons: z.array(z.string()),
  concerns: z.array(z.string()),
  createdAt: z.string(),
  reviewedAt: z.string().nullable()
});

export type DailyDiscoveryItem = z.infer<typeof DailyDiscoveryItemSchema>;

export const DailyDiscoveryBriefSchema = z.object({
  id: z.number().int(),
  runDate: z.string(),
  trigger: z.enum(["scheduled", "manual"]),
  status: z.enum(["RUNNING", "COMPLETED", "FAILED", "INTERRUPTED"]),
  discoveryRunId: z.number().int().nullable(),
  jobsSeen: z.number().int().min(0),
  jobsAnalyzed: z.number().int().min(0),
  jobsImported: z.number().int().min(0),
  shortlistCount: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  errors: z.array(z.string()),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  items: z.array(DailyDiscoveryItemSchema).default([])
});

export type DailyDiscoveryBrief = z.infer<typeof DailyDiscoveryBriefSchema>;

export const DailyDiscoveryStatusSchema = z.object({
  settings: DailyDiscoverySettingsSchema,
  running: z.boolean(),
  nextRunAt: z.string().nullable(),
  dueToday: z.boolean(),
  localDate: z.string(),
  localTime: z.string(),
  latestBrief: DailyDiscoveryBriefSchema.nullable()
});

export type DailyDiscoveryStatus = z.infer<typeof DailyDiscoveryStatusSchema>;


// M7 — Autonomous Application Preparation + Review Queue
export const ApplicationPrepSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  maxPackagesPerBrief: z.number().int().min(1).max(5).default(2),
  minScore: z.number().min(0).max(100).default(75)
});

export type ApplicationPrepSettings = z.infer<typeof ApplicationPrepSettingsSchema>;

export const ApplicationPrepQueueStatusSchema = z.enum([
  "QUEUED",
  "GENERATING",
  "READY",
  "NEEDS_REVIEW",
  "FAILED",
  "DISMISSED",
  "SKIPPED",
  "SUBMITTED"
]);

export type ApplicationPrepQueueStatus = z.infer<typeof ApplicationPrepQueueStatusSchema>;

export const PreparedApplicationItemSchema = z.object({
  id: z.number().int(),
  jobId: z.number().int(),
  briefId: z.number().int().nullable(),
  briefItemId: z.number().int().nullable(),
  source: z.enum(["daily", "manual"]),
  status: ApplicationPrepQueueStatusSchema,
  score: z.number(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  sourceUrl: z.string(),
  ats: z.string(),
  applicationId: z.number().int().nullable(),
  applicationState: z.string().nullable(),
  packageId: z.number().int().nullable(),
  auditStatus: z.enum(["PASS", "REVIEW"]).nullable(),
  errorMessage: z.string().nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  updatedAt: z.string(),
  package: ApplicationPackageSchema.nullable()
});

export type PreparedApplicationItem = z.infer<typeof PreparedApplicationItemSchema>;

export const ApplicationPrepStatusSchema = z.object({
  settings: ApplicationPrepSettingsSchema,
  running: z.boolean(),
  counts: z.object({
    queued: z.number().int().min(0),
    generating: z.number().int().min(0),
    ready: z.number().int().min(0),
    needsReview: z.number().int().min(0),
    failed: z.number().int().min(0)
  })
});

export type ApplicationPrepStatus = z.infer<typeof ApplicationPrepStatusSchema>;

// M8 - Interview and follow-up copilot
export const InterviewEvidenceSchema = z.object({
  id: z.string(),
  scope: z.enum(["candidate", "job"]),
  label: z.string(),
  text: z.string()
});

export type InterviewEvidence = z.infer<typeof InterviewEvidenceSchema>;

export const InterviewQuestionSchema = z.object({
  id: z.string(),
  category: z.enum(["behavioral", "technical", "role", "candidate", "motivation"]),
  question: z.string(),
  whyAsked: z.string(),
  guidance: z.string(),
  difficulty: z.enum(["warmup", "core", "stretch"]),
  evidence: z.array(InterviewEvidenceSchema).default([])
});

export type InterviewQuestion = z.infer<typeof InterviewQuestionSchema>;

export const InterviewStorySchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  evidence: z.array(InterviewEvidenceSchema).default([])
});

export const InterviewRefreshTopicSchema = z.object({
  skill: z.string(),
  reason: z.string(),
  priority: z.enum(["high", "medium", "low"])
});

export const InterviewPrepPackSchema = z.object({
  applicationId: z.number().int(),
  jobId: z.number().int(),
  title: z.string(),
  company: z.string(),
  location: z.string().default(""),
  roleSummary: z.string().default(""),
  roleFocus: z.array(z.object({ topic: z.string(), why: z.string() })).default([]),
  questions: z.array(InterviewQuestionSchema).default([]),
  stories: z.array(InterviewStorySchema).default([]),
  refreshTopics: z.array(InterviewRefreshTopicSchema).default([]),
  questionsToAsk: z.array(z.string()).default([]),
  generatedAt: z.string()
});

export type InterviewPrepPack = z.infer<typeof InterviewPrepPackSchema>;

export const MockInterviewFeedbackSchema = z.object({
  overallScore: z.number().min(0).max(100),
  structureScore: z.number().min(0).max(100),
  relevanceScore: z.number().min(0).max(100),
  evidenceScore: z.number().min(0).max(100),
  clarityScore: z.number().min(0).max(100),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  suggestedStructure: z.string().default(""),
  unsupportedClaims: z.array(z.string()).default([])
});

export type MockInterviewFeedback = z.infer<typeof MockInterviewFeedbackSchema>;

export const MockInterviewTurnSchema = z.object({
  id: z.number().int(),
  applicationId: z.number().int(),
  questionId: z.string(),
  question: z.string(),
  answer: z.string(),
  feedback: MockInterviewFeedbackSchema,
  createdAt: z.string()
});

export type MockInterviewTurn = z.infer<typeof MockInterviewTurnSchema>;

export const FollowUpDraftSchema = z.object({
  id: z.number().int(),
  applicationId: z.number().int(),
  kind: z.enum(["follow_up", "thank_you"]),
  subject: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type FollowUpDraft = z.infer<typeof FollowUpDraftSchema>;

export const CareerCoachApplicationSchema = z.object({
  applicationId: z.number().int(),
  jobId: z.number().int(),
  outcome: ApplicationOutcomeSchema,
  state: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string().default(""),
  sourceUrl: z.string().default(""),
  submittedAt: z.string().nullable().default(null),
  outcomeAt: z.string().nullable().default(null),
  nextAction: z.string().default(""),
  nextActionAt: z.string().nullable().default(null),
  daysWaiting: z.number().int().min(0).default(0),
  packGeneratedAt: z.string().nullable().default(null),
  mockTurnCount: z.number().int().min(0).default(0)
});

export type CareerCoachApplication = z.infer<typeof CareerCoachApplicationSchema>;

export const CareerCoachOverviewSchema = z.object({
  interviews: z.array(CareerCoachApplicationSchema),
  waitingFollowUps: z.array(CareerCoachApplicationSchema),
  counts: z.object({
    interviews: z.number().int().min(0),
    followUpsDue: z.number().int().min(0),
    prepPacks: z.number().int().min(0),
    mockTurns: z.number().int().min(0)
  }),
  followUpAfterDays: z.number().int().min(1),
  generatedAt: z.string()
});

export type CareerCoachOverview = z.infer<typeof CareerCoachOverviewSchema>;

// M10 - Gmail intelligence
export const GmailClassificationSchema = z.enum([
  "INTERVIEW",
  "ASSESSMENT",
  "OFFER",
  "REJECTION",
  "RECRUITER_REPLY",
  "APPLICATION_ACK",
  "OTHER"
]);

export type GmailClassification = z.infer<typeof GmailClassificationSchema>;

export const GmailActionStatusSchema = z.enum(["PENDING", "APPLIED", "IGNORED", "INFO"]);
export type GmailActionStatus = z.infer<typeof GmailActionStatusSchema>;

export const GmailMessageDetailsSchema = z.object({
  interviewDate: z.string().default(""),
  interviewTime: z.string().default(""),
  timezone: z.string().default(""),
  meetingLink: z.string().default(""),
  interviewLocation: z.string().default(""),
  assessmentDeadline: z.string().default(""),
  assessmentPlatform: z.string().default("")
});

export type GmailMessageDetails = z.infer<typeof GmailMessageDetailsSchema>;

export const GmailMessageSchema = z.object({
  gmailId: z.string(),
  threadId: z.string(),
  fromEmail: z.string(),
  fromName: z.string().default(""),
  subject: z.string().default(""),
  snippet: z.string().default(""),
  receivedAt: z.string(),
  applicationId: z.number().int().nullable(),
  applicationTitle: z.string().nullable().default(null),
  applicationCompany: z.string().nullable().default(null),
  matchConfidence: z.number().min(0).max(1).default(0),
  classification: GmailClassificationSchema,
  classificationConfidence: z.number().min(0).max(1).default(0),
  summary: z.string().default(""),
  details: GmailMessageDetailsSchema,
  suggestedOutcome: ApplicationOutcomeSchema.nullable().default(null),
  actionStatus: GmailActionStatusSchema,
  gmailUrl: z.string().default(""),
  confirmedAt: z.string().nullable().default(null),
  ignoredAt: z.string().nullable().default(null)
});

export type GmailMessage = z.infer<typeof GmailMessageSchema>;

export const GmailSettingsSchema = z.object({
  oauthConfigured: z.boolean(),
  connected: z.boolean(),
  email: z.string().default(""),
  syncEnabled: z.boolean().default(false),
  intervalMinutes: z.number().int().min(5).max(120).default(15),
  lookbackDays: z.number().int().min(1).max(90).default(30),
  lastSyncAt: z.string().nullable().default(null),
  lastSyncStartedAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
  syncing: z.boolean().default(false)
});

export type GmailSettings = z.infer<typeof GmailSettingsSchema>;

export const GmailApplicationOptionSchema = z.object({
  applicationId: z.number().int(),
  jobId: z.number().int(),
  title: z.string(),
  company: z.string(),
  state: z.string(),
  outcome: ApplicationOutcomeSchema,
  submittedAt: z.string().nullable().default(null)
});

export type GmailApplicationOption = z.infer<typeof GmailApplicationOptionSchema>;

export const GmailSyncRunSchema = z.object({
  id: z.number().int(),
  trigger: z.string(),
  status: z.string(),
  messagesSeen: z.number().int().min(0),
  relevantMessages: z.number().int().min(0),
  newMessages: z.number().int().min(0),
  matchedMessages: z.number().int().min(0),
  aiClassified: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  errorMessage: z.string().nullable().default(null),
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null)
});

export type GmailSyncRun = z.infer<typeof GmailSyncRunSchema>;

export const GmailOverviewSchema = z.object({
  settings: GmailSettingsSchema,
  counts: z.object({
    total: z.number().int().min(0),
    pending: z.number().int().min(0),
    interviews: z.number().int().min(0),
    assessments: z.number().int().min(0),
    offers: z.number().int().min(0),
    rejections: z.number().int().min(0),
    unmatched: z.number().int().min(0)
  }),
  messages: z.array(GmailMessageSchema),
  applications: z.array(GmailApplicationOptionSchema),
  recentRuns: z.array(GmailSyncRunSchema),
  generatedAt: z.string()
});

export type GmailOverview = z.infer<typeof GmailOverviewSchema>;
