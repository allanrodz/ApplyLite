import { lookup } from "node:dns/promises";
import net from "node:net";
import { chromium, type Browser } from "playwright";
import { z } from "zod";
import { ExtractedJobSchema, JobRequirementsSchema, type ExtractedJob, type JobRequirements } from "@apply-lite/shared";
import { askOllamaStructured } from "./ollama.js";
import { detectAts } from "../automation/detect.js";

const PAGE_TIMEOUT_MS = 45_000;
const ATS_API_TIMEOUT_MS = 15_000;
const MAX_SOURCE_CHARS = 36_000;

export type JobPageEvidence = {
  requestedUrl: string;
  finalUrl: string;
  ats: string;
  pageTitle: string;
  heading: string;
  metaDescription: string;
  bodyText: string;
  jobPostingJsonLd: string;
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

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  return a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0;
}

function isPrivateIpv6(address: string) {
  const value = address.toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
}

function isPrivateAddress(address: string) {
  const kind = net.isIP(address);
  if (kind === 4) return isPrivateIpv4(address);
  if (kind === 6) return isPrivateIpv6(address);
  return false;
}

async function assertPublicHttpUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid http(s) job URL.");
  }

  if (!( ["http:", "https:"] as string[]).includes(url.protocol)) {
    throw new Error("Only http(s) job URLs are supported.");
  }
  if (url.username || url.password) throw new Error("Job URLs with embedded credentials are not supported.");

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local/private URLs cannot be imported.");
  }
  if (isPrivateAddress(hostname)) throw new Error("Local/private URLs cannot be imported.");

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new Error("Local/private URLs cannot be imported.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Local/private")) throw error;
    throw new Error(`Could not resolve job host: ${hostname}`);
  }

  return url;
}

function compactText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value: string) {
  return compactText(decodeBasicEntities(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " "));
}

function leverParts(url: URL) {
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "jobs.lever.co" && hostname !== "jobs.eu.lever.co") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.at(-1)?.toLowerCase() === "apply") parts.pop();
  if (parts.length < 2) return null;

  return {
    site: parts[0],
    postingId: parts[1],
    apiBase: hostname === "jobs.eu.lever.co" ? "https://api.eu.lever.co" : "https://api.lever.co"
  };
}

async function tryReadLeverPosting(url: URL): Promise<JobPageEvidence | null> {
  const parts = leverParts(url);
  if (!parts) return null;

  const apiUrl = `${parts.apiBase}/v0/postings/${encodeURIComponent(parts.site)}/${encodeURIComponent(parts.postingId)}`;

  try {
    const response = await fetch(apiUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(ATS_API_TIMEOUT_MS)
    });
    if (!response.ok) return null;

    const posting = await response.json() as LeverPosting;
    if (!posting || typeof posting !== "object") return null;

    const listText = (posting.lists ?? [])
      .map((item) => `${item.text ?? ""}\n${stripHtml(item.content ?? "")}`)
      .join("\n\n");

    const metadata = [
      posting.categories?.location ? `Location: ${posting.categories.location}` : "",
      posting.categories?.commitment ? `Employment type: ${posting.categories.commitment}` : "",
      posting.categories?.team ? `Team: ${posting.categories.team}` : "",
      posting.categories?.department ? `Department: ${posting.categories.department}` : "",
      posting.workplaceType ? `Workplace type: ${posting.workplaceType}` : "",
      posting.salaryDescriptionPlain ? `Salary: ${posting.salaryDescriptionPlain}` : ""
    ].filter(Boolean).join("\n");

    const bodyText = compactText([
      posting.openingPlain ?? "",
      posting.descriptionPlain ?? posting.descriptionBodyPlain ?? "",
      listText,
      posting.additionalPlain ?? "",
      metadata
    ].filter(Boolean).join("\n\n")).slice(0, MAX_SOURCE_CHARS);

    if (bodyText.length < 100 || !posting.text) return null;

    return {
      requestedUrl: url.toString(),
      finalUrl: posting.hostedUrl || url.toString(),
      ats: "lever",
      pageTitle: compactText(posting.text),
      heading: compactText(posting.text),
      metaDescription: compactText(posting.openingPlain ?? "").slice(0, 600),
      bodyText,
      jobPostingJsonLd: JSON.stringify(posting).slice(0, 12_000)
    };
  } catch {
    // The public Lever API is an optimization, not a single point of failure.
    // Fall through to the browser reader below.
    return null;
  }
}

