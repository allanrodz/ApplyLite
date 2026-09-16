import { targets, planCareerQueries, careerFamilies } from "./matching.js";
import { createHash } from "node:crypto";
import type {
  CandidateFacts,
  DiscoveryRunInput,
  DiscoverySource,
  JobRequirements,
  Profile
} from "@apply-lite/shared";
import { JobInputSchema, ProfileSchema, CandidateFactsSchema, JobRequirementsSchema } from "@apply-lite/shared";
import { db } from "../db/database.js";
import { deriveExperienceSummary } from "./experience.js";
import { extractRequirementsFromEvidence, type JobPageEvidence } from "./jobImport.js";
import { scoreJob } from "./scoring.js";
import { applyOutcomeLearning, buildOutcomeLearningModel } from "./outcomeLearning.js";

const SOURCE_TIMEOUT_MS = 20_000;
const MAX_POSTINGS_PER_SOURCE = 500;
const MAX_PUBLIC_SEARCH_QUERIES = 18;
const PUBLIC_SEARCH_CONCURRENCY = 4;
const MAX_PUBLIC_DETAIL_FETCHES = 72;
const REMOTE_FEED_MAX_AGE_DAYS = 180;

type DiscoveryAts = "lever" | "ashby" | "greenhouse" | "jobsireland" | "irishjobs" | "remoteok";

type DiscoveryPosting = {
  title: string;
  company: string;
  location: string;
  salaryText: string;
  description: string;
  sourceUrl: string;
  ats: DiscoveryAts;
  evidence: JobPageEvidence;
};

type SourceDescriptor = {
  ats: DiscoveryAts;
  boardKey: string;
  name: string;
  boardUrl: string;
};

type LeverPosting = {
  id?: string;
  text?: string;
  categories?: {
    location?: string;
    commitment?: string;
    team?: string;
    department?: string;
    allLocations?: string[];
  };
  openingPlain?: string;
  descriptionPlain?: string;
  descriptionBodyPlain?: string;
  additionalPlain?: string;
  hostedUrl?: string;
  applyUrl?: string;
  workplaceType?: string;
  salaryDescriptionPlain?: string;
  lists?: Array<{ text?: string; content?: string }>;
};

type AshbyPosting = {
  title?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  department?: string;
  team?: string;
  isRemote?: boolean;
  workplaceType?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  employmentType?: string;
  jobUrl?: string;
  applyUrl?: string;
  isListed?: boolean;
  compensation?: {
    compensationTierSummary?: string;
    scrapeableCompensationSalarySummary?: string;
  };
};

type GreenhousePosting = {
  id?: number;
  title?: string;
  location?: { name?: string };
  content?: string;
  absolute_url?: string;
  updated_at?: string;
  departments?: Array<{ name?: string }>;
  offices?: Array<{ name?: string; location?: string }>;
};

type RemoteOkPosting = {
  id?: string | number;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
  apply_url?: string;
};

function compactText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value: string) {
  return compactText(decodeEntities(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " "));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#./ -]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string) {
  const stop = new Set(["the", "and", "for", "with", "of", "a", "an", "to", "in", "at", "senior", "junior", "jr", "sr", "ii", "iii"]);
  return normalize(value).split(" ").filter((token) => token.length > 2 && !stop.has(token));
}

type RoleFamily = "software" | "ai" | "data" | "qa" | "cloud" | "support" | "project" | "it" | "security";

const ROLE_FAMILY_RULES: Array<{ family: RoleFamily; pattern: RegExp }> = [
  { family: "software", pattern: /\b(software|developer|development|frontend|front end|backend|back end|full[ -]?stack|web developer|application developer|platform engineer|api engineer|forward deployed engineer)\b/i },
  { family: "ai", pattern: /\b(ai|artificial intelligence|machine learning|ml engineer|genai|generative ai|llm|agentic|prompt engineer)\b/i },
  { family: "data", pattern: /\b(data engineer|data analyst|data scientist|analytics engineer|business intelligence|bi developer|quantitative developer)\b/i },
  { family: "qa", pattern: /\b(qa|quality assurance|test engineer|testing engineer|test automation|automation engineer|sdet)\b/i },
  { family: "cloud", pattern: /\b(devops|site reliability|sre|cloud engineer|cloud support|infrastructure engineer|platform reliability|platform infrastructure)\b/i },
  { family: "support", pattern: /\b(technical support|application support|support engineer|support analyst|solutions engineer|solution engineer|customer engineer|customer support engineer|technical success|implementation engineer|integration engineer|service desk|help desk|helpdesk|desktop support|forward deployed engineer)\b/i },
  { family: "project", pattern: /\b(project manager|project coordinator|technical project coordinator|program manager|programme manager|technical program|technical programme|delivery manager|scrum master|product owner|implementation manager|pmo(?: analyst)?)\b/i },
  { family: "it", pattern: /\b(it support|information technology|it analyst|technology analyst|it technician|systems? support|systems? analyst|business systems analyst|systems administrator|system administrator|desktop support|service desk|help desk|helpdesk|it operations|information systems)\b/i },
  { family: "security", pattern: /\b(cybersecurity|cyber security|security engineer|security analyst|soc analyst|application security|information security)\b/i }
];

const ROLE_FAMILY_SEARCH_QUERIES: Record<RoleFamily, string[]> = {
  software: [
    "junior software developer",
    "software engineer",
    "frontend developer",
    "web developer",
    "full stack developer",
    "application developer"
  ],
  ai: [
    "junior AI engineer",
    "AI engineer",
    "machine learning engineer",
    "AI automation engineer"
  ],
  data: [
    "junior data analyst",
    "data analyst",
    "business intelligence analyst",
    "analytics engineer"
  ],
  qa: [
    "junior QA engineer",
    "test engineer",
    "software tester",
    "test automation engineer"
  ],
  cloud: [
    "junior cloud engineer",
    "cloud support engineer",
    "junior devops",
    "infrastructure support"
  ],
  support: [
    "technical support engineer",
    "application support",
    "support engineer",
    "service desk analyst",
    "help desk",
    "implementation engineer"
  ],
  project: [
    "project coordinator",
    "technical project coordinator",
    "IT project coordinator",
    "PMO analyst"
  ],
  it: [
    "IT support",
    "IT technician",
    "service desk analyst",
    "technology analyst",
    "IT analyst",
    "systems support"
  ],
  security: [
    "junior security analyst",
    "cyber security analyst",
    "SOC analyst",
    "information security analyst"
  ]
};

const GENERIC_TITLE_TOKENS = new Set([
  "engineer", "engineering", "manager", "management", "specialist", "analyst", "associate",
  "lead", "leader", "consultant", "technical", "technology", "product", "operations", "support"
]);

function roleFamilies(value: string) {
  const families = new Set<RoleFamily>();
  for (const rule of ROLE_FAMILY_RULES) if (rule.pattern.test(value)) families.add(rule.family);
  return families;
}

