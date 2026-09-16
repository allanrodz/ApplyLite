import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import {
  ApplicationOutcomeSchema,
  GmailClassificationSchema,
  GmailMessageDetailsSchema,
  GmailMessageSchema,
  GmailOverviewSchema,
  GmailSettingsSchema,
  GmailSyncRunSchema,
  ProfileSchema,
  type ApplicationOutcome,
  type GmailClassification,
  type GmailMessage,
  type GmailMessageDetails,
  type GmailOverview,
  type GmailSettings,
  type GmailSyncRun
} from "@apply-lite/shared";
import { db } from "../db/database.js";
import { config } from "../config.js";
import { askOllamaStructured } from "./ollama.js";
import { recordTrackerEvent, setApplicationOutcome } from "./applicationTracker.js";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const secretsRoot = path.resolve(process.cwd(), ".secrets");
const oauthPath = path.join(secretsRoot, "gmail-oauth.json");
const tokenPath = path.join(secretsRoot, "gmail-token.json");
const oauthStates = new Map<string, number>();
let syncPromise: Promise<GmailOverview> | null = null;

const AiClassificationSchema = z.object({
  classification: GmailClassificationSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string().max(600).default(""),
  details: GmailMessageDetailsSchema
});

type OAuthClient = { clientId: string; clientSecret: string };
type OAuthToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope: string;
};

type GmailApiHeader = { name?: string; value?: string };
type GmailApiPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailApiPart[];
};
type GmailApiMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailApiPart & { headers?: GmailApiHeader[] };
};

type ParsedMessage = {
  gmailId: string;
  threadId: string;
  rfcMessageId: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  subject: string;
  snippet: string;
  bodyText: string;
  receivedAt: string;
  internalDate: number;
  labels: string[];
};

type ApplicationCandidate = {
  applicationId: number;
  jobId: number;
  title: string;
  company: string;
  sourceUrl: string;
  state: string;
  outcome: string;
  submittedAt: string | null;
};

type MatchResult = { applicationId: number | null; confidence: number; candidate?: ApplicationCandidate };
type ClassificationResult = { classification: GmailClassification; confidence: number; summary: string; details: GmailMessageDetails; aiUsed: boolean };
type GmailSettingsRow = {
  connected_email: string;
  sync_enabled: number;
  interval_minutes: number;
  lookback_days: number;
  last_sync_at: string | null;
  last_sync_started_at: string | null;
  last_error: string | null;
};

function ensureSecretDir() {
  fs.mkdirSync(secretsRoot, { recursive: true });
}

function writeSecret(filePath: string, value: unknown) {
  ensureSecretDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows permissions are managed by the user account. */ }
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")) as T; }
  catch { return null; }
}

function readOAuthClient(): OAuthClient | null {
  const value = readJson<OAuthClient>(oauthPath);
  if (!value?.clientId || !value?.clientSecret) return null;
  return value;
}

function readToken(): OAuthToken | null {
  const value = readJson<OAuthToken>(tokenPath);
  if (!value?.refreshToken && !value?.accessToken) return null;
  return value;
}

function redirectUri() {
  return `http://127.0.0.1:${config.port}/gmail/oauth/callback`;
}

