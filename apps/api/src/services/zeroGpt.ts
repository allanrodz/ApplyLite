import { chromium } from "playwright";
import type { CoverLetter, TailoredCv } from "@apply-lite/shared";
import { config } from "../config.js";

export type ZeroGptDocumentKind = "cv" | "coverLetter";
export type ZeroGptDetection = {
  provider: "zerogpt-web";
  score: number;
  highlights: string[];
  checkedAt: string;
  sourceCharacterCount: number;
  directIdentifiersExcluded: true;
};

function cleanLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function sanitizedCvText(cv: TailoredCv) {
  const lines: string[] = [];
  if (cv.headline.trim()) lines.push(cv.headline.trim());
  if (cv.summary.trim()) lines.push(cv.summary.trim());
  if (cv.skills.length) lines.push(cv.skills.join(", "));
  for (const entry of cv.employment) {
    lines.push(entry.title);
    entry.bullets.forEach((bullet) => lines.push(bullet.text));
  }
  for (const project of cv.projects) {
    lines.push(project.name);
    if (project.description.trim()) lines.push(project.description);
    if (project.technologies.length) lines.push(project.technologies.join(", "));
    project.bullets.forEach((bullet) => lines.push(bullet.text));
  }
  for (const education of cv.education) {
    // Qualification/field are relevant content; omit institution and dates as indirect identifiers.
    lines.push([education.qualification, education.field].filter(Boolean).join(" — "));
    education.details.forEach((detail) => lines.push(detail));
  }
  return lines.map(cleanLine).filter(Boolean).join("\n");
}

export function sanitizedCoverLetterText(letter: CoverLetter) {
  return [
    letter.salutation,
    ...letter.paragraphs.map((paragraph) => paragraph.text),
    letter.closing
  ].map(cleanLine).filter(Boolean).join("\n\n");
}

export function parseZeroGptScore(value: string) {
  const match = value.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) throw new Error("ZeroGPT completed but ApplyLite could not read the AI percentage.");
  const score = Number(match[1]);
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("ZeroGPT returned an invalid AI percentage.");
  return score;
}

function uniqueHighlights(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value.replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || cleaned.length < 4 || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result.slice(0, 40);
}

async function hasVisibleHumanChallenge(page: import("playwright").Page) {
  const selectors = [
    'iframe[src*="captcha" i]',
    'iframe[src*="recaptcha" i]',
    'iframe[src*="turnstile" i]',
    '[data-sitekey]',
    'text=/verify you are human|complete the captcha|security check/i'
  ];
  for (const selector of selectors) {
    const nodes = page.locator(selector);
    const count = Math.min(await nodes.count(), 6);
    for (let index = 0; index < count; index += 1) {
      if (await nodes.nth(index).isVisible().catch(() => false)) return true;
    }
  }
  return false;
}

async function readZeroGptScoreText(page: import("playwright").Page) {
  const selectors = [
    "span.header-text.text-center",
    ".header-text.text-center",
    "span.header-text",
    '[class*="header-text"]'
  ];
  for (const selector of selectors) {
    const nodes = page.locator(selector);
    const count = Math.min(await nodes.count(), 12);
    for (let index = 0; index < count; index += 1) {
      const node = nodes.nth(index);
      if (!await node.isVisible().catch(() => false)) continue;
      const value = await node.innerText().catch(() => "");
      if (/\d+(?:\.\d+)?\s*%/.test(value) && /AI|GPT/i.test(value)) return value;
    }
  }

  const body = await page.locator("body").innerText().catch(() => "");
  const match = body.match(/(\d+(?:\.\d+)?)\s*%\s*(?:AI\s*GPT\*?|AI\s*(?:generated|content))/i);
  return match?.[0] ?? "";
}

async function waitForZeroGptScore(page: import("playwright").Page, interactive: boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let challengeSeen = false;
  while (Date.now() < deadline) {
    const challengeVisible = await hasVisibleHumanChallenge(page);
    if (challengeVisible) {
      challengeSeen = true;
      if (!interactive) {
        throw new Error("ZeroGPT requested visible human verification. ApplyLite will not bypass CAPTCHA; retry with the interactive browser or check manually.");
      }
      await page.bringToFront().catch(() => {});
    }

    const scoreText = await readZeroGptScoreText(page);
    if (scoreText) return scoreText;
    await page.waitForTimeout(500);
  }

  if (challengeSeen) {
    throw new Error("ZeroGPT human verification was not completed before the check timed out. ApplyLite did not bypass it.");
  }
  throw new Error(`ZeroGPT did not return an AI percentage within ${Math.round(timeoutMs / 1000)} seconds.`);
}

export async function detectWithZeroGpt(text: string): Promise<ZeroGptDetection> {
  const source = text.trim();
  if (source.length < 80) throw new Error("There is not enough non-personal document text to run the AI-content check.");

  const interactive = !config.browserHeadless;
  const browser = await chromium.launch({ headless: !interactive });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto("https://www.zerogpt.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });

    const input = page.locator("textarea#textArea");
    try {
      await input.waitFor({ state: "visible", timeout: 20_000 });
    } catch (error) {
      if (await hasVisibleHumanChallenge(page)) {
        throw new Error("ZeroGPT requested visible human verification. ApplyLite will not bypass CAPTCHA; complete the check manually on ZeroGPT or try again later.");
      }
      throw error;
    }
    await input.fill(source);
    await input.dispatchEvent("input").catch(() => {});
    await page.waitForTimeout(400);

    const detect = page.locator("button.scoreButton");
    await detect.waitFor({ state: "visible", timeout: 10_000 });
    await detect.scrollIntoViewIfNeeded().catch(() => {});
    if (await detect.isDisabled().catch(() => false)) {
      throw new Error("ZeroGPT Detect Text button stayed disabled after the sanitized text was entered.");
    }
    try {
      await detect.click({ timeout: 10_000 });
    } catch {
      await detect.evaluate((element) => (element as HTMLElement).click());
    }

    const scoreText = await waitForZeroGptScore(page, interactive, interactive ? 120_000 : 60_000);
    const score = parseZeroGptScore(scoreText);

    const highlights = uniqueHighlights(await page.locator("div.highlights-border-container mark.highlight").allInnerTexts());
    return {
      provider: "zerogpt-web",
      score,
      highlights,
      checkedAt: new Date().toISOString(),
      sourceCharacterCount: source.length,
      directIdentifiersExcluded: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/captcha|human verification/i.test(message)) throw error;
    throw new Error(`ZeroGPT check could not complete. Their website may have changed or blocked automated access. ${message}`);
  } finally {
    await browser.close();
  }
}
