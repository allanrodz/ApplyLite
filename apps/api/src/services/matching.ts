/** User-directed career matching. Unknown titles retain exact-word matching. */
export const normal = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}+#./ -]/gu, " ").replace(/\s+/g, " ").trim();
export function containsTerm(text: string, value: string) {
  const term = normal(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !!term && new RegExp(`(^|[^\\p{L}\\p{N}+#])${term}(?=$|[^\\p{L}\\p{N}+#])`, "u").test(normal(text));
}
const aliases = [
  ["javascript", "js"], ["typescript", "ts"], ["node.js", "nodejs", "node js"], ["react", "react.js", "reactjs"],
  ["postgresql", "postgres"], ["c#", "csharp"], ["c++", "cpp"], ["aws", "amazon web services"], ["gcp", "google cloud", "google cloud platform"],
  ["ci/cd", "cicd", "continuous integration", "continuous delivery"], ["rest api", "restful api"], ["machine learning", "ml"],
  ["microsoft excel", "excel", "ms excel"], ["human resources", "hr"], ["customer service", "customer care"], ["bookkeeping", "book keeping"],
  ["power bi", "powerbi"], ["accounts payable", "purchase ledger"], ["accounts receivable", "sales ledger"], ["food safety", "food hygiene"]
];
export function canonicalSkill(value: string) { const key = normal(value); return aliases.find(group => group.includes(key))?.[0] || key; }
export function skillMatches(candidate: string, required: string) {
  const a = canonicalSkill(candidate), b = canonicalSkill(required);
  if (!a || !b) return false;
  if (a === b) return true;
  // A partial skill is not proof of a compound requirement, or an adjacent technology.
  if (/[,;|]|\band\b|\bor\b/.test(b)) return false;
  const stripped = b.replace(/^(?:strong |good |working )?(?:knowledge of|proficiency in|experience (?:with|in)|familiarity with)\s+/, "").replace(/\s+(?:skills|experience|knowledge|programming)$/, "").trim();
  return canonicalSkill(stripped) === a;
}
export const families: Record<string, string[]> = {
  software: ["software developer", "software engineer", "frontend developer", "front end developer", "web developer", "backend developer", "full stack developer"],
  support: ["technical support", "application support", "it support", "service desk", "helpdesk", "help desk", "desktop support"],
  data: ["data analyst", "data scientist", "data engineer", "business intelligence", "analytics engineer"],
  qa: ["qa engineer", "software tester", "test engineer", "sdet"],
  cloud: ["cloud engineer", "cloud support", "devops", "site reliability", "infrastructure engineer"],
  security: ["cybersecurity", "cyber security", "information security", "security analyst", "soc analyst"],
  ai: ["ai engineer", "machine learning", "artificial intelligence", "ml engineer"],
  finance: ["finance", "accounting", "accountant", "bookkeeper", "bookkeeping", "accounts assistant", "finance assistant", "payroll", "financial analyst"],
  healthcare: ["healthcare", "nurse", "nursing", "healthcare assistant", "care assistant", "caregiver", "carer"],
  hospitality: ["hospitality", "hotel receptionist", "barista", "waiter", "waitress", "chef", "kitchen assistant", "food service"],
  administration: ["administration", "administrative assistant", "office administrator", "office assistant", "receptionist", "executive assistant"],
  marketing: ["marketing", "social media", "seo specialist", "content writer", "copywriter", "communications specialist"],
  sales: ["sales", "account executive", "business development representative", "retail assistant"],
  hr: ["human resources", "hr assistant", "hr coordinator", "recruiter", "recruitment", "talent acquisition"],
  service: ["customer service", "customer support", "customer care", "call centre", "call center"],
  logistics: ["logistics", "warehouse", "supply chain", "procurement", "inventory", "purchasing"],
  education: ["education", "teacher", "teaching assistant", "tutor", "educator", "childcare"],
  design: ["graphic design", "graphic designer", "ux designer", "ui designer", "product designer"],
  construction: ["construction", "civil engineer", "quantity surveyor", "site engineer"],
  legal: ["legal assistant", "paralegal", "solicitor", "lawyer", "legal counsel"],
  project: ["project coordinator", "project manager", "pmo analyst", "program manager", "programme manager"]
};
export function careerFamilies(title: string) { return Object.keys(families).filter(key => families[key].some(alias => containsTerm(title, alias))); }
const generic = new Set(["junior", "senior", "graduate", "entry", "level", "jr", "sr", "ii", "iii", "and", "the", "of", "for", "in", "engineer", "manager", "assistant", "analyst", "specialist", "associate", "coordinator"]);
export function roleSimilarity(title: string, target: string) {
  const tokens = (s: string) => normal(s).split(/[\s/-]+/).filter(t => t && !generic.has(t));
  const wanted = tokens(target), actual = new Set(tokens(title));
  if (!wanted.length) return normal(title) === normal(target) ? 1 : 0;
  const a = careerFamilies(title), b = careerFamilies(target);
  if (a.length && b.length && !a.some(key => b.includes(key))) return 0;
  if (containsTerm(title, target)) return 1;
  return Math.max(wanted.filter(t => actual.has(t)).length / wanted.length, a.some(key => b.includes(key)) ? 0.65 : 0);
}
export function targets(profile: { targetTitles: string[]; currentTitle: string }) { return profile.targetTitles.some(t => t.trim()) ? profile.targetTitles.filter(t => t.trim()) : [profile.currentTitle].filter(Boolean); }
export function planCareerQueries(titles: string[], max = 18) {
  const result: string[] = [], seen = new Set<string>();
  const add = (value: string) => { if (value.trim() && !seen.has(normal(value)) && result.length < max) { result.push(value.trim()); seen.add(normal(value)); } };
  titles.forEach(add); // Every explicit target gets a chance before expanding aliases.
  const buckets = [...new Set(titles.flatMap(careerFamilies))].map(key => families[key]);
  for (let i = 0; i < Math.max(0, ...buckets.map(b => b.length)); i++) for (const bucket of buckets) if (bucket[i]) add(bucket[i]);
  return result;
}
