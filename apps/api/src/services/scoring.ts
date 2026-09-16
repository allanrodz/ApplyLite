import type { CandidateFacts, JobInput, JobRequirements, Profile, ScoreBreakdown } from "@apply-lite/shared";
import { deriveExperienceSummary } from "./experience.js";

const STOPWORDS = new Set([
  "and", "the", "with", "for", "from", "that", "this", "you", "your", "our",
  "are", "will", "have", "has", "using", "into", "job", "role", "work", "team"
]);

const SKILL_ALIAS_GROUPS = [
  ["javascript", "js"],
  ["typescript", "ts"],
  ["node.js", "nodejs", "node js"],
  ["react", "react.js", "reactjs"],
  ["postgresql", "postgres"],
  ["c#", "csharp"],
  ["c++", "cpp"],
  ["aws", "amazon web services"],
  ["gcp", "google cloud", "google cloud platform"],
  ["ci/cd", "cicd", "continuous integration", "continuous delivery"],
  ["rest api", "restful api", "rest"],
  ["machine learning", "ml"],
  ["artificial intelligence", "ai"]
];

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#./\- ]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenSet(value: string) {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 1 && !STOPWORDS.has(token)));
}

function canonicalSkill(value: string) {
  const normalized = normalize(value);
  for (const group of SKILL_ALIAS_GROUPS) {
    if (group.some((alias) => normalize(alias) === normalized)) return normalize(group[0]);
  }
  return normalized;
}

function skillMatches(candidateSkill: string, jobSkill: string) {
  const candidate = canonicalSkill(candidateSkill);
  const required = canonicalSkill(jobSkill);
  if (!candidate || !required) return false;
  if (candidate === required || candidate.includes(required) || required.includes(candidate)) return true;

  const candidateTokens = tokenSet(candidate);
  const requiredTokens = [...tokenSet(required)];
  return requiredTokens.length > 0 && requiredTokens.every((token) => candidateTokens.has(token));
}

function includesLoose(haystack: string, needle: string) {
  const h = normalize(haystack);
  const n = normalize(needle);
  return n.length > 0 && (h.includes(n) || n.split(" ").every((part) => h.includes(part)));
}

function extractExperienceYears(text: string): number | null {
  const matches = [...text.matchAll(/(\d{1,2})\+?\s*(?:years?|yrs?)/gi)].map((match) => Number(match[1]));
  return matches.length ? Math.min(...matches) : null;
}


type SkillSpecificExperienceRequirement = { years: number; subject: string };

function cleanExperienceSubject(value: string) {
  return value
    .replace(/\b(?:experience|required|preferred|minimum|professional|hands-on)\b.*$/i, "")
    .replace(/\s+(?:and|plus|with)\s+.*$/i, "")
    .replace(/[.;,:].*$/, "")
    .trim();
}

