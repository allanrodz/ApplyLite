import { createHash } from "node:crypto";
import type { Locator } from "playwright";
import { db } from "../db/database.js";
import type { AnswerCandidate } from "./adapters/types.js";

export interface FieldDescriptor {
  label: string;
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  autocomplete: string;
  ariaLabel: string;
  nearbyText: string;
  fingerprint: string;
}

export interface FieldMatch {
  candidate: AnswerCandidate;
  fieldKey: string;
  confidence: number;
  learned: boolean;
  reason: string;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string) {
  return new Set(normalize(value).split(/\s+/).filter((token) => token.length > 1));
}

function similarity(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let intersection = 0;
  for (const token of ta) if (tb.has(token)) intersection += 1;
  return intersection / Math.max(ta.size, tb.size);
}

async function resolveNearbyText(locator: Locator) {
  try {
    return await locator.evaluate((element) => {
      const input = element as HTMLInputElement;
      const chunks: string[] = [];
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        for (const id of labelledBy.split(/\s+/)) {
          const text = document.getElementById(id)?.textContent?.trim();
          if (text) chunks.push(text);
        }
      }
      if (input.id) {
        const explicit = document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent?.trim();
        if (explicit) chunks.push(explicit);
      }
      const parentLabel = element.closest("label")?.textContent?.trim();
      if (parentLabel) chunks.push(parentLabel);
      const container = element.closest("fieldset, [role='group'], .field, .form-group, [class*='field'], [class*='question'], [data-testid*='field']");
      const containerText = container?.querySelector("legend, label, [class*='label'], [class*='question'], [class*='title']")?.textContent?.trim();
      if (containerText) chunks.push(containerText);
      return [...new Set(chunks)].join(" ").replace(/\s+/g, " ").trim().slice(0, 500);
    });
  } catch {
    return "";
  }
}

export async function describeControl(locator: Locator, fallback: string): Promise<FieldDescriptor> {
  const tag = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "input");
  const type = tag === "input" ? ((await locator.getAttribute("type")) ?? "text").toLowerCase() : tag;
  const name = (await locator.getAttribute("name"))?.trim() ?? "";
  const id = (await locator.getAttribute("id"))?.trim() ?? "";
  const placeholder = (await locator.getAttribute("placeholder"))?.trim() ?? "";
  const autocomplete = (await locator.getAttribute("autocomplete"))?.trim() ?? "";
  const ariaLabel = (await locator.getAttribute("aria-label"))?.trim() ?? "";
  const nearbyText = await resolveNearbyText(locator);
  const label = (ariaLabel || nearbyText || placeholder || name || id || fallback).replace(/\s+/g, " ").trim().slice(0, 300);
  const fingerprintSource = [tag, type, name, id, autocomplete, ariaLabel, placeholder, nearbyText].map(normalize).join("|");
  const fingerprint = createHash("sha256").update(fingerprintSource).digest("hex");
  return { label, tag, type, name, id, placeholder, autocomplete, ariaLabel, nearbyText, fingerprint };
}

const autocompleteMap: Record<string, string> = {
  "given-name": "first_name",
  "family-name": "last_name",
  name: "full_name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "address-level2": "city",
  country: "country",
  "country-name": "country"
};

const aliases: Array<{ key: string; pattern: RegExp; weight: number }> = [
  { key: "first_name", pattern: /\b(first|given|forename)\b.*\bname\b|\bfirst_name\b|\bgiven_name\b/i, weight: 0.94 },
  { key: "last_name", pattern: /\b(last|family|sur)\s*name\b|\bsurname\b|\blast_name\b|\bfamily_name\b/i, weight: 0.94 },
  { key: "full_name", pattern: /\b(full|candidate|legal)\s*name\b|^name$/i, weight: 0.9 },
  { key: "email", pattern: /\be[ -]?mail\b|emailaddress/i, weight: 0.96 },
  { key: "phone", pattern: /\b(phone|mobile|telephone|cell|contact number)\b|phone_number|mobile_number/i, weight: 0.93 },
  { key: "location", pattern: /\b(current|home|candidate)?\s*(location|based)\b|where are you (currently )?based/i, weight: 0.88 },
  { key: "city", pattern: /\b(city|town)\b|address_level2/i, weight: 0.9 },
  { key: "country", pattern: /\bcountry\b/i, weight: 0.92 },
  { key: "linkedin", pattern: /linkedin/i, weight: 0.96 },
  { key: "github", pattern: /github/i, weight: 0.96 },
  { key: "portfolio", pattern: /\b(portfolio|personal website|website|personal site)\b/i, weight: 0.84 },
  { key: "google_scholar", pattern: /google scholar/i, weight: 0.96 },
  { key: "x_profile", pattern: /\b(x profile|twitter profile)\b/i, weight: 0.94 },
  { key: "current_title", pattern: /\b(current|present)\b.*\b(title|role|position)\b|\bjob title\b/i, weight: 0.86 },
  { key: "work_authorization", pattern: /(authori[sz]ed|eligible|right).*(work)|work.*(authori[sz]ation|eligibility|permit)/i, weight: 0.9 }
];

function descriptorText(d: FieldDescriptor) {
  return [d.label, d.name, d.id, d.placeholder, d.ariaLabel, d.nearbyText].filter(Boolean).join(" ");
}

function candidateByKey(candidates: AnswerCandidate[], key: string) {
  return candidates.find((candidate) => candidate.key === key && candidate.value.trim());
}

