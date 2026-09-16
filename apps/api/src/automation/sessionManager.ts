import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { ApplicationPackageGenerationSchema, CandidateFactsSchema, CoverLetterSchema, ProfileSchema, ScreeningAnswerSchema, type BrowserSessionResult, type ScreeningAnswer } from "@apply-lite/shared";
import { config } from "../config.js";
import { db } from "../db/database.js";
import { genericAdapter } from "./adapters/generic.js";
import { detectAts } from "./detect.js";
import type { AnswerCandidate } from "./adapters/types.js";
import { draftFormQuestions, formQuestionDraftability } from "../services/formQuestionAssistant.js";

interface ManagedSession {
  applicationId: number;
  jobId: number;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  resumePath: string;
  coverLetterPath: string;
  resumeFilename: string;
  coverLetterFilename: string;
  screeningAnswers: ScreeningAnswer[];
  formAnswerDrafts: ScreeningAnswer[];
  answers: AnswerCandidate[];
  lastResult: BrowserSessionResult;
}

const sessions = new Map<number, ManagedSession>();

function loadProfile() {
  const row = db.prepare("SELECT data_json FROM profile WHERE id = 1").get() as { data_json: string } | undefined;
  const profile = row ? ProfileSchema.parse(JSON.parse(row.data_json)) : ProfileSchema.parse({});
  if (!profile.firstName.trim() || !profile.lastName.trim()) {
    const cvRow = db.prepare("SELECT facts_json AS factsJson FROM cv_documents ORDER BY id DESC LIMIT 1").get() as { factsJson: string } | undefined;
    if (cvRow) {
      try {
        const facts = CandidateFactsSchema.parse(JSON.parse(cvRow.factsJson));
        const parts = facts.fullName.trim().split(/\s+/).filter(Boolean);
        if (!profile.firstName.trim() && parts.length) profile.firstName = parts[0];
        if (!profile.lastName.trim() && parts.length > 1) profile.lastName = parts.slice(1).join(" ");
      } catch {
        // Profile remains the source of truth if CV identity parsing is unavailable.
      }
    }
  }
  return profile;
}

function loadAnswerCandidates(): AnswerCandidate[] {
  const rows = db.prepare("SELECT key, label, value FROM answer_library WHERE TRIM(value) <> '' ORDER BY id").all() as Array<{ key: string; label: string; value: string }>;
  return rows.map((row) => ({ key: row.key, label: row.label, value: row.value, source: "answer-library" as const }));
}

function safeArtifactPath(storedPath: string) {
  const storageRoot = path.resolve(process.cwd(), config.storagePath);
  const absolutePath = path.resolve(process.cwd(), storedPath);
  const relative = path.relative(storageRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(absolutePath)) return "";
  return absolutePath;
}

function loadLatestPackage(jobId: number) {
  const packageRow = db.prepare("SELECT id, status, payload_json AS payloadJson, audit_json AS auditJson FROM application_packages WHERE job_id = ? ORDER BY id DESC LIMIT 1")
    .get(jobId) as { id: number; status: "PASS" | "REVIEW"; payloadJson: string; auditJson: string } | undefined;
  if (!packageRow) throw new Error("Generate and review an M3 application package before opening the application assistant.");

  const payload = JSON.parse(packageRow.payloadJson) as { tailoredCv?: unknown; coverLetter?: unknown; screeningAnswers?: unknown; generation?: unknown };
  const audit = JSON.parse(packageRow.auditJson || "{}") as { warnings?: unknown };
  const warnings = Array.isArray(audit.warnings) ? audit.warnings.filter((item): item is string => typeof item === "string") : [];
  const storedGeneration = ApplicationPackageGenerationSchema.safeParse(payload.generation);
  const legacyCriticalFailure = warnings.some((warning) => /AI (resume selection|cover-letter drafting) could not complete/i.test(warning));
  const readyToUse = storedGeneration.success ? storedGeneration.data.readyToUse : !legacyCriticalFailure;
  if (!readyToUse) {
    throw new Error("The latest M3 package is degraded because local AI could not complete the resume or cover letter. Regenerate the package before opening the application assistant; ApplyLite will not auto-upload fallback documents.");
  }

  const parsed = ScreeningAnswerSchema.array().parse(payload.screeningAnswers ?? []);
  let safeScreeningAnswers = packageRow.status === "PASS" ? parsed : parsed.filter((answer) => answer.source === "answer-library");
  if (packageRow.status === "PASS" && payload.coverLetter) {
    try {
      const letter = CoverLetterSchema.parse(payload.coverLetter);
      const profile = loadProfile();
      const signature = `${profile.firstName} ${profile.lastName}`.trim();
      safeScreeningAnswers = [...safeScreeningAnswers, ScreeningAnswerSchema.parse({
        key: "cover_letter",
        question: "Cover letter",
        answer: [letter.salutation, ...letter.paragraphs.map((paragraph) => paragraph.text), letter.closing, signature].filter(Boolean).join("\n\n"),
        evidenceIds: letter.paragraphs.flatMap((paragraph) => paragraph.evidenceIds),
        source: "generated",
        needsReview: true
      })];
    } catch {
      // The PDF upload path remains available even if cover-letter text hydration fails.
    }
  }
  const artifacts = db.prepare("SELECT kind, path FROM generated_artifacts WHERE package_id = ?").all(packageRow.id) as Array<{ kind: string; path: string }>;
  const cv = artifacts.find((item) => item.kind === "tailored_cv_pdf");
  const cover = artifacts.find((item) => item.kind === "cover_letter_pdf");
  const resumePath = cv ? safeArtifactPath(cv.path) : "";
  const coverLetterPath = cover ? safeArtifactPath(cover.path) : "";
  if (!resumePath) throw new Error("The latest M3 package does not contain an accessible tailored CV. Regenerate the package first.");
  return {
    packageId: packageRow.id,
    screeningAnswers: safeScreeningAnswers,
    resumePath,
    coverLetterPath,
    resumeFilename: path.basename(resumePath),
    coverLetterFilename: coverLetterPath ? path.basename(coverLetterPath) : ""
  };
}