function pushUnique(values: string[], value: string) {
  const cleaned = compactText(value);
  if (!cleaned) return;
  const key = normalize(cleaned);
  if (!key || values.some((item) => normalize(item) === key)) return;
  values.push(cleaned);
}

export function buildDiscoverySearchQueries(targetTitles: string[], maxQueries = 18, broadEntryLevelIT = false) {
  return broadEntryLevelIT ? legacyDiscoverySearchQueries(targetTitles, maxQueries, true) : planCareerQueries(targetTitles, maxQueries);
}

function legacyDiscoverySearchQueries(
  targetTitles: string[],
  maxQueries = MAX_PUBLIC_SEARCH_QUERIES,
  broadEntryLevelIT = true
) {
  const sourceTitles = targetTitles.length
    ? targetTitles
    : ["Software Developer", "Technical Support Engineer", "IT Support", "QA Engineer", "Project Coordinator", "AI Engineer"];

  const familyOrder: RoleFamily[] = [];
  const buckets = new Map<RoleFamily, string[]>();
  const unmatched: string[] = [];

  for (const title of sourceTitles) {
    const families = [...roleFamilies(title)];
    if (!families.length) {
      pushUnique(unmatched, title);
      continue;
    }
    for (const family of families) {
      if (!familyOrder.includes(family)) familyOrder.push(family);
      const bucket = buckets.get(family) ?? [];
      pushUnique(bucket, title);
      buckets.set(family, bucket);
    }
  }

  if (broadEntryLevelIT) {
    // Target titles remain first, but Discover mode deliberately covers the adjacent entry-level IT market
    // too. This prevents a CV with many software-title variants from starving support/data/cloud/security
    // searches before the public-board query budget is exhausted.
    for (const family of Object.keys(ROLE_FAMILY_SEARCH_QUERIES) as RoleFamily[]) {
      if (!familyOrder.includes(family)) familyOrder.push(family);
    }
  }

  for (const family of familyOrder) {
    const bucket = buckets.get(family) ?? [];
    for (const alias of ROLE_FAMILY_SEARCH_QUERIES[family]) pushUnique(bucket, alias);
    buckets.set(family, bucket);
  }

  const queries: string[] = [];
  let round = 0;
  while (queries.length < maxQueries) {
    let added = false;
    for (const family of familyOrder) {
      const candidate = buckets.get(family)?.[round];
      if (!candidate) continue;
      const before = queries.length;
      pushUnique(queries, candidate);
      if (queries.length > before) added = true;
      if (queries.length >= maxQueries) break;
    }
    if (!added) break;
    round += 1;
  }

  for (const title of unmatched) {
    if (queries.length >= maxQueries) break;
    pushUnique(queries, title);
  }

  // Keep a few high-yield broad entry-level IT searches available even when the saved profile
  // is dominated by one family (for example five variations of "Software Engineer").
  for (const fallback of ["graduate technology", "entry level IT", "junior IT", "technical support", "software graduate"]) {
    if (queries.length >= maxQueries) break;
    pushUnique(queries, fallback);
  }

  return queries.slice(0, Math.max(1, maxQueries));
}

function buildDiscoveryAlignmentTitles(targetTitles: string[], broadEntryLevelIT: boolean) {
  if (!broadEntryLevelIT) return targetTitles;
  const titles: string[] = [];
  for (const title of targetTitles) pushUnique(titles, title);
  for (const family of Object.keys(ROLE_FAMILY_SEARCH_QUERIES) as RoleFamily[]) {
    for (const alias of ROLE_FAMILY_SEARCH_QUERIES[family]) pushUnique(titles, alias);
  }
  return titles;
}

function requestedExperienceYears(description: string) {
  const values: number[] = [];
  const patterns = [
    /(?:minimum(?:\s+of)?|at least|requires?|requiring)\s*(\d{1,2})\+?\s*(?:years?|yrs?)/gi,
    /(\d{1,2})\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:professional|commercial|industry|relevant|overall|general|technical|engineering|software|work|hands-on))?\s+experience/gi,
    /(\d{1,2})\+?\s*(?:years?|yrs?)\s+(?:using|with|in)\b/gi
  ];
  for (const pattern of patterns) {
    for (const match of description.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value >= 0 && value <= 30) values.push(value);
    }
  }
  // When a posting lists multiple minimums (for example 5 years overall and 2 years React),
  // the highest explicit requirement is the safest signal for an entry-level-only search.
  return values.length ? Math.max(...values) : null;
}

export function entryLevelEligibility(title: string, description = "") {
  const normalizedTitle = normalize(title);
  const earlyTitle = /\b(junior|jr\.?|graduate|entry[ -]?level|associate|apprentice|trainee|intern(?:ship)?|level 1|level i)\b/i.test(title)
    || /\b(engineer|developer)\s+i\b/i.test(title);
  const hardSeniorTitle = /\b(senior|sr\.?|staff|principal|lead|director|head of|vice president|vp|chief|architect)\b/i.test(title);
  const midLevelTitle = /\b(mid(?:dle)?[ -]?level|intermediate|level 2|level ii|level 3|level iii|engineer ii|engineer iii|developer ii|developer iii)\b/i.test(title);
  const managerialTitle = /\bmanager\b/i.test(title) && !earlyTitle;
  const minYears = requestedExperienceYears(description);

  if (hardSeniorTitle) return { allowed: false, earlyCareer: false, minYears, reason: "senior-title" };
  if (managerialTitle) return { allowed: false, earlyCareer: false, minYears, reason: "manager-title" };
  if (midLevelTitle && !earlyTitle) return { allowed: false, earlyCareer: false, minYears, reason: "mid-level-title" };
  if (minYears !== null && minYears >= 4) return { allowed: false, earlyCareer: false, minYears, reason: "experience-requirement" };

  const earlyCareer = earlyTitle || (minYears !== null && minYears <= 3) || !/\b(mid(?:dle)?[ -]?level|intermediate)\b/.test(normalizedTitle);
  return { allowed: true, earlyCareer, minYears, reason: earlyTitle ? "entry-title" : minYears !== null ? "experience-compatible" : "no-senior-signal" };
}

function meaningfulTitleTokens(value: string) {
  return tokens(value).filter((token) => !GENERIC_TITLE_TOKENS.has(token));
}