export function configureGmailOAuth(credentials: unknown) {
  const source = credentials && typeof credentials === "object" ? credentials as Record<string, unknown> : {};
  const nested = (source.installed ?? source.web ?? source) as Record<string, unknown>;
  const clientId = String(nested.client_id ?? nested.clientId ?? "").trim();
  const clientSecret = String(nested.client_secret ?? nested.clientSecret ?? "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("The Google OAuth JSON must contain client_id and client_secret (normally under installed or web).");
  }
  const old = readOAuthClient();
  writeSecret(oauthPath, { clientId, clientSecret });
  if (old && old.clientId !== clientId) {
    fs.rmSync(tokenPath, { force: true });
    db.prepare("UPDATE gmail_settings SET connected_email = '', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run();
  }
  return { ok: true, oauthConfigured: true, redirectUri: redirectUri() };
}

export function removeGmailOAuthConfiguration() {
  fs.rmSync(tokenPath, { force: true });
  fs.rmSync(oauthPath, { force: true });
  db.prepare("UPDATE gmail_settings SET connected_email = '', last_sync_at = NULL, last_sync_started_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run();
  return { ok: true };
}

export function disconnectGmail() {
  fs.rmSync(tokenPath, { force: true });
  db.prepare("UPDATE gmail_settings SET connected_email = '', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run();
  return { ok: true };
}

export function createGmailAuthorizationUrl() {
  const client = readOAuthClient();
  if (!client) throw new Error("Import a Google OAuth Desktop client JSON before connecting Gmail.");
  const state = crypto.randomBytes(24).toString("hex");
  oauthStates.set(state, Date.now() + 10 * 60_000);
  for (const [key, expiry] of oauthStates) if (expiry < Date.now()) oauthStates.delete(key);
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state
  });
  return { authUrl: `${GOOGLE_AUTH_URL}?${params.toString()}`, expiresInSeconds: 600 };
}

async function exchangeAuthorizationCode(code: string): Promise<OAuthToken> {
  const client = readOAuthClient();
  if (!client) throw new Error("Google OAuth credentials are not configured.");
  const body = new URLSearchParams({
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code"
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Google token exchange failed: ${String(payload.error_description ?? payload.error ?? response.statusText)}`);
  const refreshToken = String(payload.refresh_token ?? "");
  if (!refreshToken) throw new Error("Google did not return a refresh token. Reconnect and approve offline Gmail access.");
  return {
    accessToken: String(payload.access_token ?? ""),
    refreshToken,
    expiresAt: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
    tokenType: String(payload.token_type ?? "Bearer"),
    scope: String(payload.scope ?? GMAIL_SCOPE)
  };
}

async function refreshAccessToken(token: OAuthToken): Promise<OAuthToken> {
  const client = readOAuthClient();
  if (!client) throw new Error("Google OAuth credentials are not configured.");
  if (!token.refreshToken) throw new Error("Gmail refresh token is missing. Reconnect Gmail.");
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: token.refreshToken,
      grant_type: "refresh_token"
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Google token refresh failed: ${String(payload.error_description ?? payload.error ?? response.statusText)}`);
  const refreshed: OAuthToken = {
    accessToken: String(payload.access_token ?? ""),
    refreshToken: token.refreshToken,
    expiresAt: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
    tokenType: String(payload.token_type ?? token.tokenType ?? "Bearer"),
    scope: String(payload.scope ?? token.scope ?? GMAIL_SCOPE)
  };
  writeSecret(tokenPath, refreshed);
  return refreshed;
}

async function accessToken() {
  let token = readToken();
  if (!token) throw new Error("Gmail is not connected.");
  if (!token.accessToken || token.expiresAt < Date.now() + 60_000) token = await refreshAccessToken(token);
  return token.accessToken;
}

async function gmailFetch<T>(pathSuffix: string): Promise<T> {
  const token = await accessToken();
  let response = await fetch(`${GMAIL_API}${pathSuffix}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000)
  });
  if (response.status === 401) {
    const current = readToken();
    if (!current) throw new Error("Gmail is not connected.");
    const refreshed = await refreshAccessToken(current);
    response = await fetch(`${GMAIL_API}${pathSuffix}`, {
      headers: { authorization: `Bearer ${refreshed.accessToken}` },
      signal: AbortSignal.timeout(25_000)
    });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gmail API request failed (${response.status}): ${text.slice(0, 300) || response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function completeGmailOAuth(code: string, state: string) {
  const expiry = oauthStates.get(state);
  oauthStates.delete(state);
  if (!expiry || expiry < Date.now()) throw new Error("The Gmail connection request expired or the OAuth state was invalid. Start Connect Gmail again.");
  const token = await exchangeAuthorizationCode(code);
  writeSecret(tokenPath, token);
  const profile = await gmailFetch<{ emailAddress?: string; historyId?: string }>("/profile");
  const email = String(profile.emailAddress ?? "");
  db.prepare(`
    UPDATE gmail_settings
    SET connected_email = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(email);
  return { ok: true, email };
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function htmlToText(value: string) {
  return decodeEntities(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function collectBodies(part: GmailApiPart | undefined, target: { plain: string[]; html: string[] }) {
  if (!part) return;
  const data = part.body?.data;
  if (data) {
    try {
      const decoded = decodeBase64Url(data);
      if (part.mimeType === "text/plain") target.plain.push(decoded);
      else if (part.mimeType === "text/html") target.html.push(decoded);
    } catch { /* Ignore malformed MIME chunks. */ }
  }
  for (const child of part.parts ?? []) collectBodies(child, target);
}

function header(message: GmailApiMessage, name: string) {
  return message.payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseMailbox(value: string) {
  const angle = value.match(/^(.*?)<([^>]+)>/);
  if (angle) return { name: angle[1].replace(/^\s*["']|["']\s*$/g, "").trim(), email: angle[2].trim().toLowerCase() };
  const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? "";
  return { name: email && value.trim() !== email ? value.replace(email, "").trim().replace(/[<>"']/g, "") : "", email };
}

function parseMessage(message: GmailApiMessage): ParsedMessage {
  if (!message.id) throw new Error("Gmail returned a message without an id.");
  const bodies = { plain: [] as string[], html: [] as string[] };
  collectBodies(message.payload, bodies);
  const body = (bodies.plain.join("\n\n") || htmlToText(bodies.html.join("\n\n"))).replace(/\u0000/g, "").trim();
  const sender = parseMailbox(header(message, "From"));
  const internalDate = Number(message.internalDate ?? Date.now());
  return {
    gmailId: message.id,
    threadId: message.threadId ?? "",
    rfcMessageId: header(message, "Message-ID"),
    fromEmail: sender.email,
    fromName: sender.name,
    toEmail: parseMailbox(header(message, "To")).email,
    subject: header(message, "Subject").trim(),
    snippet: String(message.snippet ?? "").trim(),
    bodyText: body.slice(0, 12_000),
    receivedAt: new Date(Number.isFinite(internalDate) ? internalDate : Date.now()).toISOString(),
    internalDate: Number.isFinite(internalDate) ? internalDate : Date.now(),
    labels: message.labelIds ?? []
  };
}

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9@.]+/g, " ").replace(/\s+/g, " ").trim();
}

function companyTokens(company: string) {
  const ignored = new Set(["limited", "ltd", "inc", "plc", "llc", "group", "company", "co", "the", "holdings", "services", "international"]);
  return normalizeText(company).split(" ").filter((token) => token.length >= 3 && !ignored.has(token));
}

function titleTokens(title: string) {
  const ignored = new Set(["junior", "senior", "lead", "the", "and", "for", "level", "i", "ii", "iii"]);
  return normalizeText(title).split(" ").filter((token) => token.length >= 3 && !ignored.has(token));
}

function senderDomain(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function listApplicationCandidates(): ApplicationCandidate[] {
  return db.prepare(`
    SELECT a.id AS applicationId, a.job_id AS jobId, a.state, a.outcome,
           a.submitted_at AS submittedAt, j.title, j.company, j.source_url AS sourceUrl
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.outcome NOT IN ('WITHDRAWN')
    ORDER BY COALESCE(a.submitted_at, a.updated_at) DESC, a.id DESC
  `).all() as ApplicationCandidate[];
}

function matchApplication(message: ParsedMessage, candidates = listApplicationCandidates()): MatchResult {
  const haystack = normalizeText(`${message.fromName} ${message.fromEmail} ${message.subject} ${message.snippet} ${message.bodyText.slice(0, 5000)}`);
  const domain = senderDomain(message.fromEmail);
  let best: { score: number; candidate: ApplicationCandidate } | null = null;
  let second = 0;
  for (const candidate of candidates) {
    let score = 0;
    const company = companyTokens(candidate.company);
    const title = titleTokens(candidate.title);
    const matchedCompany = company.filter((token) => haystack.includes(token));
    const matchedTitle = title.filter((token) => haystack.includes(token));
    if (matchedCompany.length) score += Math.min(5, 2 + matchedCompany.length);
    if (company.length && matchedCompany.length === company.length) score += 2;
    if (matchedTitle.length) score += Math.min(4, matchedTitle.length * 1.25);
    if (candidate.title && normalizeText(message.subject).includes(normalizeText(candidate.title))) score += 4;
    const companyCompact = company.join("");
    if (domain && companyCompact && domain.replace(/[^a-z0-9]/g, "").includes(companyCompact.slice(0, Math.min(8, companyCompact.length)))) score += 4;
    const sourceHost = (() => { try { return new URL(candidate.sourceUrl).hostname.toLowerCase(); } catch { return ""; } })();
    if (domain && sourceHost && (sourceHost.includes(domain) || domain.includes(sourceHost.replace(/^www\./, "")))) score += 1;
    if (!best || score > best.score) {
      second = best?.score ?? second;
      best = { score, candidate };
    } else if (score > second) second = score;
  }
  if (!best || best.score < 3) return { applicationId: null, confidence: 0 };
  const margin = best.score - second;
  const confidence = Math.max(0.45, Math.min(0.99, 0.45 + best.score * 0.055 + Math.max(0, margin) * 0.04));
  if (best.score < 4 && margin < 1.5) return { applicationId: null, confidence: Math.min(confidence, 0.55) };
  return { applicationId: best.candidate.applicationId, confidence, candidate: best.candidate };
}

const careerTerms = [
  "interview", "application", "candidate", "recruiter", "hiring", "position", "role", "assessment",
  "coding challenge", "technical test", "take home", "take-home", "offer", "next steps", "phone screen",
  "screening call", "thank you for applying", "application received", "not moving forward", "unfortunately",
  "shortlisted", "shortlist", "career", "talent acquisition"
];

const atsDomains = ["greenhouse.io", "lever.co", "ashbyhq.com", "workablemail.com", "smartrecruiters.com", "jobvite.com", "icims.com", "myworkday.com", "workday.com", "hire.lever.co"];

const bulkNoiseSenders = new Set([
  "donotreply@match.indeed.com",
  "noreply@glassdoor.com",
  "no-reply@glassdoor.com",
  "hello@mail.aiapply.co",
  "support@spocket.co",
  "no-reply@mail.nordvpn.com",
  "hello@algo.monster"
]);

const bulkNoiseDomains = [
  "match.indeed.com",
  "mail.aiapply.co",
  "spocket.co",
  "mail.nordvpn.com",
  "algo.monster"
];

function directApplicationSubject(subject: string) {
  const text = normalizeText(subject);
  return /\b(your application|application at|application for|application update|re application|interview|assessment|coding challenge|technical test|take home|job offer|offer letter|phone screen|screening call|hiring process|next steps)\b/.test(text);
}

function strongApplicationSignal(message: ParsedMessage) {
  const text = normalizeText(`${message.subject} ${message.snippet} ${message.bodyText.slice(0, 5000)}`);
  return /thank you for applying|thanks for applying|received your application|application received|your application|invite you to (an )?interview|interview invitation|schedule.{0,40}(interview|call|meeting)|phone screen|screening call|coding challenge|technical assessment|take home|offer letter|pleased to offer|employment offer|not moving forward|regret to inform|not selected|other candidates|next steps.{0,50}(application|interview)|regarding your application|update on your application/.test(text);
}

function senderLooksHiring(message: ParsedMessage) {
  const domain = senderDomain(message.fromEmail);
  if (atsDomains.some((known) => domain.endsWith(known))) return true;
  const identity = normalizeText(`${message.fromName} ${message.fromEmail}`);
  return /recruit|talent|hiring|careers|people team|human resources|hr team/.test(identity);
}

function highConfidenceNoise(message: ParsedMessage) {
  const email = message.fromEmail.toLowerCase();
  const domain = senderDomain(email);
  const subject = normalizeText(message.subject);
  if (bulkNoiseSenders.has(email)) return true;
  if (bulkNoiseDomains.some((known) => domain === known || domain.endsWith(`.${known}`))) return true;
  if (email === "noreply@glassdoor.com" || email === "no-reply@glassdoor.com") return true;
  if (/\b(more jobs|jobs in .+ for you|apply now|job alert|recommended jobs|jobs for you)\b/.test(subject)) return true;
  const promotional = message.labels.includes("CATEGORY_PROMOTIONS") || message.labels.includes("CATEGORY_SOCIAL") || message.labels.includes("CATEGORY_FORUMS");
  if (promotional && !directApplicationSubject(message.subject) && !strongApplicationSignal(message)) return true;
  return false;
}

function careerRelevant(message: ParsedMessage, match: MatchResult) {
  if (highConfidenceNoise(message)) return false;
  if (match.applicationId && match.confidence >= 0.60) return true;
  if (directApplicationSubject(message.subject)) return true;
  if (strongApplicationSignal(message) && senderLooksHiring(message)) return true;
  return false;
}

function pruneStoredNoise() {
  const rows = db.prepare(`
    SELECT gmail_id AS gmailId, thread_id AS threadId, rfc_message_id AS rfcMessageId,
           from_email AS fromEmail, from_name AS fromName, to_email AS toEmail, subject, snippet,
           body_text AS bodyText, received_at AS receivedAt, internal_date AS internalDate, labels_json AS labelsJson
    FROM gmail_messages
  `).all() as Array<Record<string, unknown>>;
  let removed = 0;
  const remove = db.prepare("DELETE FROM gmail_messages WHERE gmail_id = ?");
  for (const row of rows) {
    let labels: string[] = [];
    try { labels = z.array(z.string()).parse(JSON.parse(String(row.labelsJson ?? "[]"))); } catch { labels = []; }
    const message: ParsedMessage = {
      gmailId: String(row.gmailId ?? ""),
      threadId: String(row.threadId ?? ""),
      rfcMessageId: String(row.rfcMessageId ?? ""),
      fromEmail: String(row.fromEmail ?? "").toLowerCase(),
      fromName: String(row.fromName ?? ""),
      toEmail: String(row.toEmail ?? "").toLowerCase(),
      subject: String(row.subject ?? ""),
      snippet: String(row.snippet ?? ""),
      bodyText: String(row.bodyText ?? ""),
      receivedAt: String(row.receivedAt ?? ""),
      internalDate: Number(row.internalDate ?? 0),
      labels
    };
    if (highConfidenceNoise(message)) {
      remove.run(message.gmailId);
      removed += 1;
    }
  }
  return removed;
}

function extractMeetingLink(text: string) {
  const links = text.match(/https?:\/\/[^\s<>()"']+/gi) ?? [];
  return links.find((url) => /meet\.google\.com|zoom\.us|teams\.microsoft\.com|webex\.com/i.test(url))?.replace(/[.,;]+$/, "") ?? "";
}

function heuristicClassification(message: ParsedMessage): ClassificationResult {
  const text = normalizeText(`${message.subject}\n${message.snippet}\n${message.bodyText.slice(0, 7000)}`);
  const details = GmailMessageDetailsSchema.parse({ meetingLink: extractMeetingLink(message.bodyText) });
  const mk = (classification: GmailClassification, confidence: number, summary: string): ClassificationResult => ({ classification, confidence, summary, details, aiUsed: false });

  if (/pleased to offer|offer letter|employment offer|extend (you )?an offer|job offer/.test(text)) return mk("OFFER", 0.98, "The employer appears to be communicating a job offer.");
  if (/not moving forward|will not be (moving|progressing)|regret to inform|unfortunately.{0,80}(not|other|unable)|not selected|decided to move forward with other|other candidates/.test(text)) return mk("REJECTION", 0.97, "The employer appears to be closing the application without progressing.");
  if (/interview|phone screen|screening call|video call|meet with (the )?(team|manager)|schedule.{0,40}(call|meeting)|availability.{0,60}(call|interview)|invite.{0,40}(interview|meeting)/.test(text)) return mk("INTERVIEW", 0.94, "The message appears to invite or coordinate an interview or screening conversation.");
  if (/coding challenge|technical test|assessment|hackerrank|codility|take home|take-home|online test|skills test/.test(text)) return mk("ASSESSMENT", 0.94, "The employer appears to be requesting an assessment, test or take-home task.");
  if (/application (has been )?received|received your application|thank you for applying|thanks for applying|application confirmation/.test(text)) return mk("APPLICATION_ACK", 0.94, "This appears to confirm receipt of the application.");
  if (/recruiter|talent acquisition|hiring team|next steps|update on your application|following up|regarding your application/.test(text)) return mk("RECRUITER_REPLY", 0.76, "This appears to be a recruiter or hiring-team response about the application.");
  return mk("OTHER", 0.45, "Career-related email detected, but no high-confidence outcome was identified.");
}

async function classifyWithLocalAi(message: ParsedMessage, match: MatchResult, heuristic: ClassificationResult): Promise<ClassificationResult> {
  const application = match.candidate ? `${match.candidate.title} at ${match.candidate.company}` : "No confident application match yet";
  const prompt = `Classify this career-related Gmail message for a local job-application tracker.\n\nPRIVACY/RULES:\n- Use only the email content below.\n- Do not invent dates, times, outcomes or employer intent.\n- INTERVIEW means an interview/screening invitation or scheduling message.\n- ASSESSMENT means coding challenge, test, take-home or assessment request.\n- OFFER means an actual or clearly stated job offer.\n- REJECTION means the employer clearly says the application will not progress.\n- APPLICATION_ACK only acknowledges receipt.\n- RECRUITER_REPLY is a meaningful hiring-team response that is none of the above.\n- OTHER when uncertain.\n- Extract interview/assessment details only if explicitly present.\n\nPotential matched application: ${application}\nHeuristic guess: ${heuristic.classification} (${heuristic.confidence})\nFrom: ${message.fromName} <${message.fromEmail}>\nSubject: ${message.subject}\nSnippet: ${message.snippet}\nBody:\n${message.bodyText.slice(0, 6500)}\n\nReturn a concise summary (max 2 sentences). /no_think`;
  try {
    const raw = await askOllamaStructured<unknown>(prompt, z.toJSONSchema(AiClassificationSchema), { numPredict: 900, numCtx: 8192, timeoutMs: 75_000 });
    const ai = AiClassificationSchema.parse(raw);
    return { classification: ai.classification, confidence: ai.confidence, summary: ai.summary, details: ai.details, aiUsed: true };
  } catch {
    return heuristic;
  }
}

function suggestedOutcome(classification: GmailClassification): ApplicationOutcome | null {
  if (classification === "INTERVIEW") return "INTERVIEW";
  if (classification === "OFFER") return "OFFER";
  if (classification === "REJECTION") return "REJECTED";
  return null;
}

function actionStatus(classification: GmailClassification, matched: boolean) {
  if (classification === "APPLICATION_ACK" || classification === "OTHER") return "INFO";
  return matched ? "PENDING" : "PENDING";
}

function initialSearchQuery(lookbackDays: number, candidates: ApplicationCandidate[]) {
  const base = ['"your application"', '"thank you for applying"', '"thanks for applying"', '"application received"', 'interview', 'assessment', '"coding challenge"', '"technical test"', '"offer letter"', '"job offer"', '"next steps"', '"not moving forward"', '"regret to inform"'];
  const companies = [...new Set(candidates.slice(0, 15).map((item) => item.company.trim()).filter((value) => value.length >= 3))]
    .map((value) => `"${value.replaceAll('"', '')}"`);
  return `newer_than:${lookbackDays}d -from:me {${[...base, ...companies].join(" ")}}`;
}

function incrementalSearchQuery(lastSyncAt: string) {
  const time = new Date(lastSyncAt).getTime();
  const overlap = Number.isNaN(time) ? Date.now() - 86_400_000 : time - 10 * 60_000;
  const after = new Date(overlap).toISOString().slice(0, 10).replaceAll("-", "/");
  return `after:${after} -from:me`;
}

function settingsRow(): GmailSettingsRow {
  return db.prepare(`
    SELECT connected_email, sync_enabled, interval_minutes, lookback_days, last_sync_at, last_sync_started_at, last_error
    FROM gmail_settings WHERE id = 1
  `).get() as GmailSettingsRow;
}

export function gmailConnectionStatus(): GmailSettings {
  const row = settingsRow();
  return GmailSettingsSchema.parse({
    oauthConfigured: Boolean(readOAuthClient()),
    connected: Boolean(readToken() && row.connected_email),
    email: row.connected_email,
    syncEnabled: Boolean(row.sync_enabled),
    intervalMinutes: row.interval_minutes,
    lookbackDays: row.lookback_days,
    lastSyncAt: row.last_sync_at,
    lastSyncStartedAt: row.last_sync_started_at,
    lastError: row.last_error,
    syncing: Boolean(syncPromise)
  });
}

export function updateGmailSettings(input: { syncEnabled: boolean; intervalMinutes: number; lookbackDays: number }) {
  db.prepare(`
    UPDATE gmail_settings
    SET sync_enabled = ?, interval_minutes = ?, lookback_days = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(input.syncEnabled ? 1 : 0, input.intervalMinutes, input.lookbackDays);
  return gmailConnectionStatus();
}

function parseDetails(value: string): GmailMessageDetails {
  try { return GmailMessageDetailsSchema.parse(JSON.parse(value || "{}")); }
  catch { return GmailMessageDetailsSchema.parse({}); }
}

function toUiMessage(row: Record<string, unknown>): GmailMessage {
  const threadId = String(row.threadId ?? "");
  return GmailMessageSchema.parse({
    gmailId: String(row.gmailId ?? ""),
    threadId,
    fromEmail: String(row.fromEmail ?? ""),
    fromName: String(row.fromName ?? ""),
    subject: String(row.subject ?? ""),
    snippet: String(row.snippet ?? ""),
    receivedAt: String(row.receivedAt ?? ""),
    applicationId: row.applicationId == null ? null : Number(row.applicationId),
    applicationTitle: row.applicationTitle == null ? null : String(row.applicationTitle),
    applicationCompany: row.applicationCompany == null ? null : String(row.applicationCompany),
    matchConfidence: Number(row.matchConfidence ?? 0),
    classification: String(row.classification ?? "OTHER"),
    classificationConfidence: Number(row.classificationConfidence ?? 0),
    summary: String(row.summary ?? ""),
    details: parseDetails(String(row.detailsJson ?? "{}")),
    suggestedOutcome: row.suggestedOutcome == null || row.suggestedOutcome === "" ? null : String(row.suggestedOutcome),
    actionStatus: String(row.actionStatus ?? "INFO"),
    gmailUrl: threadId ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}` : "https://mail.google.com/",
    confirmedAt: row.confirmedAt == null ? null : String(row.confirmedAt),
    ignoredAt: row.ignoredAt == null ? null : String(row.ignoredAt)
  });
}

function listMessages(limit = 100) {
  const rows = db.prepare(`
    SELECT gm.gmail_id AS gmailId, gm.thread_id AS threadId, gm.from_email AS fromEmail, gm.from_name AS fromName,
           gm.subject, gm.snippet, gm.received_at AS receivedAt, gm.application_id AS applicationId,
           gm.match_confidence AS matchConfidence, gm.classification, gm.classification_confidence AS classificationConfidence,
           gm.summary, gm.details_json AS detailsJson, gm.suggested_outcome AS suggestedOutcome,
           gm.action_status AS actionStatus, gm.confirmed_at AS confirmedAt, gm.ignored_at AS ignoredAt,
           j.title AS applicationTitle, j.company AS applicationCompany
    FROM gmail_messages gm
    LEFT JOIN applications a ON a.id = gm.application_id
    LEFT JOIN jobs j ON j.id = a.job_id
    ORDER BY gm.received_at DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;
  return rows.map(toUiMessage);
}

function listSyncRuns(): GmailSyncRun[] {
  const rows = db.prepare(`
    SELECT id, trigger, status, messages_seen AS messagesSeen, relevant_messages AS relevantMessages,
           new_messages AS newMessages, matched_messages AS matchedMessages, ai_classified AS aiClassified,
           duration_ms AS durationMs, error_message AS errorMessage, started_at AS startedAt, completed_at AS completedAt
    FROM gmail_sync_runs ORDER BY id DESC LIMIT 10
  `).all();
  return z.array(GmailSyncRunSchema).parse(rows);
}

export function getGmailOverview(): GmailOverview {
  const messages = listMessages();
  const applications = listApplicationCandidates().map((item) => {
    const outcome = ApplicationOutcomeSchema.safeParse(item.outcome);
    return {
      applicationId: item.applicationId,
      jobId: item.jobId,
      title: item.title,
      company: item.company,
      state: item.state,
      outcome: outcome.success ? outcome.data : "ACTIVE",
      submittedAt: item.submittedAt
    };
  });
  return GmailOverviewSchema.parse({
    settings: gmailConnectionStatus(),
    counts: {
      total: messages.length,
      pending: messages.filter((item) => item.actionStatus === "PENDING").length,
      interviews: messages.filter((item) => item.classification === "INTERVIEW").length,
      assessments: messages.filter((item) => item.classification === "ASSESSMENT").length,
      offers: messages.filter((item) => item.classification === "OFFER").length,
      rejections: messages.filter((item) => item.classification === "REJECTION").length,
      unmatched: messages.filter((item) => item.applicationId == null).length
    },
    messages,
    applications,
    recentRuns: listSyncRuns(),
    generatedAt: new Date().toISOString()
  });
}

async function performSync(trigger: string): Promise<GmailOverview> {
  const started = Date.now();
  const settings = settingsRow();
  if (!readToken() || !settings.connected_email) throw new Error("Connect Gmail before syncing.");
  const info = db.prepare("INSERT INTO gmail_sync_runs (trigger, status) VALUES (?, 'RUNNING')").run(trigger);
  const runId = Number(info.lastInsertRowid);
  db.prepare("UPDATE gmail_settings SET last_sync_started_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run();
  let seen = 0, relevant = 0, fresh = 0, matched = 0, aiClassified = 0;
  try {
    const candidates = listApplicationCandidates();
    pruneStoredNoise();
    const query = settings.last_sync_at ? incrementalSearchQuery(settings.last_sync_at) : initialSearchQuery(settings.lookback_days, candidates);
    const list = await gmailFetch<{ messages?: Array<{ id?: string; threadId?: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(`/messages?maxResults=200&q=${encodeURIComponent(query)}`);
    const ids = (list.messages ?? []).flatMap((message) => message.id ? [message.id] : []);
    seen = ids.length;

    db.prepare("DELETE FROM gmail_seen_messages WHERE datetime(seen_at) < datetime('now', '-180 days')").run();
    for (const id of ids) {
      const existing = db.prepare("SELECT gmail_id FROM gmail_messages WHERE gmail_id = ? UNION SELECT gmail_id FROM gmail_seen_messages WHERE gmail_id = ? LIMIT 1").get(id, id);
      if (existing) continue;
      const full = await gmailFetch<GmailApiMessage>(`/messages/${encodeURIComponent(id)}?format=full`);
      const message = parseMessage(full);
      db.prepare("INSERT OR IGNORE INTO gmail_seen_messages (gmail_id) VALUES (?)").run(id);
      const match = matchApplication(message, candidates);
      if (!careerRelevant(message, match)) continue;
      relevant += 1;
      fresh += 1;
      if (match.applicationId) matched += 1;
      const heuristic = heuristicClassification(message);
      let classification = heuristic;
      const shouldUseAi = heuristic.confidence < 0.9 && (Boolean(match.applicationId) || heuristic.classification !== "OTHER" || directApplicationSubject(message.subject));
      if (shouldUseAi && aiClassified < 5) {
        classification = await classifyWithLocalAi(message, match, heuristic);
        if (classification.aiUsed) aiClassified += 1;
      }
      const outcome = suggestedOutcome(classification.classification);
      db.prepare(`
        INSERT INTO gmail_messages (
          gmail_id, thread_id, rfc_message_id, from_email, from_name, to_email, subject, snippet, body_text,
          received_at, internal_date, labels_json, application_id, match_confidence, classification,
          classification_confidence, summary, details_json, suggested_outcome, action_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.gmailId, message.threadId, message.rfcMessageId, message.fromEmail, message.fromName, message.toEmail,
        message.subject, message.snippet, message.bodyText, message.receivedAt, message.internalDate, JSON.stringify(message.labels),
        match.applicationId, match.confidence, classification.classification, classification.confidence, classification.summary,
        JSON.stringify(classification.details), outcome, actionStatus(classification.classification, Boolean(match.applicationId))
      );
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - started;
    db.prepare(`
      UPDATE gmail_sync_runs SET status = 'COMPLETED', messages_seen = ?, relevant_messages = ?, new_messages = ?,
        matched_messages = ?, ai_classified = ?, duration_ms = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(seen, relevant, fresh, matched, aiClassified, durationMs, runId);
    db.prepare(`
      UPDATE gmail_settings SET last_sync_at = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1
    `).run(completedAt);
    return getGmailOverview();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE gmail_sync_runs SET status = 'FAILED', messages_seen = ?, relevant_messages = ?, new_messages = ?,
        matched_messages = ?, ai_classified = ?, duration_ms = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(seen, relevant, fresh, matched, aiClassified, Date.now() - started, message, runId);
    db.prepare("UPDATE gmail_settings SET last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run(message);
    throw error;
  }
}

export async function syncGmail(trigger = "manual") {
  if (syncPromise) return syncPromise;
  syncPromise = performSync(trigger).finally(() => { syncPromise = null; });
  return syncPromise;
}

export function setGmailMessageApplication(gmailId: string, applicationId: number | null) {
  if (applicationId != null) {
    const exists = db.prepare("SELECT id FROM applications WHERE id = ?").get(applicationId);
    if (!exists) throw new Error("Application not found.");
  }
  const result = db.prepare(`
    UPDATE gmail_messages
    SET application_id = ?, match_confidence = ?, action_status = CASE WHEN classification IN ('APPLICATION_ACK','OTHER') THEN 'INFO' ELSE 'PENDING' END,
        updated_at = CURRENT_TIMESTAMP
    WHERE gmail_id = ?
  `).run(applicationId, applicationId == null ? 0 : 1, gmailId);
  if (!result.changes) throw new Error("Gmail message not found.");
  return getGmailOverview();
}

function messageForAction(gmailId: string) {
  const row = db.prepare(`
    SELECT gm.*, j.title, j.company
    FROM gmail_messages gm
    LEFT JOIN applications a ON a.id = gm.application_id
    LEFT JOIN jobs j ON j.id = a.job_id
    WHERE gm.gmail_id = ?
  `).get(gmailId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Gmail message not found.");
  return row;
}

function eventTitle(classification: GmailClassification) {
  const titles: Record<GmailClassification, string> = {
    INTERVIEW: "Interview email received",
    ASSESSMENT: "Assessment requested by email",
    OFFER: "Offer email received",
    REJECTION: "Rejection email received",
    RECRUITER_REPLY: "Recruiter replied",
    APPLICATION_ACK: "Application acknowledgement received",
    OTHER: "Career email received"
  };
  return titles[classification];
}

export function confirmGmailMessageAction(gmailId: string) {
  const row = messageForAction(gmailId);
  const applicationId = row.application_id == null ? null : Number(row.application_id);
  if (!applicationId) throw new Error("Match this email to an application before confirming it.");
  const classification = GmailClassificationSchema.parse(row.classification);
  const outcome = row.suggested_outcome ? ApplicationOutcomeSchema.parse(row.suggested_outcome) : null;
  const details = parseDetails(String(row.details_json ?? "{}"));
  const summary = String(row.summary ?? "");
  const detailBits = [
    details.interviewDate && `Date: ${details.interviewDate}`,
    details.interviewTime && `Time: ${details.interviewTime}`,
    details.timezone && `Timezone: ${details.timezone}`,
    details.assessmentDeadline && `Deadline: ${details.assessmentDeadline}`,
    details.assessmentPlatform && `Platform: ${details.assessmentPlatform}`,
    details.meetingLink && `Meeting: ${details.meetingLink}`
  ].filter(Boolean).join(" · ");
  const note = [summary, detailBits, `Email: ${String(row.subject ?? "")}`].filter(Boolean).join("\n");

  if (outcome) {
    const result = setApplicationOutcome(applicationId, outcome, `Gmail-confirmed employer signal. ${summary}`.trim());
    if (!result.ok) throw new Error(result.reason === "not-submitted" ? "Mark the application submitted before confirming this employer outcome." : "Application not found.");
  }
  recordTrackerEvent(applicationId, `EMAIL_${classification}`, eventTitle(classification), note, {
    gmailId,
    threadId: row.thread_id,
    fromEmail: row.from_email,
    subject: row.subject,
    receivedAt: row.received_at,
    classification,
    details
  });
  db.prepare("UPDATE gmail_messages SET action_status = 'APPLIED', confirmed_at = CURRENT_TIMESTAMP, ignored_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE gmail_id = ?").run(gmailId);
  return getGmailOverview();
}

export function ignoreGmailMessage(gmailId: string) {
  const result = db.prepare("UPDATE gmail_messages SET action_status = 'IGNORED', ignored_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE gmail_id = ?").run(gmailId);
  if (!result.changes) throw new Error("Gmail message not found.");
  return getGmailOverview();
}

function profileName() {
  const row = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
  if (!row) return "";
  try {
    const profile = ProfileSchema.parse(JSON.parse(row.data_json));
    return [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  } catch { return ""; }
}

export function buildGmailReplyDraft(gmailId: string) {
  const row = messageForAction(gmailId);
  const classification = GmailClassificationSchema.parse(row.classification);
  const name = profileName();
  const signoff = name ? `Kind regards,\n${name}` : "Kind regards,";
  const title = String(row.title ?? "the position");
  const company = String(row.company ?? "your organisation");
  let body = `Dear Hiring Team,\n\nThank you for the update regarding the ${title} position at ${company}. I remain very interested in the opportunity.\n\n${signoff}`;
  if (classification === "INTERVIEW") body = `Dear Hiring Team,\n\nThank you for the invitation to interview for the ${title} position at ${company}. I am very pleased to continue in the process. Please let me know if there is anything you would like me to prepare in advance.\n\n${signoff}`;
  if (classification === "ASSESSMENT") body = `Dear Hiring Team,\n\nThank you for sending the assessment for the ${title} position at ${company}. I confirm that I have received it and will review the instructions carefully.\n\n${signoff}`;
  if (classification === "OFFER") body = `Dear Hiring Team,\n\nThank you very much for the update and for the offer regarding the ${title} position at ${company}. I appreciate it and will review the details carefully.\n\n${signoff}`;
  const subject = /^re:/i.test(String(row.subject ?? "")) ? String(row.subject) : `Re: ${String(row.subject ?? title)}`;
  const to = String(row.from_email ?? "");
  const params = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  return { to, subject, body, composeUrl: `https://mail.google.com/mail/?${params.toString()}` };
}

export function applicationHasEmployerEmailResponse(applicationId: number) {
  const row = db.prepare(`
    SELECT 1
    FROM gmail_messages gm
    JOIN applications a ON a.id = gm.application_id
    WHERE gm.application_id = ?
      AND gm.classification IN ('INTERVIEW','ASSESSMENT','OFFER','REJECTION','RECRUITER_REPLY')
      AND gm.action_status != 'IGNORED'
      AND gm.classification_confidence >= 0.70
      AND (a.submitted_at IS NULL OR datetime(gm.received_at) >= datetime(a.submitted_at))
    LIMIT 1
  `).get(applicationId);
  return Boolean(row);
}

export function startGmailSyncScheduler(logger?: { info?: (...args: any[]) => void; error?: (...args: any[]) => void }) {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    if (stopped) return;
    try {
      const settings = gmailConnectionStatus();
      if (settings.connected && settings.syncEnabled && !settings.syncing) {
        const last = settings.lastSyncAt ? new Date(settings.lastSyncAt).getTime() : 0;
        const due = !last || Date.now() - last >= settings.intervalMinutes * 60_000;
        if (due) {
          logger?.info?.({ email: settings.email }, "M10 scheduled Gmail sync started");
          await syncGmail("scheduled");
          logger?.info?.({ email: settings.email }, "M10 scheduled Gmail sync completed");
        }
      }
    } catch (error) {
      logger?.error?.({ err: error }, "M10 scheduled Gmail sync failed");
    } finally {
      if (!stopped) timer = setTimeout(tick, 60_000);
    }
  };
  timer = setTimeout(tick, 20_000);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export function runGmailRegressionFixtures() {
  const base = (overrides: Partial<ParsedMessage>): ParsedMessage => ({
    gmailId: "fixture",
    threadId: "fixture-thread",
    rfcMessageId: "<fixture@example.com>",
    fromEmail: "recruiter@example-tech.com",
    fromName: "Example Tech Talent",
    toEmail: "candidate@example.com",
    subject: "",
    snippet: "",
    bodyText: "",
    receivedAt: new Date().toISOString(),
    internalDate: Date.now(),
    labels: ["INBOX"],
    ...overrides
  });
  const interview = base({ subject: "Interview invitation - Software Engineer", bodyText: "We would like to invite you to an interview for the Software Engineer role at Example Tech. Please join https://meet.google.com/abc-defg-hij" });
  const rejection = base({ gmailId: "fixture-rejection", subject: "Application update", bodyText: "Unfortunately, we have decided to move forward with other candidates." });
  const assessment = base({ gmailId: "fixture-assessment", subject: "Technical assessment", bodyText: "Please complete the coding challenge on HackerRank as the next step." });
  const indeedAlert = base({ gmailId: "fixture-indeed-alert", fromEmail: "donotreply@match.indeed.com", fromName: "Indeed", subject: "AI Support Engineer @ OpenAI", bodyText: "New jobs matching your search. Apply now." });
  const glassdoorCommunity = base({ gmailId: "fixture-glassdoor-community", fromEmail: "noreply@glassdoor.com", fromName: "Glassdoor Community", subject: "I accepted the job offer. Now what?", bodyText: "Community discussion about accepting an offer." });
  const directReply = base({ gmailId: "fixture-direct-reply", fromEmail: "manager@example.org", fromName: "Hiring Manager", subject: "Re: Software Engineer application", bodyText: "Thanks Candidate. We will be in touch with next steps." });
  return {
    scope: GMAIL_SCOPE,
    interview: { match: matchApplication(interview), classification: heuristicClassification(interview) },
    rejection: heuristicClassification(rejection),
    assessment: heuristicClassification(assessment),
    noise: {
      indeed: careerRelevant(indeedAlert, matchApplication(indeedAlert)),
      glassdoor: careerRelevant(glassdoorCommunity, matchApplication(glassdoorCommunity))
    },
    directReplyRelevant: careerRelevant(directReply, matchApplication(directReply))
  };
}