async function readWithBrowser(url: URL): Promise<JobPageEvidence> {
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/executable.*doesn.t exist|browser.*not found|install/i.test(message)) {
      throw new Error("Playwright Chromium is not installed for this ApplyLite version. Run: npx playwright install chromium");
    }
    throw error;
  }

  try {
    const context = await browser.newContext({
      locale: "en-IE",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);

    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    const pageData = await page.evaluate(() => {
      const bodyText = document.body?.innerText ?? "";
      const pageTitle = document.title ?? "";
      const heading = document.querySelector("h1")?.textContent?.trim() ?? "";
      const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
      const jsonLdBlocks: unknown[] = [];

      function collectJobPosting(value: unknown) {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) {
          value.forEach(collectJobPosting);
          return;
        }
        const record = value as Record<string, unknown>;
        const rawType = record["@type"];
        const types = Array.isArray(rawType) ? rawType.map(String) : [String(rawType ?? "")];
        if (types.some((type) => type.toLowerCase() === "jobposting")) jsonLdBlocks.push(record);
        const graph = record["@graph"];
        if (graph) collectJobPosting(graph);
      }

      document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
        const text = script.textContent?.trim();
        if (!text) return;
        try {
          collectJobPosting(JSON.parse(text));
        } catch {
          // Invalid JSON-LD is common; visible text remains our fallback evidence.
        }
      });

      return { bodyText, pageTitle, heading, metaDescription, jsonLdBlocks };
    });

    const bodyText = compactText(pageData.bodyText).slice(0, MAX_SOURCE_CHARS);
    const finalUrl = page.url();
    const gateText = `${pageData.pageTitle}\n${bodyText.slice(0, 2500)}`.toLowerCase();
    if (/captcha|verify you are human|access denied|unusual traffic|sign in to continue/.test(gateText) && bodyText.length < 3500) {
      throw new Error("This job page is behind a login or anti-bot check. Use manual import for this posting.");
    }
    if (bodyText.length < 200 && pageData.jsonLdBlocks.length === 0) {
      throw new Error("ApplyLite could not read enough job content from this URL. Use manual import for this posting.");
    }

    return {
      requestedUrl: url.toString(),
      finalUrl,
      ats: detectAts(finalUrl),
      pageTitle: compactText(pageData.pageTitle),
      heading: compactText(pageData.heading),
      metaDescription: compactText(pageData.metaDescription),
      bodyText,
      jobPostingJsonLd: JSON.stringify(pageData.jsonLdBlocks).slice(0, 12_000)
    };
  } finally {
    await browser.close();
  }
}

export async function readJobPage(rawUrl: string): Promise<JobPageEvidence> {
  const url = await assertPublicHttpUrl(rawUrl);

  // Prefer first-party/public ATS data when available. It is faster and much
  // less brittle than browser automation. This is also the foundation for M2.1 discovery.
  const leverEvidence = await tryReadLeverPosting(url);
  if (leverEvidence) return leverEvidence;

  return readWithBrowser(url);
}

