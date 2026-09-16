import type { Locator } from "playwright";
import type { AnswerCandidate, AtsAdapter, AutomationContext, PreparationResult } from "./types.js";
import { describeControl, learnFromExistingValue, matchField, rememberMapping } from "../fieldIntelligence.js";
import { detectAts } from "../detect.js";

const sensitivePattern = /\b(gender|sex|race|racial|ethnic|ethnicity|disability|disabled|veteran|military status|religion|sexual orientation|date of birth|birth date|\bdob\b|age|marital|criminal|conviction|medical|health condition|pronouns?|nationality|citizenship)\b/i;
const legalPattern = /\b(terms|privacy|consent|attest|acknowledge|electronic signature|signature|truthful|accurate information)\b|\bi certify\b|\bcertify that\b/i;
const manualIdentityPattern = /\b(name|legal name).*\bnative language\b|\bnative language\b.*\b(name|legal name)\b/i;
const submitPattern = /^(submit|submit application|send application|complete application|finish application|apply now|apply)$/i;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string) {
  return new Set(normalize(value).split(/\s+/).filter((token) => token.length > 2));
}

function similarity(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let intersection = 0;
  for (const token of ta) if (tb.has(token)) intersection += 1;
  return intersection / Math.max(ta.size, tb.size);
}

async function visible(locator: Locator) {
  try { return await locator.isVisible(); } catch { return false; }
}

async function radioQuestionText(locator: Locator, fallback: string) {
  try {
    const text = await locator.evaluate((element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const labelled = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" ");
        if (labelled) return labelled;
      }
      const fieldset = element.closest("fieldset");
      const legend = fieldset?.querySelector("legend")?.textContent?.trim();
      if (legend) return legend;
      const group = element.closest("[role='radiogroup'], [role='group'], [class*='question'], [class*='field']");
      const groupLabel = group?.querySelector("[class*='label'], [class*='question'], label")?.textContent?.trim();
      return groupLabel || "";
    });
    if (text) return text.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    // Use the generic label resolver below.
  }
  return questionText(locator, fallback);
}

async function questionText(locator: Locator, fallback: string) {
  const aria = await locator.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  try {
    const text = await locator.evaluate((element) => {
      const input = element as HTMLInputElement;
      if (input.id) {
        const explicit = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (explicit?.textContent?.trim()) return explicit.textContent.trim();
      }
      const parentLabel = element.closest("label");
      if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();
      const container = element.closest("fieldset, [role='group'], .field, .form-group, [class*='field'], [class*='question']");
      const label = container?.querySelector("legend, label, [class*='label'], [class*='question']");
      return label?.textContent?.trim() || "";
    });
    if (text) return text.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    // Fallbacks below.
  }
  const placeholder = await locator.getAttribute("placeholder");
  if (placeholder?.trim()) return placeholder.trim();
  const name = await locator.getAttribute("name");
  if (name?.trim()) return name.trim();
  const id = await locator.getAttribute("id");
  if (id?.trim()) return id.trim();
  return fallback;
}

function profileCandidates(ctx: AutomationContext): AnswerCandidate[] {
  const p = ctx.profile;
  const values: Array<[string, string, string]> = [
    ["first_name", "First name", p.firstName],
    ["last_name", "Last name / surname", p.lastName],
    ["full_name", "Full name", `${p.firstName} ${p.lastName}`.trim()],
    ["email", "Email address", p.email],
    ["phone", "Phone / mobile number", p.phone],
    ["city", "City", p.city],
    ["country", "Country", p.country],
    ["location", "Current location / where currently based", [p.city, p.country].filter(Boolean).join(", ")],
    ["linkedin", "LinkedIn profile URL", p.linkedinUrl],
    ["github", "GitHub profile URL", p.githubUrl],
    ["portfolio", "Portfolio / personal website URL", p.portfolioUrl],
    ["google_scholar", "Google Scholar profile URL", p.googleScholarUrl],
    ["x_profile", "X / Twitter profile URL", p.xUrl],
    ["current_title", "Current job title", p.currentTitle],
    ["work_authorization", "Work authorization / right to work", p.workAuthorization]
  ];
  return values.filter(([, , value]) => value.trim()).map(([key, label, value]) => ({ key, label, value, source: "profile" as const }));
}