export function titleAlignmentScore(postingTitle: string, targetTitles: string[]) {
  if (!targetTitles.length) return { score: 20, aligned: true };

  const postingNormalized = normalize(postingTitle);
  const postingFamilies = roleFamilies(postingTitle);
  const postingMeaningful = new Set(meaningfulTitleTokens(postingTitle));
  let best = 0;
  let aligned = false;

  for (const target of targetTitles) {
    const targetNormalized = normalize(target);
    if (!targetNormalized) continue;

    if (postingMeaningful.size > 0 && (postingNormalized.includes(targetNormalized) || targetNormalized.includes(postingNormalized))) {
      best = Math.max(best, 45);
      aligned = true;
      continue;
    }

    const targetFamilies = roleFamilies(target);
    const familyMatch = [...targetFamilies].some((family) => postingFamilies.has(family)) || careerFamilies(target).some(key => careerFamilies(postingTitle).includes(key));
    const targetMeaningful = meaningfulTitleTokens(target);
    const overlap = targetMeaningful.length
      ? targetMeaningful.filter((token) => postingMeaningful.has(token)).length / targetMeaningful.length
      : 0;

    if (familyMatch || overlap >= 0.34) aligned = true;
    if (familyMatch) best = Math.max(best, 26 + Math.round(overlap * 19));
    else if (overlap > 0) best = Math.max(best, Math.round(overlap * 35));
  }

  return { score: Math.min(45, best), aligned };
}

function loadProfile() {
  const row = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
  return row ? ProfileSchema.parse(JSON.parse(row.data_json)) : ProfileSchema.parse({});
}

function loadCandidateFacts(): CandidateFacts | null {
  const row = db.prepare("SELECT facts_json AS factsJson FROM cv_documents ORDER BY id DESC LIMIT 1").get() as { factsJson: string } | undefined;
  if (!row) return null;
  const parsed = CandidateFactsSchema.safeParse(JSON.parse(row.factsJson));
  return parsed.success ? parsed.data : null;
}

function sourceRow(row: Record<string, unknown>): DiscoverySource {
  return {
    id: Number(row.id),
    ats: String(row.ats) as DiscoverySource["ats"],
    boardKey: String(row.boardKey),
    name: String(row.name),
    boardUrl: String(row.boardUrl),
    enabled: Boolean(row.enabled),
    learned: Boolean(row.learned),
    lastScanAt: row.lastScanAt ? String(row.lastScanAt) : null,
    lastError: row.lastError ? String(row.lastError) : null
  };
}

export function listDiscoverySources(): DiscoverySource[] {
  const rows = db.prepare(`
    SELECT id, ats, board_key AS boardKey, name, board_url AS boardUrl, enabled, learned,
           last_scan_at AS lastScanAt, last_error AS lastError
    FROM discovery_sources ORDER BY enabled DESC, name ASC
  `).all() as Array<Record<string, unknown>>;
  return rows.map(sourceRow);
}

export function parseDiscoverySourceUrl(rawUrl: string, suggestedName = ""): SourceDescriptor {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Paste a valid Lever, Ashby, Greenhouse, JobsIreland, IrishJobs, or Remote OK URL.");
  }

  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const boardKey = parts[0];
    if (!boardKey) throw new Error("Could not identify the Lever company site from this URL.");
    return {
      ats: "lever",
      boardKey,
      name: suggestedName.trim() || boardKey,
      boardUrl: `${url.protocol}//${host}/${boardKey}`
    };
  }

  if (host === "jobs.ashbyhq.com") {
    const boardKey = parts[0];
    if (!boardKey) throw new Error("Could not identify the Ashby job board from this URL.");
    return {
      ats: "ashby",
      boardKey,
      name: suggestedName.trim() || boardKey,
      boardUrl: `https://jobs.ashbyhq.com/${boardKey}`
    };
  }

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const boardKey = parts[0];
    if (!boardKey) throw new Error("Could not identify the Greenhouse board token from this URL.");
    return {
      ats: "greenhouse",
      boardKey,
      name: suggestedName.trim() || boardKey,
      boardUrl: `${url.protocol}//${host}/${boardKey}`
    };
  }

  if (host === "jobsireland.ie" || host === "www.jobsireland.ie") {
    return {
      ats: "jobsireland",
      boardKey: "ireland",
      name: suggestedName.trim() || "JobsIreland",
      boardUrl: "https://jobsireland.ie/en-US/browse-jobs"
    };
  }

  if (host === "irishjobs.ie" || host === "www.irishjobs.ie") {
    return {
      ats: "irishjobs",
      boardKey: "ireland",
      name: suggestedName.trim() || "IrishJobs",
      boardUrl: "https://www.irishjobs.ie/jobs"
    };
  }

  if (host === "remoteok.com" || host === "www.remoteok.com") {
    return {
      ats: "remoteok",
      boardKey: "global",
      name: suggestedName.trim() || "Remote OK",
      boardUrl: "https://remoteok.com/"
    };
  }

  throw new Error("Automatic discovery currently supports public Lever, Ashby, Greenhouse, JobsIreland, IrishJobs, and Remote OK URLs.");
}

export function rememberDiscoverySourceFromUrl(rawUrl: string, suggestedName = "", learned = true): DiscoverySource | null {
  let descriptor: SourceDescriptor;
  try {
    descriptor = parseDiscoverySourceUrl(rawUrl, suggestedName);
  } catch {
    return null;
  }

  db.prepare(`
    INSERT INTO discovery_sources (ats, board_key, name, board_url, enabled, learned)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(ats, board_key) DO UPDATE SET
      name = CASE WHEN excluded.name <> discovery_sources.board_key THEN excluded.name ELSE discovery_sources.name END,
      board_url = excluded.board_url,
      updated_at = CURRENT_TIMESTAMP
  `).run(descriptor.ats, descriptor.boardKey, descriptor.name, descriptor.boardUrl, learned ? 1 : 0);

  const row = db.prepare(`
    SELECT id, ats, board_key AS boardKey, name, board_url AS boardUrl, enabled, learned,
           last_scan_at AS lastScanAt, last_error AS lastError
    FROM discovery_sources WHERE ats = ? AND board_key = ?
  `).get(descriptor.ats, descriptor.boardKey) as Record<string, unknown>;
  return sourceRow(row);
}

export const STARTER_DISCOVERY_SOURCES = [
  ["https://jobs.lever.co/dnb", "Dun & Bradstreet"],
  ["https://jobs.lever.co/cartrawler", "CarTrawler"],
  ["https://jobs.ashbyhq.com/zerorisk", "ZeroRisk"],
  ["https://jobs.ashbyhq.com/kota", "Kota"],
  ["https://jobs.ashbyhq.com/openai", "OpenAI"],
  ["https://jobs.ashbyhq.com/whatnot", "Whatnot"],
  ["https://jobs.ashbyhq.com/omni", "Omni"],
  ["https://job-boards.greenhouse.io/intercom", "Fin / Intercom"],
  ["https://job-boards.greenhouse.io/telnyx54", "Telnyx"],
  ["https://job-boards.greenhouse.io/sonyinteractiveentertainmentglobal", "PlayStation"],
  ["https://job-boards.greenhouse.io/newrelic", "New Relic"],
  ["https://job-boards.greenhouse.io/intersystems", "InterSystems"],
  ["https://job-boards.greenhouse.io/sonatus", "Sonatus"],
  ["https://job-boards.greenhouse.io/anthropic", "Anthropic"],
  ["https://job-boards.greenhouse.io/2k", "2K"],
  ["https://job-boards.greenhouse.io/xai", "xAI"],
  ["https://job-boards.greenhouse.io/bearingpoint", "BearingPoint Ireland"],
  ["https://job-boards.greenhouse.io/ridgeline", "Ridgeline"],
  ["https://jobsireland.ie/en-US/browse-jobs", "JobsIreland"],
  ["https://www.irishjobs.ie/jobs", "IrishJobs"],
  ["https://remoteok.com/", "Remote OK"]
] as const;