async function hasApplicationForm(page: Page) {
  const identity = page.locator('input[type="email"], input[name*="email" i], input[name*="first" i], input[name*="last" i], input[type="file"], textarea');
  return (await identity.count()) >= 2;
}

async function navigateToApplicationForm(page: Page) {
  if (await hasApplicationForm(page)) return;

  const applyLinks = page.getByRole("link", { name: /apply|apply now|apply for (this|the) (job|role|position)|start application/i });
  for (let i = 0; i < await applyLinks.count(); i++) {
    const link = applyLinks.nth(i);
    if (!(await link.isVisible().catch(() => false))) continue;
    const href = await link.getAttribute("href");
    if (!href) continue;
    try {
      const target = new URL(href, page.url()).toString();
      if (!/^https?:/i.test(target)) continue;
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(800);
      return;
    } catch {
      // Try the next visible application link.
    }
  }

  // Some boards reveal the application with a non-submit button. This is only
  // attempted when no application form is currently present.
  const buttons = page.getByRole("button", { name: /^(apply|apply now|start application)$/i });
  for (let i = 0; i < await buttons.count(); i++) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    const type = ((await button.getAttribute("type")) ?? "button").toLowerCase();
    if (type === "submit") continue;
    try {
      await button.click();
      await page.waitForTimeout(900);
      return;
    } catch {
      // Leave the page open for the user if navigation cannot be automated safely.
    }
  }
}

async function scanSession(session: ManagedSession): Promise<BrowserSessionResult> {
  const profile = loadProfile();
  const prepared = await genericAdapter.prepare({
    page: session.page,
    profile,
    answers: session.answers,
    screeningAnswers: [...session.screeningAnswers, ...session.formAnswerDrafts],
    resumePath: session.resumePath,
    coverLetterPath: session.coverLetterPath
  });
  const result: BrowserSessionResult = {
    active: true,
    applicationId: session.applicationId,
    jobId: session.jobId,
    ats: detectAts(session.page.url()),
    finalUrl: prepared.finalUrl,
    pageTitle: prepared.pageTitle,
    filled: [...new Set(prepared.filled)],
    uploaded: [...new Set(prepared.uploaded)],
    unknownQuestions: [...new Set(prepared.unknownQuestions)],
    manualQuestions: [...new Set(prepared.manualQuestions)],
    formAnswerDrafts: session.formAnswerDrafts,
    fieldResults: prepared.fieldResults.map((field) => ({
      ...field,
      fieldKey: field.fieldKey ?? "",
      confidence: field.confidence ?? 0,
      learned: field.learned ?? false
    })),
    submitDetected: prepared.submitDetected,
    captchaDetected: prepared.captchaDetected,
    loginDetected: prepared.loginDetected,
    resumeFilename: session.resumeFilename,
    coverLetterFilename: session.coverLetterFilename,
    message: prepared.captchaDetected
      ? "CAPTCHA or human verification detected. Complete it manually in the browser, then refill the current step."
      : prepared.loginDetected
        ? "A sign-in/password step is present. Complete authentication manually, then refill the current step."
        : prepared.submitDetected
          ? "A possible final submission control is visible. ApplyLite will not click it; review the entire form and submit manually."
          : "Current application step filled where high-confidence evidence was available. Review the browser before continuing.",
    lastScanAt: new Date().toISOString()
  };
  session.lastResult = result;
  return result;
}