function standardCandidate(label: string, candidates: AnswerCandidate[]) {
  const normalized = normalize(label);
  const keyed: Array<[RegExp, string]> = [
    [/\b(first|given) name\b/, "first_name"],
    [/\b(last|family|sur)name\b/, "last_name"],
    [/^(full )?name$|candidate name|legal name/, "full_name"],
    [/\bemail\b/, "email"],
    [/\b(phone|mobile|telephone|tel)\b/, "phone"],
    [/\blinkedin\b/, "linkedin"],
    [/\bgithub\b/, "github"],
    [/\b(portfolio|personal website|website url)\b/, "portfolio"],
    [/google scholar/, "google_scholar"],
    [/\b(x profile|twitter profile)\b/, "x_profile"],
    [/\b(current|present).*(title|role)|job title/, "current_title"],
    [/\bcity\b/, "city"],
    [/\bcountry\b/, "country"],
    [/(authori[sz]ed|right).*(work)|work authori[sz]ation/, "work_authorization"]
  ];
  for (const [pattern, key] of keyed) {
    if (pattern.test(normalized)) return candidates.find((candidate) => candidate.key === key) ?? null;
  }
  return null;
}

function bestCandidate(label: string, candidates: AnswerCandidate[]) {
  const explicit = candidates
    .filter((candidate) => candidate.source !== "profile")
    .map((candidate) => ({ candidate, score: Math.max(similarity(label, candidate.label), similarity(label, candidate.key.replaceAll("_", " "))) }))
    .sort((a, b) => b.score - a.score)[0];
  if (explicit && explicit.score >= 0.72) return explicit;
  const standard = standardCandidate(label, candidates);
  if (standard) return { candidate: standard, score: 1 };
  let best: AnswerCandidate | null = null;
  let score = 0;
  for (const candidate of candidates) {
    const next = Math.max(similarity(label, candidate.label), similarity(label, candidate.key.replaceAll("_", " ")));
    if (next > score) {
      best = candidate;
      score = next;
    }
  }
  return best && score >= 0.68 ? { candidate: best, score } : null;
}

