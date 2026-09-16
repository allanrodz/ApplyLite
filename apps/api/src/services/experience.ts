import { roleSimilarity, careerFamilies } from "./matching.js";
import type {
  CandidateFacts,
  ExperienceSummary,
  JobInput,
  JobRequirements
} from "@apply-lite/shared";

type EmploymentFact = CandidateFacts["employment"][number];
type MonthInterval = { start: number; endExclusive: number };

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11
};

const TECH_TERMS = [
  "software", "developer", "engineer", "programming", "application", "web", "frontend", "front end",
  "backend", "back end", "full stack", "fullstack", "cloud", "firebase", "node", "react", "angular",
  "typescript", "javascript", "python", "java", "flutter", "dart", "api", "database", "sql", "devops",
  "mlops", "machine learning", "artificial intelligence", " ai ", "data engineering", "automation",
  "technical project", "it project", "systems", "cybersecurity", "stripe", "docker", "kubernetes"
];

const TITLE_STOPWORDS = new Set([
  "senior", "junior", "jr", "sr", "ii", "iii", "lead", "principal", "staff", "associate", "the", "and",
  "of", "for", "to", "a", "an"
]);

function normalize(value: string) {
  return ` ${value.toLowerCase().replace(/[^a-z0-9+#./ -]/g, " ").replace(/\s+/g, " ").trim()} `;
}

function currentMonthIndex() {
  const now = new Date();
  return now.getUTCFullYear() * 12 + now.getUTCMonth();
}

function parseMonth(value: string, endDate: boolean): number | null {
  const raw = value.trim().toLowerCase().replace(/[–—]/g, "-");
  if (!raw) return null;
  if (/^(present|current|now|ongoing|today|presente|atual)$/.test(raw)) return currentMonthIndex();

  let match = raw.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    if (month >= 0 && month <= 11) return year * 12 + month;
  }

  match = raw.match(/^(\d{1,2})[-/](\d{4})$/);
  if (match) {
    const month = Number(match[1]) - 1;
    const year = Number(match[2]);
    if (month >= 0 && month <= 11) return year * 12 + month;
  }

  match = raw.match(/^([a-z]+)\.?\s+(\d{4})$/);
  if (match) {
    const month = MONTHS[match[1]];
    if (month !== undefined) return Number(match[2]) * 12 + month;
  }

  match = raw.match(/^(\d{4})\s+([a-z]+)\.?$/);
  if (match) {
    const month = MONTHS[match[2]];
    if (month !== undefined) return Number(match[1]) * 12 + month;
  }

  match = raw.match(/^(\d{4})$/);
  if (match) return Number(match[1]) * 12 + (endDate ? 11 : 0);

  return null;
}

function intervalForEmployment(entry: EmploymentFact): MonthInterval | null {
  const start = parseMonth(entry.startDate, false);
  let end = parseMonth(entry.endDate, true);
  if (start === null || end === null) return null;
  end = Math.min(end, currentMonthIndex());
  if (end < start) return null;
  return { start, endExclusive: end + 1 };
}

function mergedMonths(intervals: MonthInterval[]) {
  if (!intervals.length) return 0;
  const ordered = [...intervals].sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
  let total = 0;
  let current = { ...ordered[0] };
  for (const interval of ordered.slice(1)) {
    if (interval.start <= current.endExclusive) {
      current.endExclusive = Math.max(current.endExclusive, interval.endExclusive);
    } else {
      total += Math.max(0, current.endExclusive - current.start);
      current = { ...interval };
    }
  }
  total += Math.max(0, current.endExclusive - current.start);
  return total;
}

function years(months: number) {
  return Math.round((months / 12) * 10) / 10;
}

function employmentText(entry: EmploymentFact) {
  return normalize([entry.title, entry.employer, entry.location, ...entry.bullets].join(" "));
}

function titleTokens(value: string) {
  return normalize(value)
    .trim()
    .split(" ")
    .filter((token) => token.length > 2 && !TITLE_STOPWORDS.has(token));
}

function titleRelated(jobTitle: string, employmentTitle: string) { return roleSimilarity(jobTitle, employmentTitle) >= 0.65; }
function isTechnicalEmployment(entry: EmploymentFact, _facts: CandidateFacts) { return careerFamilies(entry.title).some(key => ["software", "support", "data", "qa", "cloud", "security", "ai"].includes(key)); }

function relevanceReason(entry: EmploymentFact, facts: CandidateFacts, job?: JobInput | null, requirements?: JobRequirements | null) {
  const text = employmentText(entry);
  if (job && titleRelated(job.title, entry.title)) return "title overlap";


  return job ? "" : isTechnicalEmployment(entry, facts) ? "technical employment" : "";
}

export function deriveExperienceSummary(
  facts: CandidateFacts | null | undefined,
  job?: JobInput | null,
  requirements?: JobRequirements | null
): ExperienceSummary {
  if (!facts?.employment?.length) {
    return {
      totalYears: 0,
      technicalYears: 0,
      relevantYears: 0,
      parseableEmploymentCount: 0,
      relevantEmployment: [],
      warnings: ["No structured employment dates are available in the current CV."]
    };
  }

  const allIntervals: MonthInterval[] = [];
  const technicalIntervals: MonthInterval[] = [];
  const relevantIntervals: MonthInterval[] = [];
  const relevantEmployment: ExperienceSummary["relevantEmployment"] = [];
  const warnings: string[] = [];
  let parseableEmploymentCount = 0;

  for (const entry of facts.employment) {
    const interval = intervalForEmployment(entry);
    if (!interval) {
      warnings.push(`Could not parse employment dates for ${entry.title} at ${entry.employer}: ${entry.startDate} - ${entry.endDate}`);
      continue;
    }
    parseableEmploymentCount += 1;
    allIntervals.push(interval);

    const technical = isTechnicalEmployment(entry, facts);
    if (technical) technicalIntervals.push(interval);

    const reason = relevanceReason(entry, facts, job, requirements);
    if (reason) {
      relevantIntervals.push(interval);
      relevantEmployment.push({
        employer: entry.employer,
        title: entry.title,
        startDate: entry.startDate,
        endDate: entry.endDate,
        years: years(interval.endExclusive - interval.start),
        relevance: reason
      });
    }
  }

  const totalYears = years(mergedMonths(allIntervals));
  const technicalYears = years(mergedMonths(technicalIntervals));
  const relevantYears = years(mergedMonths(relevantIntervals));

  return {
    totalYears,
    technicalYears,
    relevantYears: job ? relevantYears : technicalYears,
    parseableEmploymentCount,
    relevantEmployment,
    warnings
  };
}