export function bootstrapDiscoverySources() {
  // Curated Ireland/Dublin technology catalogue. Most entries are direct employer ATS boards;
  // JobsIreland and IrishJobs add broader Irish-market coverage. More supported sources are still
  // learned automatically from URLs the user imports.
  for (const [url, name] of STARTER_DISCOVERY_SOURCES) {
    rememberDiscoverySourceFromUrl(url, name, false);
  }

  db.prepare("UPDATE discovery_sources SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE ats = 'ashby' AND board_key = 'whatnot' AND learned = 0").run();

  const existing = db.prepare("SELECT source_url AS sourceUrl, company FROM jobs WHERE source_url <> ''").all() as Array<{ sourceUrl: string; company: string }>;
  for (const row of existing) rememberDiscoverySourceFromUrl(row.sourceUrl, row.company, true);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "ApplyLite/0.4 local-job-discovery" },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json() as Promise<T>;
}


async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-IE,en;q=0.9",
      "user-agent": "ApplyLite/0.14.3 local-job-discovery"
    },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.text();
}

function htmlText(value: string) {
  return compactText(decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:div|p|li|section|article|main|h[1-6]|ul|ol|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
}

function htmlAttribute(value: string, attribute: string) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`${escaped}=["']([^"']+)["']`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

function metaContent(html: string, key: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = htmlAttribute(tag, "name") || htmlAttribute(tag, "property");
    if (name.toLowerCase() === key.toLowerCase()) return htmlAttribute(tag, "content");
  }
  return "";
}

function firstHeading(html: string) {
  for (const match of html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const text = stripHtml(match[1]);
    if (text.length >= 3 && !/search for your next job|similar jobs|recommended jobs/i.test(text)) return text;
  }
  return "";
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return record;
  if (record["@graph"]) return findJobPosting(record["@graph"]);
  return null;
}

function extractJobPostingJsonLd(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1]).trim());
      const found = findJobPosting(parsed);
      if (found) return found;
    } catch {
      // Public job boards occasionally emit malformed analytics JSON-LD. Ignore it and use HTML fallbacks.
    }
  }
  return null;
}

function structuredName(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name.trim() : "";
}

function structuredLocation(value: unknown): string {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const locations: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const address = record.address;
    if (typeof address === "string") {
      locations.push(address);
      continue;
    }
    if (!address || typeof address !== "object") continue;
    const a = address as Record<string, unknown>;
    const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
      .flatMap((part) => typeof part === "string" ? [part.trim()] : part && typeof part === "object" && typeof (part as Record<string, unknown>).name === "string" ? [String((part as Record<string, unknown>).name).trim()] : [])
      .filter(Boolean);
    if (parts.length) locations.push(parts.join(", "));
  }
  return [...new Set(locations)].join("; ");
}

function buildPublicBoardPosting(
  source: DiscoverySource,
  url: string,
  html: string,
  fallback: { title?: string; company?: string; location?: string } = {}
): DiscoveryPosting | null {
  const structured = extractJobPostingJsonLd(html);
  const visible = htmlText(html);
  const title = (typeof structured?.title === "string" ? structured.title : "") || fallback.title || firstHeading(html) || metaContent(html, "og:title");
  if (!title) return null;
  const lines = visible.split("\n").map((line) => line.trim()).filter(Boolean);
  const titleIndex = lines.findIndex((line) => normalize(line) === normalize(title));
  const nearby = titleIndex >= 0 ? lines.slice(titleIndex + 1, titleIndex + 18) : lines.slice(0, 24);
  const inferredLocation = nearby.find((line) => /\b(dublin|county dublin|ireland|cork|galway|limerick|waterford|remote|work from home)\b/i.test(line) && line.length < 180) ?? "";
  const inferredCompany = nearby.find((line) => line.length >= 2 && line.length < 120 && line !== inferredLocation && !/^(permanent|contract|temporary|part[ -]?time|full[ -]?time|published|salary|€|apply|job details)/i.test(line)) ?? "";
  const company = structuredName(structured?.hiringOrganization) || fallback.company || inferredCompany || source.name;
  const location = structuredLocation(structured?.jobLocation) || fallback.location || inferredLocation || "";
  const structuredDescription = typeof structured?.description === "string" ? stripHtml(structured.description) : "";
  const description = compactText(structuredDescription || visible).slice(0, 32_000);
  if (description.length < 80) return null;
  const salaryText = "";
  const base = {
    title: compactText(title),
    company: compactText(company),
    location: compactText(location),
    salaryText,
    description,
    sourceUrl: url,
    ats: source.ats as DiscoveryAts
  };
  return { ...base, evidence: makeEvidence(base, structured ?? { source: source.name }) };
}

function searchLocation(locations: string[]) {
  const physical = locations.map((item) => item.trim()).filter((item) => item && normalize(item) !== "remote");
  const ireland = physical.find((item) => /\b(ireland|eire)\b/i.test(item));
  if (ireland) return "Ireland";
  const dublin = physical.find((item) => /\bdublin\b/i.test(item));
  if (dublin) return "Dublin";
  return physical[0] || "Dublin";
}