async function setSelect(locator: Locator, answer: string) {
  const options = await locator.locator("option").allTextContents();
  const desired = normalize(answer);
  const best = options
    .map((text) => ({ text, score: similarity(text, desired) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 0.5) return false;
  try {
    await locator.selectOption({ label: best.text });
    return true;
  } catch {
    return false;
  }
}

function answerLooksYes(value: string) { return /^(yes|y|true|authorized|authorised)$/i.test(value.trim()); }
function answerLooksNo(value: string) { return /^(no|n|false)$/i.test(value.trim()); }

async function setRadio(page: AutomationContext["page"], locator: Locator, label: string, answer: string) {
  const name = await locator.getAttribute("name");
  if (!name) return false;
  const radios = page.locator(`input[type="radio"][name="${name.replaceAll('"', '\\"')}"]`);
  for (let i = 0; i < await radios.count(); i++) {
    const radio = radios.nth(i);
    const value = (await radio.getAttribute("value")) ?? "";
    const optionLabel = await questionText(radio, value || `${label} option ${i + 1}`);
    if (similarity(answer, optionLabel) >= 0.55 || similarity(answer, value) >= 0.7 || (answerLooksYes(answer) && /\byes\b/i.test(optionLabel)) || (answerLooksNo(answer) && /\bno\b/i.test(optionLabel))) {
      try { await radio.check(); return true; } catch { /* continue */ }
    }
  }
  return false;
}

async function uploadDocuments(ctx: AutomationContext, result: PreparationResult) {
  const inputs = ctx.page.locator('input[type="file"]');
  for (let i = 0; i < await inputs.count(); i++) {
    const input = inputs.nth(i);
    if (await input.isDisabled().catch(() => true)) continue;
    const label = await questionText(input, `File upload ${i + 1}`);
    const lower = label.toLowerCase();
    let filePath = "";
    let source = "";
    if (/cover|letter/.test(lower)) {
      if (ctx.coverLetterPath) {
        filePath = ctx.coverLetterPath;
        source = "M3 cover letter";
      } else {
        result.manualQuestions.push(label);
        result.fieldResults.push({ label, controlType: "file", status: "manual", source: "", detail: "This form requests a cover letter, but the current package has no cover-letter PDF." });
        continue;
      }
    } else if (/(resume|résumé|cv|curriculum)/i.test(label) && ctx.resumePath) {
      filePath = ctx.resumePath;
      source = "M3 tailored CV";
    } else if (i === 0 && ctx.resumePath) {
      filePath = ctx.resumePath;
      source = "M3 tailored CV";
    }
    if (!filePath) {
      result.manualQuestions.push(label);
      result.fieldResults.push({ label, controlType: "file", status: "manual", source: "", detail: "Could not safely determine which document belongs in this upload." });
      continue;
    }
    try {
      await input.setInputFiles(filePath);
      result.uploaded.push(label);
      result.fieldResults.push({ label, controlType: "file", status: "uploaded", source, detail: "Uploaded; review before submission." });
    } catch (error) {
      result.manualQuestions.push(label);
      result.fieldResults.push({ label, controlType: "file", status: "manual", source, detail: error instanceof Error ? error.message : "Upload failed" });
    }
  }
}

async function fillControls(ctx: AutomationContext, result: PreparationResult) {
  const candidates: AnswerCandidate[] = [...profileCandidates(ctx), ...ctx.answers];
  for (const answer of ctx.screeningAnswers) {
    candidates.push({ key: answer.key, label: answer.question, value: answer.answer, source: answer.source === "answer-library" ? "answer-library" : "generated", needsReview: answer.needsReview });
  }

  const ats = detectAts(ctx.page.url());
  const controls = ctx.page.locator('input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select');
  const seenRadioNames = new Set<string>();

  for (let i = 0; i < await controls.count(); i++) {
    const control = controls.nth(i);
    if (!(await visible(control)) || await control.isDisabled().catch(() => true)) continue;
    const descriptor = await describeControl(control, `field ${i + 1}`);
    const type = descriptor.type;
    const tag = descriptor.tag;
    let label = descriptor.label;
    if (type === "radio") label = await radioQuestionText(control, descriptor.label);

    if (type === "password") {
      if (!result.manualQuestions.includes(label)) result.manualQuestions.push(label);
      result.fieldResults.push({ label, controlType: type, status: "manual", source: "", detail: "Login/password fields are never filled automatically.", confidence: 1 });
      continue;
    }
    if (sensitivePattern.test(label)) {
      if (!result.manualQuestions.includes(label)) result.manualQuestions.push(label);
      result.fieldResults.push({ label, controlType: type, status: "manual", source: "", detail: "Sensitive or demographic question: manual response required.", confidence: 1 });
      continue;
    }
    if (legalPattern.test(label)) {
      if (!result.manualQuestions.includes(label)) result.manualQuestions.push(label);
      result.fieldResults.push({ label, controlType: type, status: "manual", source: "", detail: "Consent, certification, or signature is left for you.", confidence: 1 });
      continue;
    }
    if (manualIdentityPattern.test(label)) {
      if (!result.manualQuestions.includes(label)) result.manualQuestions.push(label);
      result.fieldResults.push({ label, controlType: type, status: "manual", source: "", detail: "Native-language legal-name fields are never inferred from the Latin-script profile name.", confidence: 1 });
      continue;
    }

    if (type === "checkbox") {
      if (!(await control.isChecked().catch(() => false))) {
        if (!result.manualQuestions.includes(label)) result.manualQuestions.push(label);
        result.fieldResults.push({ label, controlType: type, status: "manual", source: "", detail: "Checkboxes are never selected automatically in M4.", confidence: 1 });
      }
      continue;
    }

    if (type === "radio") {
      const name = descriptor.name || label;
      if (seenRadioNames.has(name)) continue;
      seenRadioNames.add(name);
      const existing = await ctx.page.locator(`input[type="radio"][name="${name.replaceAll('"', '\\"')}"]:checked`).count();
      if (existing) continue;
      const radioDescriptor = { ...descriptor, label, nearbyText: `${descriptor.nearbyText} ${label}`.trim() };
      const match = matchField(ats, radioDescriptor, candidates);
      if (match && match.confidence >= 0.78 && await setRadio(ctx.page, control, label, match.candidate.value)) {
        rememberMapping({ ats, descriptor: radioDescriptor, fieldKey: match.fieldKey, confidence: match.confidence, source: match.learned ? "learned-reuse" : "semantic-autofill" });
        result.filled.push(label);
        result.fieldResults.push({ label, controlType: type, status: "filled", source: match.candidate.source, detail: `${match.reason}; review selected option.`, fieldKey: match.fieldKey, confidence: match.confidence, learned: match.learned });
      } else {
        result.unknownQuestions.push(label);
        result.fieldResults.push({ label, controlType: type, status: "unknown", source: "", detail: "No high-confidence saved answer matched this choice.", confidence: match?.confidence ?? 0 });
      }
      continue;
    }

    const current = await control.inputValue().catch(() => "");
    if (current.trim()) {
      const learnedKey = learnFromExistingValue(ats, descriptor, current, candidates);
      if (learnedKey) {
        result.fieldResults.push({ label, controlType: tag === "select" ? "select" : type, status: "skipped", source: "manual/existing", detail: `Existing value retained; learned this field as ${learnedKey}.`, fieldKey: learnedKey, confidence: 1, learned: true });
      }
      continue;
    }

    const match = matchField(ats, descriptor, candidates);
    if (tag === "select") {
      if (match && match.confidence >= 0.78 && await setSelect(control, match.candidate.value)) {
        rememberMapping({ ats, descriptor, fieldKey: match.fieldKey, confidence: match.confidence, source: match.learned ? "learned-reuse" : "semantic-autofill" });
        result.filled.push(label);
        result.fieldResults.push({ label, controlType: "select", status: "filled", source: match.candidate.source, detail: `${match.reason}; selected the closest matching option.`, fieldKey: match.fieldKey, confidence: match.confidence, learned: match.learned });
      } else {
        result.unknownQuestions.push(label);
        result.fieldResults.push({ label, controlType: "select", status: "unknown", source: "", detail: "No high-confidence option match.", confidence: match?.confidence ?? 0 });
      }
      continue;
    }

    if (!match || match.confidence < 0.78) {
      result.unknownQuestions.push(label);
      result.fieldResults.push({ label, controlType: type, status: "unknown", source: "", detail: "No high-confidence profile or Answer Library match.", fieldKey: match?.fieldKey ?? "", confidence: match?.confidence ?? 0, learned: match?.learned ?? false });
      continue;
    }
    try {
      await control.fill(match.candidate.value);
      rememberMapping({ ats, descriptor, fieldKey: match.fieldKey, confidence: match.confidence, source: match.learned ? "learned-reuse" : "semantic-autofill" });
      result.filled.push(label);
      result.fieldResults.push({
        label,
        controlType: type,
        status: "filled",
        source: match.candidate.source,
        detail: match.candidate.needsReview ? `Generated screening draft filled (${match.reason}); review before submitting.` : `Filled from ${match.candidate.source} (${match.reason}).`,
        fieldKey: match.fieldKey,
        confidence: match.confidence,
        learned: match.learned
      });
    } catch {
      result.manualQuestions.push(label);
      result.fieldResults.push({ label, controlType: type, status: "manual", source: match.candidate.source, detail: "The control could not be filled safely.", fieldKey: match.fieldKey, confidence: match.confidence, learned: match.learned });
    }
  }
}

async function detectPageState(ctx: AutomationContext, result: PreparationResult) {
  result.captchaDetected = (await ctx.page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [class*="captcha" i], [id*="captcha" i]').count()) > 0 || /verify you are human|captcha/i.test(await ctx.page.locator("body").innerText().catch(() => ""));
  result.loginDetected = (await ctx.page.locator('input[type="password"]').count()) > 0 || /sign in|log in/i.test((await ctx.page.title().catch(() => "")));

  const buttons = ctx.page.locator('button, input[type="submit"], [role="button"]');
  for (let i = 0; i < await buttons.count(); i++) {
    const button = buttons.nth(i);
    if (!(await visible(button))) continue;
    const text = ((await button.innerText().catch(() => "")) || (await button.getAttribute("value")) || (await button.getAttribute("aria-label")) || "").trim();
    if (submitPattern.test(text)) {
      result.submitDetected = true;
      break;
    }
  }
}

export const genericAdapter: AtsAdapter = {
  name: "generic",
  matches: () => true,
  async prepare(ctx): Promise<PreparationResult> {
    const result: PreparationResult = {
      ats: "generic",
      filled: [],
      uploaded: [],
      unknownQuestions: [],
      manualQuestions: [],
      fieldResults: [],
      submitDetected: false,
      captchaDetected: false,
      loginDetected: false,
      finalUrl: ctx.page.url(),
      pageTitle: await ctx.page.title().catch(() => "")
    };

    await uploadDocuments(ctx, result);
    await fillControls(ctx, result);
    await detectPageState(ctx, result);
    result.finalUrl = ctx.page.url();
    result.pageTitle = await ctx.page.title().catch(() => "");

    // Critical M4 invariant: this adapter NEVER clicks any button, including Next/Continue/Submit.
    return result;
  }
};