function extractSkillSpecificExperienceRequirement(text: string, requiredSkills: string[]): SkillSpecificExperienceRequirement | null {
  const patterns = [
    /(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\+?\s*(?:years?|yrs?)\s+(?:of\s+)?([a-z0-9+#./ -]{2,50}?)\s+experience\b/i,
    /(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience\s+(?:with|in|using)\s+([a-z0-9+#./ -]{2,50})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const years = Number(match[1]);
    const subject = cleanExperienceSubject(match[2]);
    if (!subject || !Number.isFinite(years)) continue;
    const subjectIsRequiredSkill = requiredSkills.some((skill) => skillMatches(subject, skill) || skillMatches(skill, subject));
    if (subjectIsRequiredSkill) return { years, subject };
  }
  return null;
}

function explicitSubjectYearsInCv(facts: CandidateFacts | null | undefined, subject: string) {
  if (!facts) return 0;
  const snippets = [
    facts.summary,
    facts.headline,
    ...facts.employment.flatMap((entry) => entry.bullets),
    ...facts.projects.flatMap((project) => [project.description, ...project.bullets])
  ].filter(Boolean);
  const subjectTokens = [...tokenSet(subject)];
  let best = 0;
  for (const snippet of snippets) {
    const normalized = normalize(snippet);
    if (!subjectTokens.length || !subjectTokens.every((token) => normalized.includes(token))) continue;
    const years = extractExperienceYears(snippet);
    if (years !== null) best = Math.max(best, years);
  }
  return best;
}

function unique(values: string[]) {
  const seen = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) seen.set(canonicalSkill(trimmed), trimmed);
  }
  return [...seen.values()];
}

function candidateSkills(profile: Profile, facts?: CandidateFacts | null) {
  return unique([
    ...profile.skills,
    ...(facts?.skills ?? []),
    ...(facts?.projects.flatMap((project) => project.technologies) ?? [])
  ]);
}

function partitionSkills(jobSkills: string[], candidate: string[]) {
  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of unique(jobSkills)) {
    if (candidate.some((candidateSkill) => skillMatches(candidateSkill, skill))) matched.push(skill);
    else missing.push(skill);
  }
  return { matched, missing };
}

export function scoreJob(
  profile: Profile,
  job: JobInput,
  requirements?: JobRequirements | null,
  facts?: CandidateFacts | null
): ScoreBreakdown {
  const candidate = candidateSkills(profile, facts);
  const jobText = `${job.title} ${job.description}`;
  const required = partitionSkills(requirements?.requiredSkills ?? [], candidate);
  const preferred = partitionSkills(requirements?.preferredSkills ?? [], candidate);

  let skills: number;
  if ((requirements?.requiredSkills.length ?? 0) > 0) {
    const requiredRatio = required.matched.length / Math.max(1, requirements!.requiredSkills.length);
    const preferredRatio = requirements!.preferredSkills.length
      ? preferred.matched.length / requirements!.preferredSkills.length
      : 1;
    skills = Math.round(requiredRatio * 30 + preferredRatio * 10);
  } else if ((requirements?.preferredSkills.length ?? 0) > 0) {
    const ratio = preferred.matched.length / Math.max(1, requirements!.preferredSkills.length);
    skills = Math.round(10 + ratio * 30);
  } else {
    const mentionedCandidateSkills = candidate.filter((skill) => includesLoose(jobText, skill));
    skills = Math.min(40, 20 + mentionedCandidateSkills.length * 4);
  }

  const desiredTitles = [profile.currentTitle, ...profile.targetTitles].filter(Boolean);
  const jobTitleTokens = tokenSet(job.title);
  const titleOverlap = desiredTitles.reduce((best, desiredTitle) => {
    const tokens = [...tokenSet(desiredTitle)];
    if (!tokens.length) return best;
    const overlap = tokens.filter((token) => jobTitleTokens.has(token)).length / tokens.length;
    return Math.max(best, overlap);
  }, 0);
  const title = desiredTitles.length ? Math.round(titleOverlap * 20) : 10;

  const locationText = normalize(job.location);
  const workplaceType = requirements?.workplaceType ?? "unknown";
  const preferredLocationMatched = !profile.preferredLocations.length ||
    profile.preferredLocations.some((location) => locationText.includes(normalize(location)));
  const remoteLocationCompatible = workplaceType === "remote" && ["any", "remote"].includes(profile.remotePreference);
  const location = preferredLocationMatched || remoteLocationCompatible ? 10 : locationText ? 3 : 6;

  const experienceSummary = deriveExperienceSummary(facts, job, requirements);
  const cvDerivedAvailable = Boolean(facts && experienceSummary.parseableEmploymentCount > 0);
  const derivedRelevantYears = experienceSummary.relevantYears;
  const candidateExperienceYears = cvDerivedAvailable && derivedRelevantYears > 0
    ? derivedRelevantYears
    : profile.yearsExperience;
  const experienceSource: ScoreBreakdown["experienceSource"] = cvDerivedAvailable && derivedRelevantYears > 0
    ? "cv-derived"
    : profile.yearsExperience > 0
      ? "profile"
      : "unknown";

  const requiredYears = requirements?.requiredExperienceYears ?? extractExperienceYears(job.description);
  const skillSpecificExperience = extractSkillSpecificExperienceRequirement(job.description, requirements?.requiredSkills ?? []);
  const explicitSkillYears = skillSpecificExperience ? explicitSubjectYearsInCv(facts, skillSpecificExperience.subject) : 0;
  const skillSpecificYearsUnverified = Boolean(
    skillSpecificExperience
    && explicitSkillYears < skillSpecificExperience.years
    && candidateExperienceYears >= skillSpecificExperience.years
  );
  const experience = requiredYears === null
    ? 12
    : skillSpecificYearsUnverified
      ? 9
      : candidateExperienceYears >= requiredYears
        ? 15
        : Math.max(0, 15 - (requiredYears - candidateExperienceYears) * 5);

  let preference = 15;
  if (profile.remotePreference !== "any" && workplaceType !== "unknown" && workplaceType !== profile.remotePreference) {
    preference -= 5;
  }
  const seniorityText = `${requirements?.seniority ?? ""} ${job.title}`;
  if (/senior|staff|principal|lead|manager/i.test(seniorityText) && candidateExperienceYears > 0 && candidateExperienceYears < 4) {
    preference -= 5;
  }
  preference = Math.max(0, preference);

  const total = Math.max(0, Math.min(100, Math.round(skills + title + location + experience + preference)));
  const reasons: string[] = [];
  const concerns: string[] = [];

  if (required.matched.length) reasons.push(`Matched required skills: ${required.matched.slice(0, 6).join(", ")}`);
  if (preferred.matched.length) reasons.push(`Matched preferred skills: ${preferred.matched.slice(0, 5).join(", ")}`);
  if (preferredLocationMatched || remoteLocationCompatible) reasons.push("Location/work arrangement is compatible with your preferences");
  if (requiredYears !== null && candidateExperienceYears >= requiredYears && !skillSpecificYearsUnverified) {
    reasons.push(`Experience threshold met (${requiredYears}+ years requested; ${candidateExperienceYears} years supported)`);
  }
  if (titleOverlap >= 0.5) reasons.push("Job title overlaps with a current or target title");

  if (required.missing.length) concerns.push(`Missing or unverified required skills: ${required.missing.slice(0, 8).join(", ")}`);
  if (skillSpecificYearsUnverified && skillSpecificExperience) {
    concerns.push(`Posting asks for ${skillSpecificExperience.years}+ years specifically in ${skillSpecificExperience.subject}; the CV verifies related experience but does not explicitly date ${skillSpecificExperience.years}+ years of ${skillSpecificExperience.subject} use.`);
  } else if (requiredYears !== null && candidateExperienceYears < requiredYears) {
    const sourceLabel = experienceSource === "cv-derived" ? "CV evidence supports" : experienceSource === "profile" ? "profile records" : "no verified experience is recorded; using";
    concerns.push(`Posting requests ${requiredYears}+ years; ${sourceLabel} ${candidateExperienceYears} relevant years`);
  }
  if (!preferredLocationMatched && !remoteLocationCompatible && job.location) concerns.push(`Location may not match your saved preferences: ${job.location}`);
  for (const warning of requirements?.warnings ?? []) concerns.push(warning);

  const matchedSkills = unique([...required.matched, ...preferred.matched]);
  const missingSkills = unique([...required.missing, ...preferred.missing]);

  return {
    total,
    skills,
    title,
    location,
    experience: Math.round(experience),
    preference,
    candidateExperienceYears,
    candidateTechnicalExperienceYears: experienceSummary.technicalYears,
    experienceSource,
    experienceEvidence: experienceSummary.relevantEmployment,
    matchedSkills,
    missingSkills,
    matchedRequiredSkills: required.matched,
    missingRequiredSkills: required.missing,
    matchedPreferredSkills: preferred.matched,
    missingPreferredSkills: preferred.missing,
    reasons,
    concerns
  };
}