function slugifySearch(value: string) {
  return normalize(value).replace(/[+#./]/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function jobsIrelandLeads(html: string) {
  const leads = new Map<string, { id: string; title: string; location: string }>();
  // JobsIreland embeds map rows as: lat;long;address;title;numeric-id;#JOB-id.
  const rowPattern = /-?\d+(?:\.\d+)?;-?\d+(?:\.\d+)?;([^;<>\r\n]{0,350});([^;<>\r\n]{2,220});(\d{6,9});#(?:JOB|CES|SEMP)-\d+/g;
  for (const match of html.matchAll(rowPattern)) {
    leads.set(match[3], { id: match[3], location: decodeEntities(match[1]).trim(), title: decodeEntities(match[2]).trim() });
  }
  for (const match of html.matchAll(/job-Details\?id=(\d{6,9})/gi)) {
    if (!leads.has(match[1])) leads.set(match[1], { id: match[1], title: "", location: "" });
  }
  return [...leads.values()];
}

async function fetchJobsIreland(source: DiscoverySource, alignmentTitles: string[], searchQueries: string[], locations: string[]): Promise<DiscoveryPosting[]> {
  const queries = searchQueries;
  const location = searchLocation(locations);
  const leads = new Map<string, { id: string; title: string; location: string }>();

  await mapWithConcurrency(queries, PUBLIC_SEARCH_CONCURRENCY, async (query) => {
    const url = new URL("https://jobsireland.ie/en-US/browse-jobs");
    url.searchParams.set("CareerlevelId", "-1");
    url.searchParams.set("ContractTypeId", "");
    url.searchParams.set("NaceCode", "-1");
    url.searchParams.set("RemoteOrBlendedJobType", "-1");
    url.searchParams.set("VacancyTypeId", "0");
    url.searchParams.set("keyWord", query);
    url.searchParams.set("location", location);
    url.searchParams.set("page", "1");
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("vacancyId", "-1");
    try {
      const html = await fetchText(url.toString());
      for (const lead of jobsIrelandLeads(html)) {
        if (lead.title && !titleAlignmentScore(lead.title, alignmentTitles).aligned) continue;
        leads.set(lead.id, lead);
      }
    } catch {
      // Continue with other title queries if one public search URL is temporarily unavailable.
    }
  });

  const results: DiscoveryPosting[] = [];
  const selected = [...leads.values()].slice(0, MAX_PUBLIC_DETAIL_FETCHES);
  await mapWithConcurrency(selected, 6, async (lead) => {
    try {
      const url = `https://jobsireland.ie/en-US/job-Details?id=${encodeURIComponent(lead.id)}`;
      const html = await fetchText(url);
      const posting = buildPublicBoardPosting(source, url, html, { title: lead.title, location: lead.location });
      if (posting && (!alignmentTitles.length || titleAlignmentScore(posting.title, alignmentTitles).aligned)) results.push(posting);
    } catch {
      // One expired vacancy should not fail the whole national source.
    }
  });
  return results;
}

function irishJobsLinks(html: string) {
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["'](\/job\/[^"'#?]+)["']/gi)) links.add(`https://www.irishjobs.ie${decodeEntities(match[1])}`);
  return [...links];
}

async function fetchIrishJobs(source: DiscoverySource, alignmentTitles: string[], searchQueries: string[], locations: string[]): Promise<DiscoveryPosting[]> {
  const queries = searchQueries;
  const location = searchLocation(locations);
  const locationSlug = slugifySearch(location === "Ireland" ? "ireland" : location);
  const links = new Set<string>();

  await mapWithConcurrency(queries, PUBLIC_SEARCH_CONCURRENCY, async (query) => {
    const querySlug = slugifySearch(query);
    if (!querySlug) return;
    const url = `https://www.irishjobs.ie/jobs/${querySlug}/in-${locationSlug}`;
    try {
      const html = await fetchText(url);
      for (const link of irishJobsLinks(html)) links.add(link);
    } catch {
      // IrishJobs can occasionally reject one search path while other target-title paths still work.
    }
  });

  const results: DiscoveryPosting[] = [];
  await mapWithConcurrency([...links].slice(0, MAX_PUBLIC_DETAIL_FETCHES), 6, async (url) => {
    try {
      const html = await fetchText(url);
      const posting = buildPublicBoardPosting(source, url, html);
      if (posting && (!alignmentTitles.length || titleAlignmentScore(posting.title, alignmentTitles).aligned)) results.push(posting);
    } catch {
      // Individual IrishJobs ads can expire between the search page and detail fetch.
    }
  });
  return results;
}

function makeEvidence(posting: Omit<DiscoveryPosting, "evidence">, structured: unknown): JobPageEvidence {
  const bodyText = compactText([
    `Company: ${posting.company}`,
    `Title: ${posting.title}`,
    posting.location ? `Location: ${posting.location}` : "",
    posting.salaryText ? `Salary: ${posting.salaryText}` : "",
    posting.description
  ].filter(Boolean).join("\n\n"));

  return {
    requestedUrl: posting.sourceUrl,
    finalUrl: posting.sourceUrl,
    ats: posting.ats,
    pageTitle: `${posting.title} | ${posting.company}`,
    heading: posting.title,
    metaDescription: posting.description.slice(0, 600),
    bodyText: bodyText.slice(0, 36_000),
    jobPostingJsonLd: JSON.stringify(structured).slice(0, 12_000)
  };
}

async function fetchLever(source: DiscoverySource): Promise<DiscoveryPosting[]> {
  const boardHost = new URL(source.boardUrl).hostname.toLowerCase();
  const apiBase = boardHost === "jobs.eu.lever.co" ? "https://api.eu.lever.co" : "https://api.lever.co";
  const results: DiscoveryPosting[] = [];

  for (let skip = 0; skip < MAX_POSTINGS_PER_SOURCE; skip += 100) {
    const batch = await fetchJson<LeverPosting[]>(`${apiBase}/v0/postings/${encodeURIComponent(source.boardKey)}?mode=json&limit=100&skip=${skip}`);
    for (const raw of batch) {
      if (!raw.text || !raw.hostedUrl) continue;
      const listText = (raw.lists ?? []).map((item) => `${item.text ?? ""}\n${stripHtml(item.content ?? "")}`).join("\n\n");
      const description = compactText([
        raw.openingPlain ?? "",
        raw.descriptionPlain ?? raw.descriptionBodyPlain ?? "",
        listText,
        raw.additionalPlain ?? "",
        raw.categories?.commitment ? `Employment type: ${raw.categories.commitment}` : "",
        raw.workplaceType ? `Workplace type: ${raw.workplaceType}` : ""
      ].filter(Boolean).join("\n\n"));
      if (description.length < 80) continue;
      const base = {
        title: raw.text,
        company: source.name,
        location: raw.categories?.location ?? "",
        salaryText: raw.salaryDescriptionPlain ?? "",
        description,
        sourceUrl: raw.hostedUrl,
        ats: "lever" as const
      };
      results.push({ ...base, evidence: makeEvidence(base, raw) });
    }
    if (batch.length < 100) break;
  }
  return results;
}

async function fetchAshby(source: DiscoverySource): Promise<DiscoveryPosting[]> {
  const data = await fetchJson<{ jobs?: AshbyPosting[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.boardKey)}?includeCompensation=true`);
  const results: DiscoveryPosting[] = [];
  for (const raw of data.jobs ?? []) {
    if (raw.isListed === false || !raw.title || !raw.jobUrl) continue;
    const locations = [raw.location ?? "", ...(raw.secondaryLocations ?? []).map((item) => item.location ?? "")].filter(Boolean);
    const salaryText = raw.compensation?.scrapeableCompensationSalarySummary ?? raw.compensation?.compensationTierSummary ?? "";
    const description = compactText([
      raw.descriptionPlain ?? stripHtml(raw.descriptionHtml ?? ""),
      raw.department ? `Department: ${raw.department}` : "",
      raw.team ? `Team: ${raw.team}` : "",
      raw.employmentType ? `Employment type: ${raw.employmentType}` : "",
      raw.workplaceType ? `Workplace type: ${raw.workplaceType}` : ""
    ].filter(Boolean).join("\n\n"));
    if (description.length < 80) continue;
    const base = {
      title: raw.title,
      company: source.name,
      location: locations.join("; "),
      salaryText,
      description,
      sourceUrl: raw.jobUrl,
      ats: "ashby" as const
    };
    results.push({ ...base, evidence: makeEvidence(base, raw) });
  }
  return results;
}

async function fetchGreenhouse(source: DiscoverySource): Promise<DiscoveryPosting[]> {
  const data = await fetchJson<{ jobs?: GreenhousePosting[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.boardKey)}/jobs?content=true`);
  const results: DiscoveryPosting[] = [];
  for (const raw of data.jobs ?? []) {
    if (!raw.title || !raw.absolute_url) continue;
    const description = stripHtml(raw.content ?? "");
    if (description.length < 80) continue;
    const base = {
      title: raw.title,
      company: source.name,
      location: raw.location?.name ?? raw.offices?.map((office) => office.location || office.name || "").filter(Boolean).join("; ") ?? "",
      salaryText: "",
      description,
      sourceUrl: raw.absolute_url,
      ats: "greenhouse" as const
    };
    results.push({ ...base, evidence: makeEvidence(base, raw) });
  }
  return results;
}

