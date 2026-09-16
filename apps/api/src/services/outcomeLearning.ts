import type {
  JobInput,
  JobRequirements,
  OutcomeLearningFeature,
  OutcomeLearningModel,
  ScoreBreakdown
} from "@apply-lite/shared";
import { JobRequirementsSchema } from "@apply-lite/shared";
import { db } from "../db/database.js";

const MIN_LABELLED_APPLICATIONS = 3;
const MIN_FEATURE_SAMPLES = 2;
const MAX_ADJUSTMENT = 8;

const TITLE_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "role", "job",
  "engineer", "developer", "manager", "specialist", "consultant",
  "associate", "senior", "junior", "lead", "staff"
]);

const SKILL_ALIASES: Record<string, string> = {
  "nodejs": "node.js",
  "node js": "node.js",
  "reactjs": "react",
  "react.js": "react",
  "typescript": "typescript",
  "ts": "typescript",
  "javascript": "javascript",
  "js": "javascript",
  "google cloud": "gcp",
  "google cloud platform": "gcp",
  "amazon web services": "aws",
  "continuous integration": "ci/cd",
  "continuous delivery": "ci/cd",
  "cicd": "ci/cd"
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#./\- ]/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalSkill(value: string) {
  const normalized = normalize(value);
  return SKILL_ALIASES[normalized] ?? normalized;
}

function titleFeatures(title: string) {
  return [...new Set(
    normalize(title)
      .split(" ")
      .filter((token) => token.length >= 3 && !TITLE_STOPWORDS.has(token))
  )];
}

function parseRequirements(value: string): JobRequirements {
  try {
    const parsed = JobRequirementsSchema.safeParse(JSON.parse(value || "{}"));
    return parsed.success ? parsed.data : JobRequirementsSchema.parse({});
  } catch {
    return JobRequirementsSchema.parse({});
  }
}

function jobFeatures(title: string, requirements: JobRequirements) {
  const features = new Map<string, { kind: "skill" | "title"; key: string; label: string }>();
  for (const token of titleFeatures(title)) {
    features.set(`title:${token}`, { kind: "title", key: token, label: token });
  }
  for (const skill of [...requirements.requiredSkills, ...requirements.preferredSkills]) {
    const key = canonicalSkill(skill);
    if (key) features.set(`skill:${key}`, { kind: "skill", key, label: skill.trim() || key });
  }
  return [...features.values()];
}

type TrainingRow = {
  applicationId: number;
  state: string;
  outcome: string;
  submittedAt: string | null;
  title: string;
  analysisJson: string;
};

type FeatureAccumulator = {
  kind: "skill" | "title";
  key: string;
  label: string;
  signals: number[];
  interviews: number;
  offers: number;
  rejections: number;
};

function outcomeSignal(row: TrainingRow, events: Set<string>) {
  const reachedOffer = row.outcome === "OFFER" || events.has("OUTCOME_OFFER");
  const reachedInterview = row.outcome === "INTERVIEW" || reachedOffer || events.has("OUTCOME_INTERVIEW");
  const rejected = row.outcome === "REJECTED" || events.has("OUTCOME_REJECTED");

  if (reachedOffer) return { signal: 1, interview: true, offer: true, rejected };
  if (reachedInterview && rejected) return { signal: 0.35, interview: true, offer: false, rejected: true };
  if (reachedInterview) return { signal: 0.55, interview: true, offer: false, rejected: false };
  if (rejected) return { signal: -0.65, interview: false, offer: false, rejected: true };
  return null;
}

