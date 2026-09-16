import { careerFamilies, containsTerm, canonicalSkill } from "./matching.js";

/** Compatibility with a remote search is not proof of legal hiring eligibility. */
export function remoteScopeCompatible(location: string, description: string, preferred: string[]) {
  const value = location.trim().toLowerCase();
  const text = `${value} ${description.toLowerCase()}`;
  const usOnly = /\b(us[- ]only|united states only|must (?:be|reside|live|work)[^.!?\n]{0,45}(?:united states|usa)|remote (?:in|within) (?:the )?(?:united states|usa))\b/.test(text);
  const prefersUS = preferred.some(p => /\b(united states|usa|us)\b/i.test(p));
  if (usOnly) return prefersUS;
  if (!value || /^(remote|work from home|distributed|anywhere)$/.test(value)) return true;
  if (/\b(worldwide|anywhere in the world|global remote|remote globally)\b/.test(value)) return true;
  const europeTarget = preferred.some(p => /\b(ireland|eire|dublin|cork|galway|limerick|waterford|europe|european union|germany|france|spain|italy|portugal|netherlands|belgium|poland|sweden|denmark|finland|austria|romania|greece|czechia|uk|united kingdom)\b/i.test(p));
  const europeRemote = /\b(europe|european|emea|eu)\b/.test(value);
  return europeTarget && europeRemote;
}

export const cvSectionAliases: Record<string, string> = {
  "work history": "employment", "career history": "employment", "professional background": "employment",
  "career experience": "employment", "relevant experience": "employment", "employment record": "employment",
  "academic history": "education", "educational background": "education", "academic background": "education",
  "academic achievements": "education", "qualifications": "education", "training": "education",
  "professional certifications": "certifications", "licenses and certifications": "certifications",
  "volunteer experience": "other", "volunteering": "other", "awards": "other", "publications": "other",
  "professional memberships": "other", "additional information": "other", "personal information": "other"
};
export function sectionBoundaryAfterSkills(line: string) {
  return /^[\p{L}\p{M}][\p{L}\p{M} /&-]{2,65}:$/u.test(line)
    || /^(?:work|career|professional|educational|academic|employment)\s+(?:history|background|record|experience|details)$/i.test(line);
}

/** Generic job titles can use explicit dated-role duties, never the global skills list. */
export function genericDutyEvidence(title: string, bullets: string[], requiredSkills: string[]) {
  if (careerFamilies(title).length || !/\b(consultant|contractor|freelancer|specialist|analyst|associate|technician|technologist)\b/i.test(title)) return "";
  const evidence = requiredSkills.filter(skill => {
    const subject = canonicalSkill(skill);
    return subject.length >= 2 && bullets.some(bullet =>
      !/\b(never|not|no experience|training only)\b/i.test(bullet)
      && /\b(built|developed|implemented|maintained|delivered|designed|supported|managed|prepared|processed|reconciled|analysed|analyzed|automated|administered)\b/i.test(bullet)
      && (containsTerm(bullet, skill) || containsTerm(bullet, subject)));
  });
  return evidence.length ? `explicit CV duty evidence: ${evidence.slice(0, 3).join(", ")} (role duration; individual skill tenure is not verified)` : "";
}