function learnedMapping(ats: string, fingerprint: string) {
  return db.prepare(`SELECT field_key AS fieldKey, confidence, source FROM field_mappings WHERE ats IN (?, 'generic') AND fingerprint = ? ORDER BY CASE WHEN ats = ? THEN 0 ELSE 1 END, confidence DESC LIMIT 1`)
    .get(ats, fingerprint, ats) as { fieldKey: string; confidence: number; source: string } | undefined;
}

export function rememberMapping(input: { ats: string; descriptor: FieldDescriptor; fieldKey: string; confidence: number; source: string }) {
  if (!input.fieldKey || input.confidence < 0.62) return;
  db.prepare(`
    INSERT INTO field_mappings (ats, fingerprint, field_key, label, metadata_json, confidence, seen_count, source, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(ats, fingerprint) DO UPDATE SET
      field_key = CASE WHEN excluded.confidence >= field_mappings.confidence THEN excluded.field_key ELSE field_mappings.field_key END,
      label = excluded.label,
      metadata_json = excluded.metadata_json,
      confidence = MAX(field_mappings.confidence, excluded.confidence),
      seen_count = field_mappings.seen_count + 1,
      source = CASE WHEN excluded.confidence >= field_mappings.confidence THEN excluded.source ELSE field_mappings.source END,
      last_seen_at = CURRENT_TIMESTAMP
  `).run(
    input.ats,
    input.descriptor.fingerprint,
    input.fieldKey,
    input.descriptor.label,
    JSON.stringify({
      name: input.descriptor.name,
      id: input.descriptor.id,
      placeholder: input.descriptor.placeholder,
      autocomplete: input.descriptor.autocomplete,
      ariaLabel: input.descriptor.ariaLabel,
      type: input.descriptor.type
    }),
    Math.min(1, Math.max(0, input.confidence)),
    input.source
  );
}

export function matchField(ats: string, descriptor: FieldDescriptor, candidates: AnswerCandidate[]): FieldMatch | null {
  const text = descriptorText(descriptor);
  if (/\b(reference|referee|emergency contact|previous employer|employer name|company name|citizenship|nationality|country of birth|sponsorship|sponsor|visa|consent|agree|signature|gender|ethnicity|disability)\b/i.test(text)) return null;
  if (["checkbox", "radio", "password", "hidden", "file"].includes(descriptor.type)) return null;
  const learned = learnedMapping(ats, descriptor.fingerprint);
  if (learned && learned.confidence >= 0.9 && learned.source === "observed-manual-value") {
    const candidate = candidateByKey(candidates, learned.fieldKey);
    if (candidate) return { candidate, fieldKey: learned.fieldKey, confidence: learned.confidence, learned: true, reason: `learned ${learned.source}` };
  }

  const auto = descriptor.autocomplete.toLowerCase().trim().split(/\s+/).find(token => autocompleteMap[token]);
  const autoKey = auto ? autocompleteMap[auto] : undefined;
  if (autoKey) {
    const candidate = candidateByKey(candidates, autoKey);
    if (candidate) return { candidate, fieldKey: autoKey, confidence: 0.99, learned: false, reason: `autocomplete=${descriptor.autocomplete}` };
  }

  if (descriptor.type === "email") {
    const candidate = candidateByKey(candidates, "email");
    if (candidate) return { candidate, fieldKey: "email", confidence: 0.99, learned: false, reason: "input type=email" };
  }
  if (descriptor.type === "tel") {
    const candidate = candidateByKey(candidates, "phone");
    if (candidate) return { candidate, fieldKey: "phone", confidence: 0.98, learned: false, reason: "input type=tel" };
  }

  let best: FieldMatch | null = null;
  for (const alias of aliases) {
    if (!alias.pattern.test(text)) continue;
    const candidate = candidateByKey(candidates, alias.key);
    if (!candidate) continue;
    const attributeBoost = alias.pattern.test(`${descriptor.name} ${descriptor.id} ${descriptor.placeholder} ${descriptor.ariaLabel}`) ? 0.04 : 0;
    const confidence = Math.min(0.99, alias.weight + attributeBoost);
    if (!best || confidence > best.confidence) best = { candidate, fieldKey: alias.key, confidence, learned: false, reason: "semantic field metadata" };
  }
  if (best) return best;

  // Answer-library and screening questions still use fuzzy matching, but at a conservative threshold.
  const explicit = candidates
    .filter((candidate) => candidate.source !== "profile")
    .map((candidate) => ({ candidate, score: Math.max(similarity(descriptor.label, candidate.label), similarity(descriptor.label, candidate.key.replaceAll("_", " "))) }))
    .sort((a, b) => b.score - a.score)[0];
  if (explicit && explicit.score >= 0.76) {
    return { candidate: explicit.candidate, fieldKey: explicit.candidate.key, confidence: Math.min(0.92, explicit.score), learned: false, reason: "saved-answer similarity" };
  }
  return null;
}

export function learnFromExistingValue(ats: string, descriptor: FieldDescriptor, value: string, candidates: AnswerCandidate[]) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const exact = candidates.filter((candidate) => candidate.value.trim() && normalize(candidate.value) === normalize(trimmed));
  if (exact.length === 1) {
    rememberMapping({ ats, descriptor, fieldKey: exact[0].key, confidence: 1, source: "observed-manual-value" });
    return exact[0].key;
  }

  return null;
}

export function listMappings() {
  return db.prepare(`SELECT id, ats, fingerprint, field_key AS fieldKey, label, confidence, seen_count AS seenCount, source, last_seen_at AS lastSeenAt FROM field_mappings ORDER BY last_seen_at DESC, confidence DESC`).all();
}