export function buildOutcomeLearningModel(): OutcomeLearningModel {
  const rows = db.prepare(`
    SELECT a.id AS applicationId, a.state, a.outcome, a.submitted_at AS submittedAt,
           j.title, j.analysis_json AS analysisJson
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.submitted_at IS NOT NULL OR a.state = 'SUBMITTED'
    ORDER BY a.id
  `).all() as TrainingRow[];

  const eventRows = db.prepare(`
    SELECT application_id AS applicationId, event_type AS eventType
    FROM application_tracker_events
    WHERE event_type IN ('OUTCOME_INTERVIEW', 'OUTCOME_OFFER', 'OUTCOME_REJECTED')
  `).all() as Array<{ applicationId: number; eventType: string }>;

  const eventsByApplication = new Map<number, Set<string>>();
  for (const event of eventRows) {
    const set = eventsByApplication.get(event.applicationId) ?? new Set<string>();
    set.add(event.eventType);
    eventsByApplication.set(event.applicationId, set);
  }

  type OutcomeLabel = NonNullable<ReturnType<typeof outcomeSignal>>;
  const labelled: Array<{ row: TrainingRow; label: OutcomeLabel }> = [];
  for (const row of rows) {
    const label = outcomeSignal(row, eventsByApplication.get(row.applicationId) ?? new Set<string>());
    if (label) labelled.push({ row, label });
  }

  const globalConfidence = Math.min(1, labelled.length / 10);
  const accumulators = new Map<string, FeatureAccumulator>();

  for (const { row, label } of labelled) {
    const requirements = parseRequirements(row.analysisJson);
    for (const feature of jobFeatures(row.title, requirements)) {
      const mapKey = `${feature.kind}:${feature.key}`;
      const current: FeatureAccumulator = accumulators.get(mapKey) ?? {
        ...feature,
        signals: [],
        interviews: 0,
        offers: 0,
        rejections: 0
      };
      current.signals.push(label.signal);
      if (label.interview) current.interviews += 1;
      if (label.offer) current.offers += 1;
      if (label.rejected) current.rejections += 1;
      accumulators.set(mapKey, current);
    }
  }

  const features: OutcomeLearningFeature[] = [...accumulators.values()].map((entry) => {
    const samples = entry.signals.length;
    const signal = samples ? entry.signals.reduce((sum, value) => sum + value, 0) / samples : 0;
    const featureConfidence = Math.min(1, samples / 5) * globalConfidence;
    const adjustment = Math.round(signal * 8 * featureConfidence * 10) / 10;
    return {
      kind: entry.kind,
      key: entry.key,
      label: entry.label,
      samples,
      interviews: entry.interviews,
      offers: entry.offers,
      rejections: entry.rejections,
      signal: Math.round(signal * 1000) / 1000,
      confidence: Math.round(featureConfidence * 1000) / 1000,
      adjustment
    };
  }).sort((a, b) => {
    if (b.samples !== a.samples) return b.samples - a.samples;
    return Math.abs(b.adjustment) - Math.abs(a.adjustment);
  });

  const active = labelled.length >= MIN_LABELLED_APPLICATIONS;
  const note = active
    ? `Outcome learning is active using ${labelled.length} labelled applications. Adjustments are confidence-weighted and capped at +/-${MAX_ADJUSTMENT} points.`
    : `Outcome learning is collecting evidence. It activates after ${MIN_LABELLED_APPLICATIONS} applications reach interview, offer, or rejection; ${labelled.length} labelled outcome${labelled.length === 1 ? "" : "s"} available now.`;

  return {
    enabled: true,
    active,
    submittedApplications: rows.length,
    labelledApplications: labelled.length,
    minimumLabelledApplications: MIN_LABELLED_APPLICATIONS,
    globalConfidence: Math.round(globalConfidence * 1000) / 1000,
    features,
    generatedAt: new Date().toISOString(),
    note
  };
}

export function applyOutcomeLearning(
  base: ScoreBreakdown,
  job: JobInput,
  requirements: JobRequirements,
  useOutcomeLearning = true,
  model: OutcomeLearningModel = buildOutcomeLearningModel()
): ScoreBreakdown {
  const baseTotal = base.total;

  if (!useOutcomeLearning || !model.active) {
    return {
      ...base,
      total: baseTotal,
      baseTotal,
      outcomeAdjustment: 0,
      outcomeConfidence: model.globalConfidence,
      outcomeSamples: model.labelledApplications,
      outcomeReasons: [useOutcomeLearning ? model.note : "Outcome learning is disabled for this score."],
      outcomeLearningActive: false
    };
  }

  const featureLookup = new Map<string, OutcomeLearningFeature>(
    model.features.map((feature) => [`${feature.kind}:${feature.key}`, feature] as [string, OutcomeLearningFeature])
  );
  const matches = jobFeatures(job.title, requirements)
    .map((feature) => featureLookup.get(`${feature.kind}:${feature.key}`))
    .filter((feature): feature is OutcomeLearningFeature => Boolean(feature && feature.samples >= MIN_FEATURE_SAMPLES))
    .sort((a, b) => Math.abs(b.adjustment) - Math.abs(a.adjustment))
    .slice(0, 4);

  if (!matches.length) {
    return {
      ...base,
      total: baseTotal,
      baseTotal,
      outcomeAdjustment: 0,
      outcomeConfidence: model.globalConfidence,
      outcomeSamples: model.labelledApplications,
      outcomeReasons: ["Outcome learning is active, but no sufficiently repeated historical pattern overlaps this job yet."],
      outcomeLearningActive: true
    };
  }

  const rawAdjustment = matches.reduce((sum, feature) => sum + feature.adjustment, 0);
  const adjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, Math.round(rawAdjustment)));
  const confidence = matches.reduce((sum, feature) => sum + feature.confidence, 0) / matches.length;
  const total = Math.max(0, Math.min(100, baseTotal + adjustment));
  const outcomeReasons = matches.map((feature) => {
    const direction = feature.adjustment >= 0 ? "+" : "";
    const type = feature.kind === "skill" ? "Skill" : "Title pattern";
    return `${type} ${feature.label}: ${direction}${feature.adjustment.toFixed(1)} signal from ${feature.samples} labelled outcome${feature.samples === 1 ? "" : "s"}`;
  });

  return {
    ...base,
    total,
    baseTotal,
    outcomeAdjustment: adjustment,
    outcomeConfidence: Math.round(confidence * 1000) / 1000,
    outcomeSamples: model.labelledApplications,
    outcomeReasons,
    outcomeLearningActive: true
  };
}