function jobExtractionPrompt(evidence: JobPageEvidence) {
  return `You are extracting a job posting into factual structured data for a local job-application assistant.

STRICT RULES:
- Use ONLY information explicitly present in the source evidence below.
- Never invent the employer, title, location, salary, skills, experience, qualifications, benefits, or working arrangement.
- requiredSkills means technologies/skills explicitly required or clearly described as essential/must-have.
- preferredSkills means technologies/skills explicitly described as preferred, desirable, nice-to-have, bonus, or advantageous.
- Do not put generic personality words such as "motivated" or "team player" in requiredSkills.
- requiredExperienceYears must be a number only when the posting explicitly states a minimum number of years. Otherwise use null.
- workplaceType must be remote, hybrid, onsite, or unknown based only on explicit evidence.
- Keep description factual and concise, but include the core purpose of the role.
- warnings should identify ambiguity, missing fields, conflicting locations, or anything uncertain.
- Empty/unknown fields must use empty strings, empty arrays, null, or "unknown" as appropriate.

PAGE METADATA:
URL: ${evidence.finalUrl}
Detected ATS: ${evidence.ats}
Browser/API title: ${evidence.pageTitle}
H1/job title: ${evidence.heading}
Meta/opening description: ${evidence.metaDescription}

STRUCTURED ATS / JOBPOSTING DATA (if present):
${evidence.jobPostingJsonLd || "none"}

VISIBLE / API JOB TEXT:
${evidence.bodyText}

/no_think`;
}


function discoveryRequirementsPrompt(evidence: JobPageEvidence) {
  const structured = evidence.jobPostingJsonLd.slice(0, 3_000);
  const body = evidence.bodyText.slice(0, 12_000);
  return `You are extracting ONLY the requirements needed to rank a job for a local job-search assistant.

STRICT RULES:
- Use ONLY explicit evidence from the posting.
- requiredSkills: skills/technologies explicitly required, essential, or clearly expected in the role.
- preferredSkills: only skills explicitly described as preferred, desirable, advantageous, bonus, or nice-to-have.
- Do not include generic personality traits.
- requiredExperienceYears: explicit minimum years only; otherwise null.
- workplaceType: remote, hybrid, onsite, or unknown only from explicit evidence.
- Keep responsibilities and qualifications concise; avoid repeating the same requirement in multiple forms.
- warnings should flag ambiguity or conflicting evidence.
- Do not generate or rewrite the full job description.

TITLE: ${evidence.heading}
ATS: ${evidence.ats}
LOCATION/METADATA: ${evidence.metaDescription}

STRUCTURED ATS DATA:
${structured || "none"}

JOB TEXT:
${body}

/no_think`;
}

export async function extractRequirementsFromEvidence(evidence: JobPageEvidence): Promise<JobRequirements> {
  const schema = z.toJSONSchema(JobRequirementsSchema);
  let raw: unknown;
  try {
    raw = await askOllamaStructured<unknown>(discoveryRequirementsPrompt(evidence), schema, {
      numPredict: 1600,
      numCtx: 6144
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Local AI requirement extraction failed: ${message}`);
  }

  const parsed = JobRequirementsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Local AI returned invalid requirements${issue ? ` (${issue.path.join(".") || "root"}: ${issue.message})` : ""}.`);
  }
  return parsed.data;
}

export async function extractJobFromEvidence(evidence: JobPageEvidence): Promise<ExtractedJob> {
  const schema = z.toJSONSchema(ExtractedJobSchema);
  let raw: unknown;
  try {
    raw = await askOllamaStructured<unknown>(jobExtractionPrompt(evidence), schema);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`The job page was read, but local AI extraction failed: ${message}`);
  }

  const parsed = ExtractedJobSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Local AI returned an invalid job structure${issue ? ` (${issue.path.join(".") || "root"}: ${issue.message})` : ""}.`);
  }

  const extracted = parsed.data;
  const title = extracted.title.trim() || evidence.heading.trim();
  const company = extracted.company.trim();
  const description = extracted.description.trim() || evidence.metaDescription.trim() || evidence.bodyText.slice(0, 6_000);

  if (!title) throw new Error("ApplyLite could not identify the job title. Use manual import for this posting.");
  if (!company) throw new Error("ApplyLite could not identify the company. Use manual import for this posting.");
  if (description.length < 20) throw new Error("ApplyLite could not extract a usable job description.");

  return ExtractedJobSchema.parse({ ...extracted, title, company, description });
}

export async function extractJobFromUrl(rawUrl: string): Promise<{ extracted: ExtractedJob; evidence: JobPageEvidence }> {
  let evidence: JobPageEvidence;
  try {
    evidence = await readJobPage(rawUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read the job posting: ${message}`);
  }

  const extracted = await extractJobFromEvidence(evidence);
  return { extracted, evidence };
}