function remoteOkSalary(raw: RemoteOkPosting) {
  const min = Number(raw.salary_min ?? 0);
  const max = Number(raw.salary_max ?? 0);
  if (min > 0 && max > 0) return `$${min.toLocaleString()}-$${max.toLocaleString()}`;
  if (min > 0) return `From $${min.toLocaleString()}`;
  if (max > 0) return `Up to $${max.toLocaleString()}`;
  return "";
}

async function fetchRemoteOk(source: DiscoverySource, alignmentTitles: string[], entryLevelOnly: boolean): Promise<DiscoveryPosting[]> {
  const data = await fetchJson<Array<RemoteOkPosting | Record<string, unknown>>>("https://remoteok.com/api");
  const cutoffEpoch = Math.floor(Date.now() / 1000) - REMOTE_FEED_MAX_AGE_DAYS * 24 * 60 * 60;
  const results: DiscoveryPosting[] = [];

  for (const value of data) {
    const raw = value as RemoteOkPosting;
    if (!raw.position || !raw.company || !raw.description || !raw.url) continue;
    if (raw.epoch && raw.epoch < cutoffEpoch) continue;
    if (!/^https?:\/\/(?:www\.)?remoteok\.com\//i.test(raw.url)) continue;
    if (alignmentTitles.length && !titleAlignmentScore(raw.position, alignmentTitles).aligned) continue;

    const descriptionText = stripHtml(raw.description);
    if (descriptionText.length < 80) continue;
    if (entryLevelOnly && !entryLevelEligibility(raw.position, descriptionText).allowed) continue;

    const location = compactText(raw.location || "Remote");
    const tags = (raw.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 16);
    const description = compactText([
      descriptionText,
      "Workplace type: Remote",
      `Remote scope: ${location || "Worldwide"}`,
      tags.length ? `Tags: ${tags.join(", ")}` : "",
      "Source: Remote OK"
    ].filter(Boolean).join("\n\n"));
    const base = {
      title: compactText(raw.position),
      company: compactText(raw.company),
      location: location || "Remote",
      salaryText: remoteOkSalary(raw),
      description,
      sourceUrl: raw.url,
      ats: "remoteok" as const
    };
    results.push({ ...base, evidence: makeEvidence(base, raw) });
  }

  return results.slice(0, MAX_POSTINGS_PER_SOURCE);
}

async function fetchSource(
  source: DiscoverySource,
  alignmentTitles: string[],
  searchQueries: string[],
  locations: string[],
  entryLevelOnly: boolean
) {
  if (source.ats === "lever") return fetchLever(source);
  if (source.ats === "ashby") return fetchAshby(source);
  if (source.ats === "greenhouse") return fetchGreenhouse(source);
  if (source.ats === "jobsireland") return fetchJobsIreland(source, alignmentTitles, searchQueries, locations);
  if (source.ats === "irishjobs") return fetchIrishJobs(source, alignmentTitles, searchQueries, locations);
  return fetchRemoteOk(source, alignmentTitles, entryLevelOnly);
}

export function locationEligibility(
  postingLocation: string,
  description: string,
  locations: string[],
  remotePreference = "",
  options: { allowRemoteUS?: boolean } = {}
) {
  const locationText = normalize(postingLocation);
  const context = `${locationText} ${normalize(description).slice(0, 2200)}`;
  const normalizedTargets = locations.map(normalize).filter(Boolean);
  const physicalTargets = normalizedTargets.filter((item) => item !== "remote" && item !== "any");
  const remoteRequested = ["any", "remote"].includes(normalize(remotePreference)) || normalizedTargets.includes("remote");
  const remote = /\b(remote|work from home|distributed)\b/.test(context);

  const isIrelandTarget = physicalTargets.some((item) => /\b(ireland|eire|dublin|cork|galway|limerick|waterford)\b/.test(item));
  const irelandSignal = /\b(ireland|eire|dublin|cork|galway|limerick|waterford)\b/.test(locationText) || /(^| )ie($| )/.test(locationText);
  const regionalRemote = /\b(europe|european|emea|eu remote|remote eu|worldwide|anywhere|global remote|remote globally)\b/.test(context);
  const usLocationSignal = /\b(united states|u s a|usa|us only|north america|san francisco|new york|seattle|austin|boston|chicago|los angeles|denver)\b/.test(locationText);
  const usDescriptionScope = /\b(remote (?:in|within|across) (?:the )?(?:united states|u s|usa)|u s[ -]based|us[ -]based|must be (?:located|based) in (?:the )?(?:united states|u s|usa)|united states only|us only)\b/.test(context);
  const usScope = usLocationSignal || usDescriptionScope;
  const explicitForeignScope = usScope || /\b(canada|india|australia|new zealand|singapore)\b/.test(locationText);

  const locationMatch = !physicalTargets.length || physicalTargets.some((target) => {
    if (target === "ireland" || target === "eire") return irelandSignal;
    return Boolean(locationText) && (locationText.includes(target) || target.includes(locationText));
  });

  let remoteCompatible = false;
  let usRemoteCompatible = false;
  if (remote && remoteRequested) {
    if (!physicalTargets.length) remoteCompatible = true;
    else if (locationMatch) remoteCompatible = true;
    else if (isIrelandTarget && irelandSignal) remoteCompatible = true;
    else if (options.allowRemoteUS && usScope) {
      remoteCompatible = true;
      usRemoteCompatible = true;
    }
    else if (regionalRemote && !explicitForeignScope) remoteCompatible = true;
    else if (!locationText || /^(remote|work from home|distributed)$/.test(locationText)) remoteCompatible = true;
  }

  const allowed = !locations.length || locationMatch || remoteCompatible || (!postingLocation && !physicalTargets.length);
  return { allowed, locationMatch, remoteCompatible, usRemoteCompatible, remote, explicitForeignScope, usScope };
}

function candidateSkills(profile: Profile, facts: CandidateFacts | null) {
  const values = [
    ...profile.skills,
    ...(facts?.skills ?? []),
    ...(facts?.projects.flatMap((project) => project.technologies) ?? [])
  ];
  return [...new Set(values.map((value) => normalize(value)).filter(Boolean))];
}

function cheapScore(
  posting: DiscoveryPosting,
  profile: Profile,
  facts: CandidateFacts | null,
  targetTitles: string[],
  locations: string[],
  options: { entryLevelOnly: boolean; includeRemoteUS: boolean }
) {
  const alignment = titleAlignmentScore(posting.title, targetTitles);
  if (targetTitles.length && !alignment.aligned) return 0;
  let titleScore = alignment.score;

  const entryLevel = entryLevelEligibility(posting.title, posting.description);
  if (options.entryLevelOnly && !entryLevel.allowed) return 0;

  const descriptionText = normalize(posting.description);
  const eligibility = locationEligibility(
    posting.location,
    posting.description,
    locations,
    profile.remotePreference,
    { allowRemoteUS: options.includeRemoteUS && entryLevel.allowed }
  );

  // Remote is not a geography. A role explicitly scoped to the US/Canada/etc. must not pass merely
  // because the posting also says "remote". Ireland/Europe/EMEA/worldwide remote roles remain eligible.
  if (!eligibility.allowed) return 0;
  const locationScore = eligibility.usRemoteCompatible
    ? 15
    : eligibility.locationMatch || eligibility.remoteCompatible
      ? 25
      : posting.location
        ? 0
        : 10;

  const skills = candidateSkills(profile, facts);
  const skillHits = skills.filter((skill) => skill.length >= 2 && descriptionText.includes(skill)).length;
  const skillScore = Math.min(30, skillHits * 5);

  const experience = deriveExperienceSummary(facts);
  const availableYears = experience.technicalYears || profile.yearsExperience;
  let penalty = 0;
  const title = posting.title.toLowerCase();

  if (/\b(staff|principal|director|head of|vice president|vp)\b/i.test(title) && availableYears > 0 && availableYears < 5) {
    return 0;
  }
  if (/\bsenior\b/i.test(title) && availableYears > 0 && availableYears < 4) penalty += 28;
  if (/\blead\b/i.test(title) && availableYears > 0 && availableYears < 4) penalty += 22;

  const minYears = entryLevel.minYears;
  if (minYears !== null && availableYears > 0) {
    if (minYears - availableYears >= 5) return 0;
    if (minYears - availableYears >= 3) penalty += 25;
    else if (minYears - availableYears >= 2) penalty += 12;
  }

  // Give genuinely early-career titles a small prefilter advantage so they reach the limited Qwen shortlist.
  if (/\b(junior|jr\.?|graduate|entry[ -]?level|associate)\b/i.test(title) && availableYears < 5) titleScore = Math.min(45, titleScore + 8);
  if (/\b(engineer|developer)\s+i\b/i.test(title) && availableYears < 5) titleScore = Math.min(45, titleScore + 8);
  if (options.entryLevelOnly && entryLevel.earlyCareer) titleScore = Math.min(45, titleScore + 4);

  return Math.max(0, Math.min(100, titleScore + locationScore + skillScore - penalty));
}

function selectDiverseShortlist<T extends { posting: DiscoveryPosting }>(ranked: T[], limit: number) {
  const selected: T[] = [];
  const selectedUrls = new Set<string>();
  const perCompany = new Map<string, number>();

  // First pass caps each employer at two Qwen slots so one large board cannot crowd out every other source.
  for (const item of ranked) {
    if (selected.length >= limit) break;
    const company = normalize(item.posting.company);
    const count = perCompany.get(company) ?? 0;
    if (count >= 2) continue;
    selected.push(item);
    selectedUrls.add(canonicalUrl(item.posting.sourceUrl));
    perCompany.set(company, count + 1);
  }

  // Fill any remaining slots from the global ranking if there were not enough distinct employers.
  for (const item of ranked) {
    if (selected.length >= limit) break;
    const url = canonicalUrl(item.posting.sourceUrl);
    if (selectedUrls.has(url)) continue;
    selected.push(item);
    selectedUrls.add(url);
  }

  return selected;
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    const trackingKeys = [...url.searchParams.keys()].filter((key) =>
      key.toLowerCase().startsWith("utm_") || ["gclid", "gbraid", "wbraid", "source", "ref"].includes(key.toLowerCase())
    );
    for (const key of trackingKeys) url.searchParams.delete(key);
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function knownJobUrls() {
  const rows = db.prepare("SELECT source_url AS sourceUrl FROM jobs WHERE source_url <> ''").all() as Array<{ sourceUrl: string }>;
  return new Set(rows.map((row) => canonicalUrl(row.sourceUrl)));
}

function postingContentHash(posting: DiscoveryPosting) {
  return createHash("sha256")
    .update(JSON.stringify({
      title: posting.title,
      company: posting.company,
      location: posting.location,
      salaryText: posting.salaryText,
      description: posting.description
    }))
    .digest("hex");
}

function loadCachedRequirements(posting: DiscoveryPosting): JobRequirements | null {
  const row = db.prepare(`
    SELECT content_hash AS contentHash, requirements_json AS requirementsJson
    FROM discovery_analysis_cache WHERE canonical_url = ?
  `).get(canonicalUrl(posting.sourceUrl)) as { contentHash: string; requirementsJson: string } | undefined;
  if (!row || row.contentHash !== postingContentHash(posting)) return null;
  try {
    const parsed = JobRequirementsSchema.safeParse(JSON.parse(row.requirementsJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveCachedRequirements(posting: DiscoveryPosting, requirements: JobRequirements) {
  db.prepare(`
    INSERT INTO discovery_analysis_cache (
      canonical_url, content_hash, source_url, ats, company, title, requirements_json, analyzed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(canonical_url) DO UPDATE SET
      content_hash = excluded.content_hash,
      source_url = excluded.source_url,
      ats = excluded.ats,
      company = excluded.company,
      title = excluded.title,
      requirements_json = excluded.requirements_json,
      analyzed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    canonicalUrl(posting.sourceUrl),
    postingContentHash(posting),
    posting.sourceUrl,
    posting.ats,
    posting.company,
    posting.title,
    JSON.stringify(requirements)
  );
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }));
}

async function executeDiscovery(input: DiscoveryRunInput) {
  const startedAt = Date.now();
  const profile = loadProfile();
  const facts = loadCandidateFacts();
  const targetTitles = (input.targetTitles?.length ? input.targetTitles : targets(profile)).filter(Boolean);
  const locations = (input.locations?.length ? input.locations : [...profile.preferredLocations, profile.city, profile.country]).filter(Boolean);
  const entryLevelOnly = input.entryLevelOnly ?? false;
  const broadEntryLevelIT = input.broadEntryLevelIT ?? false;
  const includeRemoteUS = input.includeRemoteUS ?? false;
  if (!targetTitles.length && !broadEntryLevelIT) throw new Error("Choose target roles in Profile before discovering jobs.");
  const alignmentTitles = buildDiscoveryAlignmentTitles(targetTitles, broadEntryLevelIT);
  const searchQueries = buildDiscoverySearchQueries(targetTitles, MAX_PUBLIC_SEARCH_QUERIES, broadEntryLevelIT);
  const sources = listDiscoverySources().filter((source) => source.enabled);
  const outcomeModel = buildOutcomeLearningModel();

  if (!sources.length) throw new Error("No discovery sources are enabled. Add a Lever, Ashby, or Greenhouse board first.");

  const run = db.prepare("INSERT INTO discovery_runs (status) VALUES ('RUNNING')").run();
  const runId = Number(run.lastInsertRowid);
  const errors: string[] = [];
  const allPostings: DiscoveryPosting[] = [];

  const sourceFetchStarted = Date.now();
  const sourceResults = await Promise.all(sources.map(async (source) => {
    try {
      return { source, postings: await fetchSource(source, alignmentTitles, searchQueries, locations, entryLevelOnly), error: null as string | null };
    } catch (error) {
      return { source, postings: [] as DiscoveryPosting[], error: error instanceof Error ? error.message : String(error) };
    }
  }));

  for (const result of sourceResults) {
    if (result.error) {
      errors.push(`${result.source.name}: ${result.error}`);
      db.prepare("UPDATE discovery_sources SET last_scan_at = CURRENT_TIMESTAMP, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(result.error, result.source.id);
    } else {
      allPostings.push(...result.postings);
      db.prepare("UPDATE discovery_sources SET last_scan_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(result.source.id);
    }
  }
  const sourceFetchMs = Date.now() - sourceFetchStarted;

  const known = knownJobUrls();
  const unique = new Map<string, DiscoveryPosting>();
  for (const posting of allPostings) {
    const key = canonicalUrl(posting.sourceUrl);
    if (!unique.has(key) && !known.has(key)) unique.set(key, posting);
  }

  const ranked = [...unique.values()]
    .map((posting) => ({
      posting,
      preScore: cheapScore(posting, profile, facts, alignmentTitles, locations, { entryLevelOnly, includeRemoteUS })
    }))
    .filter((item) => item.preScore >= input.minPreScore)
    .sort((a, b) => b.preScore - a.preScore);

  const shortlist = selectDiverseShortlist(ranked, input.maxDeepAnalysis);
  const imported: Array<Record<string, unknown>> = [];
  let evaluated = 0;
  let cacheHits = 0;
  let aiRequests = 0;

  const updateProgress = (analysisMs = 0) => {
    db.prepare(`
      UPDATE discovery_runs SET
        sources_scanned = ?, jobs_seen = ?, jobs_shortlisted = ?, jobs_analyzed = ?, jobs_imported = ?,
        cache_hits = ?, ai_requests = ?, source_fetch_ms = ?, analysis_ms = ?, errors_json = ?
      WHERE id = ?
    `).run(
      sources.length,
      allPostings.length,
      ranked.length,
      evaluated,
      imported.length,
      cacheHits,
      aiRequests,
      sourceFetchMs,
      analysisMs,
      JSON.stringify(errors),
      runId
    );
  };

  updateProgress();
  const analysisStarted = Date.now();

  await mapWithConcurrency(shortlist, input.analysisConcurrency, async (item) => {
    try {
      let requirements = loadCachedRequirements(item.posting);
      if (requirements) {
        cacheHits += 1;
      } else {
        aiRequests += 1;
        requirements = await extractRequirementsFromEvidence(item.posting.evidence);
        saveCachedRequirements(item.posting, requirements);
      }

      const job = JobInputSchema.parse({
        sourceUrl: item.posting.sourceUrl,
        title: item.posting.title,
        company: item.posting.company,
        location: item.posting.location,
        salaryText: item.posting.salaryText,
        description: item.posting.description
      });
      const baseBreakdown = scoreJob(profile, job, requirements, facts);
      const breakdown = applyOutcomeLearning(baseBreakdown, job, requirements, input.useOutcomeLearning, outcomeModel);
      const key = canonicalUrl(job.sourceUrl);

      if (breakdown.total >= input.minFinalScore && !known.has(key)) {
        const result = db.prepare(`
          INSERT INTO jobs (
            source_url, title, company, location, salary_text, description,
            score, score_json, analysis_json, source_text, ats, status, origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCORED', 'discovery')
        `).run(
          job.sourceUrl,
          job.title,
          job.company,
          job.location,
          job.salaryText,
          job.description,
          breakdown.total,
          JSON.stringify(breakdown),
          JSON.stringify(requirements),
          item.posting.evidence.bodyText,
          item.posting.ats
        );

        known.add(key);
        imported.push({
          id: Number(result.lastInsertRowid),
          ...job,
          ats: item.posting.ats,
          score: breakdown.total,
          preScore: item.preScore,
          requirements,
          scoreBreakdown: breakdown
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${item.posting.company} - ${item.posting.title}: ${message}`);
    } finally {
      evaluated += 1;
      updateProgress(Date.now() - analysisStarted);
    }
  });

  imported.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  const analysisMs = Date.now() - analysisStarted;
  const durationMs = Date.now() - startedAt;

  db.prepare(`
    UPDATE discovery_runs SET
      status = 'COMPLETED', sources_scanned = ?, jobs_seen = ?, jobs_shortlisted = ?, jobs_analyzed = ?, jobs_imported = ?,
      cache_hits = ?, ai_requests = ?, duration_ms = ?, source_fetch_ms = ?, analysis_ms = ?,
      errors_json = ?, completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    sources.length,
    allPostings.length,
    ranked.length,
    evaluated,
    imported.length,
    cacheHits,
    aiRequests,
    durationMs,
    sourceFetchMs,
    analysisMs,
    JSON.stringify(errors),
    runId
  );

  return {
    runId,
    sourcesScanned: sources.length,
    jobsSeen: allPostings.length,
    candidatesAfterPrefilter: ranked.length,
    jobsAnalyzed: evaluated,
    jobsImported: imported.length,
    cacheHits,
    aiRequests,
    sourceFetchMs,
    analysisMs,
    durationMs,
    analysisConcurrency: input.analysisConcurrency,
    useOutcomeLearning: input.useOutcomeLearning,
    entryLevelOnly,
    broadEntryLevelIT,
    includeRemoteUS,
    searchQueries,
    targetTitles,
    locations,
    imported,
    errors
  };
}


let discoveryRunning = false;

export function isDiscoveryRunning() {
  return discoveryRunning;
}

export async function runDiscovery(input: DiscoveryRunInput) {
  if (discoveryRunning) {
    throw new Error("A discovery run is already in progress. Wait for it to finish before starting another one.");
  }
  discoveryRunning = true;
  try {
    return await executeDiscovery(input);
  } finally {
    discoveryRunning = false;
  }
}
