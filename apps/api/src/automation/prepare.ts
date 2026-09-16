import { chromium } from "playwright";
import type { Profile } from "@apply-lite/shared";
import { config } from "../config.js";
import { genericAdapter } from "./adapters/generic.js";
import { detectAts } from "./detect.js";

export async function prepareApplication(args: {
  url: string;
  profile: Profile;
  answers: Record<string, string>;
  resumePath?: string;
}) {
  const browser = await chromium.launch({ headless: config.browserHeadless });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const detected = detectAts(page.url());
    const result = await genericAdapter.prepare({
      page,
      profile: args.profile,
      answers: Object.entries(args.answers).map(([key, value]) => ({ key, label: key.replaceAll("_", " "), value, source: "answer-library" as const })),
      screeningAnswers: [],
      resumePath: args.resumePath
    });

    return { ...result, ats: detected };
  } finally {
    // Legacy M0-style one-shot preparer. M4 uses a persistent interactive browser session.
    await browser.close();
  }
}
