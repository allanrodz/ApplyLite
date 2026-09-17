import { normalizeCvDate } from "./cvParsing.js";
import { CandidateFactsSchema, ProfileSchema } from "@apply-lite/shared";
import { db } from "../db/database.js";

export function readSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value_json FROM workflow_settings WHERE key=?").get(key) as {value_json:string}|undefined;
  try { return row ? JSON.parse(row.value_json) as T : fallback; } catch { return fallback; }
}
export function writeSetting(key: string, value: unknown) {
  db.prepare("INSERT INTO workflow_settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json")
    .run(key, JSON.stringify(value));
}
export function savedProfile() {
  const row = db.prepare("SELECT data_json FROM profile WHERE id=1").get() as {data_json:string}|undefined;
  return ProfileSchema.parse(row ? JSON.parse(row.data_json) : {});
}
export function reviewedCv() {
  const row = db.prepare("SELECT id,facts_json FROM cv_documents ORDER BY id DESC LIMIT 1").get() as {id:number;facts_json:string}|undefined;
  return row ? { id: row.id, facts: CandidateFactsSchema.parse(JSON.parse(row.facts_json)) } : null;
}
export function onboardingStatus() {
  const cv = reviewedCv(), profile = savedProfile();
  const cvUploaded = !!cv || !!db.prepare("SELECT id FROM cv_imports LIMIT 1").get();
  const profileMerged = !!cv && readSetting<number|null>("profileCvId", null) === cv.id;
  const hasSkills = [...profile.skills, ...(cv?.facts.skills || [])].some(s => s.trim());
  const hasTargetTitles = profile.targetTitles.some(s => s.trim());
  const hasPreferredLocations = profile.preferredLocations.some(s => s.trim());
  const missingFields: {path:string;message:string;required:boolean;href:string}[] = [];
  if (!hasSkills) missingFields.push({path:"skills", message:"Review extracted skills or add your skills.", required:false, href:"/cv#cv-review"});
  if (!hasTargetTitles) missingFields.push({path:"targetTitles", message:"Confirm target roles or enter a career search term.", required:true, href:"/profile#target-roles"});
  if (!hasPreferredLocations) missingFields.push({path:"preferredLocations", message:"Choose locations, Remote or Anywhere to guide the search.", required:false, href:"/profile#preferred-locations"});
  const employment = cv?.facts.employment || [];
  employment.forEach((e,i) => { if (!normalizeCvDate(e.startDate).normalized || !normalizeCvDate(e.endDate).normalized) missingFields.push({path:`employment.${i}.dates`, message:`Employment ${i+1}: adding dates improves experience matching.`, required:false, href:"/cv#cv-review"}); });
  const nextStep = !cvUploaded ? "upload" : !cv ? "review" : !profileMerged ? "merge" : !hasTargetTitles ? "target_titles" : !hasPreferredLocations ? "locations" : "discover";
  const links: Record<string,string> = {upload:"/cv",review:"/cv#cv-review",merge:"/cv#cv-merge",target_titles:"/profile#target-roles",locations:"/profile#preferred-locations",discover:"/discover"};
  return {cvUploaded,cvReviewed:!!cv,profileMerged,hasSkills,hasTargetTitles,hasPreferredLocations,
    employmentDatesComplete:employment.length > 0 && employment.every(e => normalizeCvDate(e.startDate).normalized && normalizeCvDate(e.endDate).normalized),
    readyForDiscovery:hasTargetTitles, nextStep,nextHref:links[nextStep],missingFields};
}
