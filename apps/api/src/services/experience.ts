import { genericDutyEvidence } from "./reliabilityPolicy.js";
import { roleSimilarity, careerFamilies } from "./matching.js";
import type { CandidateFacts, ExperienceSummary, JobInput, JobRequirements } from "@apply-lite/shared";

type EmploymentFact = CandidateFacts["employment"][number];
type MonthInterval = { start: number; endExclusive: number };
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
};
function currentMonthIndex() { const now = new Date(); return now.getUTCFullYear() * 12 + now.getUTCMonth(); }
function parseMonth(value: string, endDate: boolean): number | null {
  const raw = value.trim().toLowerCase().replace(/[\u2013\u2014]/g, "-");
  if (!raw) return null;
  if (/^(present|current|now|ongoing|today|presente|atual)$/.test(raw)) return currentMonthIndex();
  let match = raw.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (match) { const month = Number(match[2]) - 1; if (month >= 0 && month <= 11) return Number(match[1]) * 12 + month; }
  match = raw.match(/^(\d{1,2})[-/](\d{4})$/);
  if (match) { const month = Number(match[1]) - 1; if (month >= 0 && month <= 11) return Number(match[2]) * 12 + month; }
  match = raw.match(/^([a-z]+)\.?\s+(\d{4})$/);
  if (match && MONTHS[match[1]] !== undefined) return Number(match[2]) * 12 + MONTHS[match[1]];
  match = raw.match(/^(\d{4})\s+([a-z]+)\.?$/);
  if (match && MONTHS[match[2]] !== undefined) return Number(match[1]) * 12 + MONTHS[match[2]];
  match = raw.match(/^(\d{4})$/);
  return match ? Number(match[1]) * 12 + (endDate ? 11 : 0) : null;
}
function intervalForEmployment(entry: EmploymentFact): MonthInterval | null {
  const start = parseMonth(entry.startDate, false); let end = parseMonth(entry.endDate, true);
  if (start === null || end === null) return null;
  end = Math.min(end, currentMonthIndex());
  return end < start ? null : { start, endExclusive: end + 1 };
}
function mergedMonths(intervals: MonthInterval[]) {
  if (!intervals.length) return 0;
  const ordered = [...intervals].sort((a,b) => a.start - b.start || a.endExclusive - b.endExclusive);
  let total = 0, current = { ...ordered[0] };
  for (const interval of ordered.slice(1)) {
    if (interval.start <= current.endExclusive) current.endExclusive = Math.max(current.endExclusive, interval.endExclusive);
    else { total += Math.max(0, current.endExclusive - current.start); current = { ...interval }; }
  }
  return total + Math.max(0, current.endExclusive - current.start);
}
const years = (months: number) => Math.round(months / 12 * 10) / 10;
function isTechnicalEmployment(entry: EmploymentFact) { return careerFamilies(entry.title).some(key => ["software", "support", "data", "qa", "cloud", "security", "ai"].includes(key)); }
function relevanceReason(entry: EmploymentFact, job?: JobInput | null, requirements?: JobRequirements | null) {
  if (job && roleSimilarity(job.title, entry.title) >= 0.65) return "title overlap";
  if (job && requirements) { const duty = genericDutyEvidence(entry.title, entry.bullets, requirements.requiredSkills); if (duty) return duty; }
  return job ? "" : isTechnicalEmployment(entry) ? "technical employment" : "";
}
export function deriveExperienceSummary(facts: CandidateFacts | null | undefined, job?: JobInput | null, requirements?: JobRequirements | null): ExperienceSummary {
  if (!facts?.employment?.length) return { totalYears: 0, technicalYears: 0, relevantYears: 0, parseableEmploymentCount: 0, relevantEmployment: [], warnings: ["No structured employment dates are available in the current CV."] };
  const allIntervals: MonthInterval[] = [], technicalIntervals: MonthInterval[] = [], relevantIntervals: MonthInterval[] = [];
  const relevantEmployment: ExperienceSummary["relevantEmployment"] = [], warnings: string[] = [];
  let parseableEmploymentCount = 0;
  for (const entry of facts.employment) {
    const interval = intervalForEmployment(entry);
    if (!interval) { warnings.push(`Could not parse employment dates for ${entry.title} at ${entry.employer}: ${entry.startDate} - ${entry.endDate}`); continue; }
    parseableEmploymentCount++; allIntervals.push(interval);
    if (isTechnicalEmployment(entry)) technicalIntervals.push(interval);
    const reason = relevanceReason(entry, job, requirements);
    if (reason) {
      relevantIntervals.push(interval);
      relevantEmployment.push({ employer: entry.employer, title: entry.title, startDate: entry.startDate, endDate: entry.endDate, years: years(interval.endExclusive - interval.start), relevance: reason });
    }
  }
  const totalYears = years(mergedMonths(allIntervals)), technicalYears = years(mergedMonths(technicalIntervals));
  return { totalYears, technicalYears, relevantYears: job ? years(mergedMonths(relevantIntervals)) : technicalYears, parseableEmploymentCount, relevantEmployment, warnings };
}