function emptyClosedResult(applicationId: number, jobId: number, ats = "unknown"): BrowserSessionResult {
  return {
    active: false,
    applicationId,
    jobId,
    ats,
    finalUrl: "",
    pageTitle: "",
    filled: [],
    uploaded: [],
    unknownQuestions: [],
    manualQuestions: [],
    formAnswerDrafts: [],
    fieldResults: [],
    submitDetected: false,
    captchaDetected: false,
    loginDetected: false,
    resumeFilename: "",
    coverLetterFilename: "",
    message: "No interactive application browser is currently open.",
    lastScanAt: new Date().toISOString()
  };
}

export async function startApplicationBrowser(applicationId: number) {
  const existing = sessions.get(applicationId);
  if (existing && existing.browser.isConnected() && !existing.page.isClosed()) {
    return scanSession(existing);
  }

  const row = db.prepare(`
    SELECT a.id AS applicationId, a.job_id AS jobId, j.source_url AS sourceUrl, j.ats AS ats
    FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?
  `).get(applicationId) as { applicationId: number; jobId: number; sourceUrl: string; ats: string } | undefined;
  if (!row) throw new Error("Application not found");
  if (!row.sourceUrl) throw new Error("This job has no source URL, so ApplyLite cannot open the employer application page.");

  const packageData = loadLatestPackage(row.jobId);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const session: ManagedSession = {
    applicationId,
    jobId: row.jobId,
    browser,
    context,
    page,
    resumePath: packageData.resumePath,
    coverLetterPath: packageData.coverLetterPath,
    resumeFilename: packageData.resumeFilename,
    coverLetterFilename: packageData.coverLetterFilename,
    screeningAnswers: packageData.screeningAnswers,
    formAnswerDrafts: [],
    answers: loadAnswerCandidates(),
    lastResult: emptyClosedResult(applicationId, row.jobId, row.ats)
  };
  sessions.set(applicationId, session);

  browser.on("disconnected", () => sessions.delete(applicationId));
  page.on("close", () => {
    if (sessions.get(applicationId)?.page === page) sessions.delete(applicationId);
    if (browser.isConnected()) void browser.close().catch(() => undefined);
  });

  try {
    await page.goto(row.sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(600);
    await navigateToApplicationForm(page);
    return await scanSession(session);
  } catch (error) {
    await closeApplicationBrowser(applicationId).catch(() => undefined);
    throw error;
  }
}

export async function fillCurrentApplicationStep(applicationId: number) {
  const session = sessions.get(applicationId);
  if (!session || !session.browser.isConnected() || session.page.isClosed()) {
    throw new Error("No active browser session. Open the application browser first.");
  }
  return scanSession(session);
}

export async function draftCurrentApplicationQuestions(applicationId: number) {
  const session = sessions.get(applicationId);
  if (!session || !session.browser.isConnected() || session.page.isClosed()) {
    throw new Error("No active browser session. Open the application browser first.");
  }

  const fresh = await scanSession(session);
  const existing = new Set(session.formAnswerDrafts.map((answer) => answer.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const candidates = fresh.fieldResults
    .filter((field) => field.status === "unknown")
    .map((field) => ({ question: field.label, controlType: field.controlType }))
    .filter((item) => !existing.has(item.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()))
    .filter((item) => formQuestionDraftability(item.question, item.controlType).draftable);

  if (!candidates.length) {
    return { ...fresh, message: "No new safe open-ended form questions need drafting. Profile URLs, visa/work-authorisation, compensation, demographics and prior-employer facts stay manual unless you have saved an explicit answer." };
  }

  const drafts = await draftFormQuestions(session.jobId, candidates);
  if (!drafts.length) {
    return { ...fresh, message: "ApplyLite could not produce a sufficiently evidence-grounded answer for the current unknown questions. They remain manual rather than being guessed." };
  }

  const byQuestion = new Map(session.formAnswerDrafts.map((answer) => [answer.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), answer]));
  for (const draft of drafts) byQuestion.set(draft.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), draft);
  session.formAnswerDrafts = [...byQuestion.values()];

  const rescanned = await scanSession(session);
  const result = {
    ...rescanned,
    message: `Drafted ${drafts.length} answer${drafts.length === 1 ? "" : "s"} from the actual employer form and filled high-confidence matches. Review every generated answer in ApplyLite and Chromium before submitting.`
  };
  session.lastResult = result;
  return result;
}

export function getApplicationBrowserStatus(applicationId: number): BrowserSessionResult | null {
  const session = sessions.get(applicationId);
  if (!session || !session.browser.isConnected() || session.page.isClosed()) return null;
  return { ...session.lastResult, active: true, finalUrl: session.page.url() };
}

export async function closeApplicationBrowser(applicationId: number) {
  const session = sessions.get(applicationId);
  if (!session) return false;
  sessions.delete(applicationId);
  try { await session.context.close(); } catch { /* already closed */ }
  try { await session.browser.close(); } catch { /* already closed */ }
  return true;
}

export async function closeAllApplicationBrowsers() {
  await Promise.all([...sessions.keys()].map((id) => closeApplicationBrowser(id)));
}
