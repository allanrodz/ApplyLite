import { remoteScopeCompatible } from "./reliabilityPolicy.js";
import { canonicalSkill, skillMatches, containsTerm, roleSimilarity, targets } from "./matching.js";
import type { CandidateFacts, JobInput, JobRequirements, Profile, ScoreBreakdown } from "@apply-lite/shared";
import { deriveExperienceSummary } from "./experience.js";

const STOPWORDS = new Set([
  "and", "the", "with", "for", "from", "that", "this", "you", "your", "our",
  "are", "will", "have", "has", "using", "into", "job", "role", "work", "team"
]);
function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#./\- ]/g, " ").replace(/\s+/g, " ").trim();
}
function tokenSet(value: string) {
  return new Set(normalize(value).split(" ").filter(token => token.length > 1 && !STOPWORDS.has(token)));
}
function includesLoose(text: string, term: string) { return containsTerm(text, term); }
function extractExperienceYears(text: string): number | null {
  const relevant = text.split(/[\n.!?]/).filter(line => !/\b(preferred|desirable|nice to have)\b/i.test(line)).join("\n");
  const matches = [...relevant.matchAll(/(\d{1,2})(?:\s*[-\u2013]\s*\d{1,2})?\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:(?:relevant|professional|commercial|industry|work|hands-on|software|technical)\s+)?experience/gi)].map(match => Number(match[1]));
  return matches.length ? Math.max(...matches) : null;
}
type SkillSpecificExperienceRequirement = { years: number; subject: string };
function cleanExperienceSubject(value: string) {
  return value.replace(/\b(?:experience|required|preferred|minimum|professional|hands-on)\b.*$/i, "")
    .replace(/\s+(?:and|plus|with)\s+.*$/i, "").replace(/[.;,:].*$/, "").trim();
}
function extractSkillSpecificExperienceRequirement(text: string, requiredSkills: string[]): SkillSpecificExperienceRequirement | null {
  const patterns = [
    /(\d{1,2})(?:\s*[-\u2013]\s*\d{1,2})?\+?\s*(?:years?|yrs?)\s+(?:of\s+)?([a-z0-9+#./ -]{2,50}?)\s+experience\b/i,
    /(\d{1,2})(?:\s*[-\u2013]\s*\d{1,2})?\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience\s+(?:with|in|using)\s+([a-z0-9+#./ -]{2,50})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const years = Number(match[1]), subject = cleanExperienceSubject(match[2]);
    if (!subject || !Number.isFinite(years)) continue;
    if (requiredSkills.some(skill => skillMatches(subject, skill) || skillMatches(skill, subject))) return { years, subject };
  }
  return null;
}
function explicitSubjectYearsInCv(facts: CandidateFacts | null | undefined, subject: string) {
  if (!facts) return 0;
  const snippets = [facts.summary, facts.headline, ...facts.employment.flatMap(entry => entry.bullets), ...facts.projects.flatMap(project => [project.description, ...project.bullets])].filter(Boolean);
  const subjectTokens = [...tokenSet(subject)]; let best = 0;
  for (const snippet of snippets) {
    const normalized = normalize(snippet);
    if (!subjectTokens.length || !subjectTokens.every(token => normalized.includes(token))) continue;
    const years = extractExperienceYears(snippet);
    if (years !== null) best = Math.max(best, years);
  }
  return best;
}
function unique(values: string[]) {
  const seen = new Map<string, string>();
  for (const value of values) { const trimmed = value.trim(); if (trimmed) seen.set(canonicalSkill(trimmed), trimmed); }
  return [...seen.values()];
}
function candidateSkills(profile: Profile, facts?: CandidateFacts | null) {
  return unique([...profile.skills, ...(facts?.skills ?? []), ...(facts?.projects.flatMap(project => project.technologies) ?? [])]);
}
function partitionSkills(jobSkills: string[], candidate: string[]) {
  const matched: string[] = [], missing: string[] = [];
  for (const skill of unique(jobSkills)) {
    if (candidate.some(candidateSkill => skillMatches(candidateSkill, skill))) matched.push(skill);
    else missing.push(skill);
  }
  return { matched, missing };
}
export function scoreJob(profile: Profile, job: JobInput, requirements?: JobRequirements | null, facts?: CandidateFacts | null): ScoreBreakdown {
  const candidate = candidateSkills(profile, facts), jobText = `${job.title} ${job.description}`;
  const required = partitionSkills(requirements?.requiredSkills ?? [], candidate), preferred = partitionSkills(requirements?.preferredSkills ?? [], candidate);
  let skills: number;
  if ((requirements?.requiredSkills.length ?? 0) > 0) {
    const requiredRatio = required.matched.length / Math.max(1, requirements!.requiredSkills.length);
    const preferredRatio = requirements!.preferredSkills.length ? preferred.matched.length / requirements!.preferredSkills.length : 1;
    skills = Math.round(requiredRatio * 30 + preferredRatio * 10);
  } else if ((requirements?.preferredSkills.length ?? 0) > 0) {
    skills = Math.round(10 + preferred.matched.length / Math.max(1, requirements!.preferredSkills.length) * 30);
  } else {
    skills = Math.min(20, candidate.filter(skill => includesLoose(jobText, skill)).length * 4);
  }
  const desiredTitles = targets(profile);
  const titleOverlap = desiredTitles.reduce((best, desired) => Math.max(best, roleSimilarity(job.title, desired)), 0);
  const title = desiredTitles.length ? Math.round(titleOverlap * 20) : 0;
  const locationText = normalize(job.location), workplaceType = requirements?.workplaceType ?? "unknown";
  const geographicPreferences = profile.preferredLocations.filter(place => !/^(remote|any|anywhere)$/i.test(place.trim()));
  const preferredLocationMatched = geographicPreferences.length > 0 && geographicPreferences.some(place => containsTerm(locationText, place));
  const remoteLocationCompatible = workplaceType === "remote" && ["any", "remote"].includes(profile.remotePreference)
    && (preferredLocationMatched || remoteScopeCompatible(job.location, job.description, geographicPreferences));
  const location = preferredLocationMatched || remoteLocationCompatible ? 10 : locationText ? 3 : 6;
  const experienceSummary = deriveExperienceSummary(facts, job, requirements);
  const cvDerivedAvailable = Boolean(facts && experienceSummary.parseableEmploymentCount > 0);
  const candidateExperienceYears = cvDerivedAvailable ? experienceSummary.relevantYears : profile.yearsExperience;
  const experienceSource: ScoreBreakdown["experienceSource"] = cvDerivedAvailable ? "cv-derived" : profile.yearsExperience > 0 ? "profile" : "unknown";
  const impreciseDates = experienceSummary.warnings.some(w => w.startsWith("Year-only dates"));
  const requiredYears = requirements?.requiredExperienceYears ?? extractExperienceYears(job.description);
  const skillSpecificExperience = extractSkillSpecificExperienceRequirement(job.description, requirements?.requiredSkills ?? []);
  const explicitSkillYears = skillSpecificExperience ? explicitSubjectYearsInCv(facts, skillSpecificExperience.subject) : 0;
  const skillSpecificYearsUnverified = Boolean(skillSpecificExperience && explicitSkillYears < skillSpecificExperience.years && candidateExperienceYears >= skillSpecificExperience.years);
  const experience = requiredYears === null ? 12 : skillSpecificYearsUnverified ? 9 : candidateExperienceYears >= requiredYears ? 15 : Math.max(0, 15 - (requiredYears - candidateExperienceYears) * 5);
  let preference = 15;
  if (profile.remotePreference !== "any" && workplaceType !== "unknown" && workplaceType !== profile.remotePreference) preference -= 5;
  if (/senior|staff|principal|lead|manager/i.test(`${requirements?.seniority ?? ""} ${job.title}`) && candidateExperienceYears > 0 && candidateExperienceYears < 4) preference -= 5;
  preference = Math.max(0, preference);
  let total = Math.max(0, Math.min(100, Math.round(skills + title + location + experience + preference)));
  if (desiredTitles.length && titleOverlap === 0) total = Math.min(total, 49);
  if (!desiredTitles.length && !candidate.length) total = 0;
  const reasons: string[] = [], concerns: string[] = [];
  if (!desiredTitles.length) concerns.push("Choose target roles in Profile; matching is provisional without your preferences.");
  if (!candidate.length) concerns.push("No reviewed skills available. Review your CV or enter skills in Profile.");
  if (desiredTitles.length && titleOverlap === 0) concerns.push("This role does not align with your chosen career targets.");
  if (!requirements?.requiredSkills.length) concerns.push("Required skills not identified; the score is provisional, not proof of eligibility.");
  if (workplaceType === "remote" && !preferredLocationMatched) concerns.push("Remote does not establish hiring eligibility in your country. Check residence and work-authorisation requirements.");
  if (requirements?.qualifications.length) concerns.push("Check mandatory qualifications and professional registrations manually; a fit score does not verify them.");
  if (required.matched.length) reasons.push(`Matched required skills: ${required.matched.slice(0, 6).join(", ")}`);
  if (preferred.matched.length) reasons.push(`Matched preferred skills: ${preferred.matched.slice(0, 5).join(", ")}`);
  if (preferredLocationMatched || remoteLocationCompatible) reasons.push("Location/work arrangement is compatible with your preferences");
  if (requiredYears !== null && candidateExperienceYears >= requiredYears && !skillSpecificYearsUnverified && !impreciseDates) reasons.push(`Experience threshold met (${requiredYears}+ years requested; ${candidateExperienceYears} years supported)`);
  if (titleOverlap >= 0.5) reasons.push("Job title aligns with your chosen target roles");
  if (required.missing.length) concerns.push(`Missing or unverified required skills: ${required.missing.slice(0, 8).join(", ")}`);
  if (skillSpecificYearsUnverified && skillSpecificExperience) concerns.push(`Posting asks for ${skillSpecificExperience.years}+ years specifically in ${skillSpecificExperience.subject}; the CV verifies related experience but does not explicitly date ${skillSpecificExperience.years}+ years of ${skillSpecificExperience.subject} use.`);
  else if (requiredYears !== null && candidateExperienceYears < requiredYears) {
    const sourceLabel = experienceSource === "cv-derived" ? "CV evidence supports" : experienceSource === "profile" ? "profile records" : "no verified experience is recorded; using";
    concerns.push(`Posting requests ${requiredYears}+ years; ${sourceLabel} ${candidateExperienceYears} relevant years`);
  }
  if (!preferredLocationMatched && !remoteLocationCompatible && job.location) concerns.push(`Location may not match your saved preferences: ${job.location}`);
  for (const warning of [...experienceSummary.warnings, ...(requirements?.warnings ?? [])]) concerns.push(warning);
  return { total, skills, title, location, experience: Math.round(experience), preference, candidateExperienceYears,
    candidateTechnicalExperienceYears: experienceSummary.technicalYears, experienceSource, experienceEvidence: experienceSummary.relevantEmployment,
    matchedSkills: unique([...required.matched, ...preferred.matched]), missingSkills: unique([...required.missing, ...preferred.missing]),
    matchedRequiredSkills: required.matched, missingRequiredSkills: required.missing, matchedPreferredSkills: preferred.matched, missingPreferredSkills: preferred.missing,
    reasons, concerns };
}
