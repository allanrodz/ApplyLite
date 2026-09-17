from pathlib import Path
import re

def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

def regex_once(path: str, pattern: str, replacement: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: regex expected one match, found {count}: {pattern[:100]!r}")
    p.write_text(next_text, encoding="utf-8")

# 1) Dashboard endpoint: only load focused/actioned jobs before scoring.
jobs = Path("apps/api/src/routes/jobs.ts")
text = jobs.read_text(encoding="utf-8")
old = '''function serializeRows(useOutcomeLearning = true) {
  const profile = loadProfile();
  const facts = loadCandidateFacts();
  const outcomeModel = buildOutcomeLearningModel();
  const rows = db.prepare(`
    SELECT id, source_url AS sourceUrl, title, company, location, salary_text AS salaryText,
           description, score, score_json AS scoreJson, analysis_json AS analysisJson,
           ats, origin, status, created_at AS createdAt, score_kind AS scoreKind, analysis_status AS analysisStatus
    FROM jobs ORDER BY score DESC, created_at DESC
  `).all() as Array<Record<string, unknown> & { scoreJson: string; analysisJson: string; id: number }>;
'''
new = '''function serializeRows(useOutcomeLearning = true, workspaceOnly = false) {
  const profile = loadProfile();
  const facts = loadCandidateFacts();
  const outcomeModel = buildOutcomeLearningModel();
  const workspaceWhere = workspaceOnly
    ? "WHERE origin <> 'discovery' OR status IN ('FOCUSED', 'NOT_PURSUING') OR EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)"
    : "";
  const rows = db.prepare(`
    SELECT id, source_url AS sourceUrl, title, company, location, salary_text AS salaryText,
           description, score, score_json AS scoreJson, analysis_json AS analysisJson,
           ats, origin, status, created_at AS createdAt, score_kind AS scoreKind, analysis_status AS analysisStatus
    FROM jobs ${workspaceWhere} ORDER BY score DESC, created_at DESC
  `).all() as Array<Record<string, unknown> & { scoreJson: string; analysisJson: string; id: number }>;
'''
if old not in text:
    raise SystemExit("jobs.ts serializeRows block not found")
text = text.replace(old, new, 1)
text = text.replace(
'''  app.get<{ Querystring: { learned?: string } }>("/jobs", async (request) => {
    const useOutcomeLearning = request.query.learned !== "0" && request.query.learned !== "false";
    return serializeRows(useOutcomeLearning);
  });''',
'''  app.get<{ Querystring: { learned?: string; workspace?: string } }>("/jobs", async (request) => {
    const useOutcomeLearning = request.query.learned !== "0" && request.query.learned !== "false";
    const workspaceOnly = request.query.workspace === "1" || request.query.workspace === "true";
    return serializeRows(useOutcomeLearning, workspaceOnly);
  });''',
1)
jobs.write_text(text, encoding="utf-8")

# 2) Discovery reads: no synchronous rescoring; SQL paginate/count common filters.
discovery = Path("apps/api/src/services/discovery.ts")
text = discovery.read_text(encoding="utf-8")
start = text.index("export type ResultFilters=")
end = text.index("let discoveryRunning=false;", start)
replacement = r'''export type ResultFilters={runId?:number;minScore?:number;band?:string;strictTitle?:boolean;entryLevelOnly?:boolean;hideSenior?:boolean;strictLocation?:boolean;remoteOnly?:boolean;includeRemoteUS?:boolean;analysis?:string;query?:string;offset?:number;limit?:number};

export function getDiscoveryResults(filters:ResultFilters={}){
 const profile=savedProfile(),cv=reviewedCv(),hash=profileHash(profile),cvId=cv?.id||null;
 const limit=Math.max(1,Math.min(100,filters.limit||30)),offset=Math.max(0,filters.offset||0);
 const from=filters.runId?"FROM jobs j JOIN discovery_run_jobs r ON r.job_id=j.id":"FROM jobs j";
 const scopeClauses=filters.runId?["r.run_id = ?"]:["(j.origin='discovery' OR EXISTS (SELECT 1 FROM discovery_run_jobs drj WHERE drj.job_id=j.id))"];
 const scopeParams:any[]=filters.runId?[filters.runId]:[];

 const countsRow=db.prepare(`
  SELECT COUNT(*) AS allCount,
         SUM(CASE WHEN j.score>=75 THEN 1 ELSE 0 END) AS strong,
         SUM(CASE WHEN j.score>=50 AND j.score<75 THEN 1 ELSE 0 END) AS possible,
         SUM(CASE WHEN j.score<50 THEN 1 ELSE 0 END) AS stretch,
         SUM(CASE WHEN j.score_kind<>'deep' THEN 1 ELSE 0 END) AS notDeep
  ${from} WHERE ${scopeClauses.join(" AND ")}
 `).get(...scopeParams) as any;
 const counts={all:Number(countsRow?.allCount||0),strong:Number(countsRow?.strong||0),possible:Number(countsRow?.possible||0),stretch:Number(countsRow?.stretch||0),notDeep:Number(countsRow?.notDeep||0)};

 const clauses=[...scopeClauses],params=[...scopeParams];
 if((filters.minScore||0)>0){clauses.push("j.score >= ?");params.push(filters.minScore);}
 if(filters.band==="strong")clauses.push("j.score >= 75");
 if(filters.band==="possible")clauses.push("j.score >= 50 AND j.score < 75");
 if(filters.band==="stretch")clauses.push("j.score < 50");
 if(filters.analysis==="quick")clauses.push("j.score_kind <> 'deep'");
 if(filters.analysis==="deep")clauses.push("j.score_kind = 'deep'");
 if(filters.query){clauses.push("LOWER(j.title || ' ' || j.company || ' ' || j.description) LIKE ?");params.push(`%${filters.query.toLowerCase()}%`);}
 if(filters.hideSenior){
   for(const term of ["senior","staff","principal","lead","director","head of"]){clauses.push("LOWER(j.title) NOT LIKE ?");params.push(`%${term}%`);}
 }

 const advanced=Boolean(filters.strictTitle||filters.entryLevelOnly||filters.strictLocation||filters.remoteOnly||filters.includeRemoteUS===false);
 const select=`SELECT j.id,j.source_url AS sourceUrl,j.title,j.company,j.location,j.salary_text AS salaryText,j.description,j.ats,j.score,j.score_json,j.analysis_json,j.pre_score,j.score_kind AS scoreKind,j.analysis_status AS analysisStatus,j.score_profile_hash,j.score_cv_id,
   CASE WHEN j.origin<>'discovery' OR j.status IN ('FOCUSED','NOT_PURSUING') OR EXISTS (SELECT 1 FROM applications a WHERE a.job_id=j.id) THEN 1 ELSE 0 END AS inWorkspace
   ${from} WHERE ${clauses.join(" AND ")} ORDER BY j.score DESC,j.id DESC`;

 const rawRows=advanced
   ? db.prepare(select).all(...params) as any[]
   : db.prepare(`${select} LIMIT ? OFFSET ?`).all(...params,limit,offset) as any[];

 const mapRow=(row:any)=>{
  let scoreBreakdown:any={},requirements:JobRequirements=JobRequirementsSchema.parse({});
  try{scoreBreakdown=JSON.parse(row.score_json||"{}");requirements=JobRequirementsSchema.parse(JSON.parse(row.analysis_json||"{}"));}catch{}
  return{id:row.id,title:row.title,company:row.company,location:row.location,sourceUrl:row.sourceUrl,salaryText:row.salaryText,description:row.description,ats:row.ats,score:Number(row.score||0),scoreKind:row.scoreKind,analysisStatus:row.analysisStatus,inWorkspace:Boolean(row.inWorkspace),preScore:row.pre_score,scoreBreakdown,requirements,stale:row.score_profile_hash!==hash||row.score_cv_id!==cvId};
 };
 let items=rawRows.map(mapRow);

 if(advanced){
  items=items.filter(j=>{
   if(filters.strictTitle&&!titleAlignmentScore(j.title,targets(profile)).aligned)return false;
   if(filters.entryLevelOnly&&!entryLevelEligibility(j.title,j.description).allowed)return false;
   const geo=locationEligibility(j.location,j.description,[...profile.preferredLocations,profile.city,profile.country].filter(Boolean),profile.remotePreference);
   if(filters.strictLocation&&!geo.allowed)return false;
   if(filters.remoteOnly&&j.requirements.workplaceType!=="remote")return false;
   if(filters.includeRemoteUS===false&&geo.remote&&geo.usScope)return false;
   return true;
  });
  const total=items.length;
  return {items:items.slice(offset,offset+limit),counts,total,offset,limit,hasMore:offset+limit<total};
 }

 const totalRow=db.prepare(`SELECT COUNT(*) AS total ${from} WHERE ${clauses.join(" AND ")}`).get(...params) as any;
 const total=Number(totalRow?.total||0);
 return {items,counts,total,offset,limit,hasMore:offset+limit<total};
}
'''
text = text[:start] + replacement + text[end:]
discovery.write_text(text, encoding="utf-8")

# 3) Lightweight queue item lookup for global package notifications.
prep = Path("apps/api/src/services/applicationPrep.ts")
text = prep.read_text(encoding="utf-8")
anchor = '''export function getApplicationPrepStatus(): ApplicationPrepStatus {
'''
insert = '''export function getApplicationPrepItem(id: number) {
  const row = db.prepare(`
    SELECT q.id, q.job_id AS jobId, q.brief_id AS briefId, q.brief_item_id AS briefItemId,
           q.source, q.status, q.score_snapshot AS scoreSnapshot, q.application_id AS applicationId,
           q.package_id AS packageId, q.audit_status AS auditStatus, q.error_message AS errorMessage,
           q.queued_at AS queuedAt, q.started_at AS startedAt, q.completed_at AS completedAt,
           q.updated_at AS updatedAt,
           j.title, j.company, j.location, j.source_url AS sourceUrl, j.ats,
           a.state AS applicationState
    FROM application_prep_queue q
    JOIN jobs j ON j.id = q.job_id
    LEFT JOIN applications a ON a.id = q.application_id
    WHERE q.id = ?
  `).get(id) as Record<string, unknown> | undefined;
  return row ? serializeQueueRow(row) : null;
}

'''
if anchor not in text: raise SystemExit("applicationPrep status anchor missing")
prep.write_text(text.replace(anchor, insert+anchor, 1), encoding="utf-8")

route = Path("apps/api/src/routes/applicationPrep.ts")
text = route.read_text(encoding="utf-8")
text = text.replace("  getApplicationPrepStatus,\n", "  getApplicationPrepItem,\n  getApplicationPrepStatus,\n", 1)
route_anchor = '''  app.get<{ Querystring: { limit?: string } }>("/application-prep/queue", async (request) => {
    return listApplicationPrepQueue(Number(request.query.limit ?? 50));
  });

'''
route_insert = route_anchor + '''  app.get<{ Params: { id: string } }>("/application-prep/items/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "Invalid preparation item id" });
    const item = getApplicationPrepItem(id);
    return item ?? reply.code(404).send({ error: "Preparation item not found" });
  });

'''
if route_anchor not in text: raise SystemExit("applicationPrep route anchor missing")
route.write_text(text.replace(route_anchor, route_insert, 1), encoding="utf-8")

# 4) Persistent global package watcher/toast.
component = Path("apps/web/src/components/PackageNotifications.tsx")
component.write_text(r'''import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/navigation";

type PrepStatus = "QUEUED" | "GENERATING" | "READY" | "NEEDS_REVIEW" | "FAILED" | "SUBMITTED" | "DISMISSED" | "SKIPPED";
type PrepItem = {
  id: number;
  jobId: number;
  status: PrepStatus;
  title: string;
  company: string;
  errorMessage: string | null;
};
type PackageWatch = {
  id: number;
  jobId: number;
  title: string;
  company: string;
  notifiedStatus?: string;
};

const STORAGE_KEY = "applylite:package-watches-v1";
const ACTIVE = new Set<PrepStatus>(["QUEUED", "GENERATING"]);
const DONE = new Set<PrepStatus>(["READY", "NEEDS_REVIEW", "FAILED"]);

function readWatches(): PackageWatch[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => Number.isInteger(item?.id)) : [];
  } catch {
    return [];
  }
}

function writeWatches(items: PackageWatch[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("applylite:package-watch"));
}

export function watchPackageGeneration(input: Omit<PackageWatch, "notifiedStatus">) {
  const current = readWatches().filter((item) => item.id !== input.id);
  writeWatches([{ ...input }, ...current].slice(0, 20));
}

export function PackageNotifications() {
  const [watches, setWatches] = useState<PackageWatch[]>(() => readWatches());
  const [items, setItems] = useState<Record<number, PrepItem>>({});

  useEffect(() => {
    const refresh = () => setWatches(readWatches());
    window.addEventListener("applylite:package-watch", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("applylite:package-watch", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!watches.length) return;
    let alive = true;
    let timer: number | undefined;

    const poll = async () => {
      const nextItems: Record<number, PrepItem> = {};
      let nextWatches = [...watches];
      let watchChanged = false;
      let hasActive = false;

      for (const watch of watches) {
        try {
          const item = await api<PrepItem>(`/application-prep/items/${watch.id}`);
          if (!alive) return;
          nextItems[item.id] = item;
          hasActive ||= ACTIVE.has(item.status);

          if (DONE.has(item.status) && watch.notifiedStatus !== item.status) {
            nextWatches = nextWatches.map((value) => value.id === watch.id ? { ...value, notifiedStatus: item.status } : value);
            watchChanged = true;
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(item.status === "FAILED" ? "ApplyLite package failed" : "ApplyLite package ready", {
                body: item.status === "FAILED"
                  ? `${item.title} at ${item.company}: generation needs attention.`
                  : `${item.title} at ${item.company} is ready to review.`
              });
            }
          }
        } catch {
          // The queue item may have been removed during recovery. Keep the watch;
          // a later poll can reconnect without losing the user's completion alert.
          hasActive = true;
        }
      }

      if (!alive) return;
      setItems(nextItems);
      if (watchChanged) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextWatches));
        setWatches(nextWatches);
      }
      timer = window.setTimeout(poll, hasActive ? 2500 : 12000);
    };

    void poll();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [watches.map((item) => `${item.id}:${item.notifiedStatus || ""}`).join("|")]);

  const visible = useMemo(() => watches
    .map((watch) => ({ watch, item: items[watch.id] }))
    .filter(({ item }) => item && (ACTIVE.has(item.status) || DONE.has(item.status)))
    .slice(0, 3), [watches, items]);

  function dismiss(id: number) {
    writeWatches(readWatches().filter((item) => item.id !== id));
  }

  if (!visible.length) return null;
  return (
    <div className="package-notification-stack" aria-live="polite" aria-label="Application package activity">
      {visible.map(({ watch, item }) => {
        const ready = item.status === "READY" || item.status === "NEEDS_REVIEW";
        const failed = item.status === "FAILED";
        return (
          <article className={`package-notification ${ready ? "ready" : failed ? "failed" : "working"}`} key={watch.id}>
            <div>
              <span className="eyebrow">{ready ? "PACKAGE READY" : failed ? "PACKAGE NEEDS ATTENTION" : "GENERATING PACKAGE"}</span>
              <strong>{watch.title}</strong>
              <small>{watch.company}</small>
              {!ready && !failed && <p>ApplyLite is working in the background. Keep browsing jobs; you do not need to keep the Dashboard open.</p>}
              {ready && <p>Your tailored CV and cover letter are ready for review.</p>}
              {failed && <p>{item.errorMessage || "Generation failed. Open the Review Queue to retry."}</p>}
            </div>
            <div className="package-notification-actions">
              {ready && <button className="primary" onClick={() => navigate("/review")}>Review package</button>}
              {failed && <button onClick={() => navigate("/review")}>Open Review Queue</button>}
              {!ready && !failed && <button onClick={() => navigate("/discover")}>Browse jobs</button>}
              <button onClick={() => dismiss(watch.id)}>Dismiss</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
''', encoding="utf-8")

# 5) App: mount package alerts, preserve last Discovery URL, version.
app = Path("apps/web/src/App.tsx")
text = app.read_text(encoding="utf-8")
text = text.replace('import { GettingStarted } from "./components/GettingStarted";', 'import { GettingStarted } from "./components/GettingStarted";\nimport { PackageNotifications } from "./components/PackageNotifications";', 1)
text = text.replace('  const setView = (value: View) => navigate(value === "dashboard" ? "/" : `/${value}`);',
'''  const setView = (value: View) => {
    if (value === "discover") {
      navigate(sessionStorage.getItem("applylite:last-discovery-url") || "/discover");
      return;
    }
    navigate(value === "dashboard" ? "/" : `/${value}`);
  };''', 1)
text = text.replace('local job copilot - v0.16.0', 'local job copilot - v0.16.2', 1)
text = text.replace('    <div className="shell">', '    <div className="shell">\n      <PackageNotifications />', 1)
app.write_text(text, encoding="utf-8")

# 6) Dashboard: bounded workspace query + background generation.
dash = Path("apps/web/src/pages/DashboardPage.tsx")
text = dash.read_text(encoding="utf-8")
text = text.replace('import { navigate } from "../lib/navigation";', 'import { navigate } from "../lib/navigation";\nimport { watchPackageGeneration } from "../components/PackageNotifications";', 1)
text = text.replace('api<Job[]>(`/jobs?learned=${learned ? "1" : "0"}`)', 'api<Job[]>(`/jobs?workspace=1&learned=${learned ? "1" : "0"}`)', 1)
# Remove duplicate queue helper.
text = re.sub(r'\n  async function queueM7Preparation\(jobId: number\) \{.*?\n  \}\n\n  async function generatePackage', '\n  async function generatePackage', text, count=1, flags=re.S)
old_generate = '''  async function generatePackage(jobId: number) {
    setPackageLoading(true);
    setError("");
    setNotice("Generating an evidence-grounded CV, cover letter, screening drafts, and factual audit with local Qwen3...");
    try {
      const generated = await api<ApplicationPackage>(`/jobs/${jobId}/generate-package`, { method: "POST", body: "{}" });
      setApplicationPackage(generated);
      setNotice(generated.generation.readyToUse
        ? `Application package generated. Evidence audit: ${generated.status}. Review it before using any document.`
        : "Package generated in fallback mode because local AI could not complete a core document. ApplyLite will not auto-upload it; regenerate after Ollama is healthy.");
      await refresh();
    } catch (e) {
      setNotice("");
      setError(e instanceof Error ? e.message : "Could not generate application package");
    } finally {
      setPackageLoading(false);
    }
  }'''
new_generate = '''  async function generatePackage(jobId: number) {
    setPackageLoading(true);
    setError("");
    setNotice("Starting package generation in the background...");
    try {
      const result = await api<{ queued: boolean; id?: number; reason?: string }>(`/application-prep/jobs/${jobId}/queue`, { method: "POST", body: "{}" });
      if (result.id && selected) {
        watchPackageGeneration({ id: result.id, jobId, title: selected.title, company: selected.company });
      }
      setNotice(result.queued
        ? "Package generation started in the background. Go browse other opportunities — ApplyLite will alert you when the tailored CV and cover letter are ready."
        : (result.reason ?? "This package is already queued or ready. ApplyLite will keep watching it."));
    } catch (e) {
      setNotice("");
      setError(e instanceof Error ? e.message : "Could not start background application package generation");
    } finally {
      setPackageLoading(false);
    }
  }'''
if old_generate not in text: raise SystemExit("Dashboard generatePackage block not found")
text = text.replace(old_generate, new_generate, 1)
text = text.replace(
'''                {!applicationPackage && (
                  <button onClick={() => queueM7Preparation(selected.id)} disabled={packageLoading}>Queue background prep</button>
                )}''',
'''                <button onClick={() => navigate("/discover")}>Browse more jobs</button>''',
1)
text = text.replace(
'<p className="muted">Qwen selects verified CV evidence for the resume, drafts the letter and screening responses, then a second pass audits generated factual claims.</p>',
'<p className="muted">Package generation runs in the background. Start it, keep browsing other jobs, and ApplyLite will alert you when the tailored CV and cover letter are ready to review.</p>',
1)
dash.write_text(text, encoding="utf-8")

# 7) Discover: stale-while-revalidate cache + remember last URL.
discover = Path("apps/web/src/pages/DiscoverPage.tsx")
text = discover.read_text(encoding="utf-8")
text = text.replace(
'const blank:Results={items:[],counts:{all:0,strong:0,possible:0,stretch:0,notDeep:0},total:0,offset:0,limit:30,hasMore:false};',
'''const blank:Results={items:[],counts:{all:0,strong:0,possible:0,stretch:0,notDeep:0},total:0,offset:0,limit:30,hasMore:false};
const RESULT_CACHE_KEY="applylite:discovery-results-v2";
function readCachedResults():Results|null{try{const value=JSON.parse(sessionStorage.getItem(RESULT_CACHE_KEY)||"null");return value?.url===window.location.pathname+window.location.search?value.results:null;}catch{return null;}}
function writeCachedResults(results:Results){try{sessionStorage.setItem(RESULT_CACHE_KEY,JSON.stringify({url:window.location.pathname+window.location.search,results,at:Date.now()}));}catch{}}''',
1)
text = text.replace('  const [results,setResults]=useState<Results>(blank);', '  const cached=readCachedResults();\n  const [results,setResults]=useState<Results>(cached??blank);', 1)
text = text.replace('  const [loaded,setLoaded]=useState(false);', '  const [loaded,setLoaded]=useState(Boolean(cached));\n  const [revalidating,setRevalidating]=useState(Boolean(cached));', 1)
text = text.replace(
'''  useEffect(()=>{
    let alive=true;
    void Promise.all''',
'''  useEffect(()=>{sessionStorage.setItem("applylite:last-discovery-url",window.location.pathname+window.location.search);},[location]);

  useEffect(()=>{
    let alive=true;
    void Promise.all''',
1)
text = text.replace(
'''    const poll=async()=>{
      try{''',
'''    const poll=async()=>{
      try{
        setRevalidating(true);''',
1)
text = text.replace(
'''        if(!alive)return;setResults(result);setLoaded(true);''',
'''        if(!alive)return;setResults(result);setLoaded(true);setRevalidating(false);writeCachedResults(result);''',
1)
text = text.replace(
'''      }catch(e){if(alive){setError(e instanceof Error?e.message:"Could not load saved discovery status.");timer=window.setTimeout(poll,5000);}}''',
'''      }catch(e){if(alive){setRevalidating(false);setError(e instanceof Error?e.message:"Could not load saved discovery status.");timer=window.setTimeout(poll,5000);}}''',
1)
text = text.replace(
'<section className="panel" id="discovery-results"><div className="panel-title"><div><span className="eyebrow">SAVED OPPORTUNITIES</span><h2>{results.counts.all} jobs collected</h2></div><button onClick={refresh}>Refresh saved results</button></div>',
'<section className="panel" id="discovery-results"><div className="panel-title"><div><span className="eyebrow">SAVED OPPORTUNITIES</span><h2>{results.counts.all} jobs collected</h2><small className="muted">{revalidating?"Showing cached results while refreshing…":"Results are loaded from saved local scores; expensive rescoring does not block this page."}</small></div><button onClick={refresh}>Refresh saved results</button></div>',
1)
discover.write_text(text, encoding="utf-8")

# 8) Toast styling.
styles = Path("apps/web/src/styles.css")
css = styles.read_text(encoding="utf-8")
if ".package-notification-stack" not in css:
    css += r'''

.package-notification-stack { position: fixed; right: 22px; bottom: 22px; z-index: 1200; width: min(430px, calc(100vw - 36px)); display: grid; gap: 10px; }
.package-notification { background: #fff; border: 1px solid #dfe4eb; border-radius: 15px; padding: 16px; box-shadow: 0 18px 48px rgba(17, 24, 39, .18); display: grid; gap: 12px; }
.package-notification > div:first-child { display: grid; gap: 5px; }
.package-notification strong { font-size: 15px; color: #1f2a3d; }
.package-notification small { color: #7a8698; }
.package-notification p { margin: 3px 0 0; color: #667286; font-size: 13px; line-height: 1.45; }
.package-notification.ready { border-color: #badfc5; }
.package-notification.failed { border-color: #ebcbc6; }
.package-notification-actions { display: flex; gap: 8px; flex-wrap: wrap; }
@media (max-width: 720px) { .package-notification-stack { right: 12px; bottom: 12px; width: calc(100vw - 24px); } }
'''
styles.write_text(css, encoding="utf-8")

# 9) Regression: verify bounded discovery page and workspace endpoint.
perf = Path("apps/api/scripts/performanceWorkflowRegression.ts")
perf.write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";

const temp=fs.mkdtempSync(path.join(os.tmpdir(),"applylite-fast-read-"));
process.env.DATABASE_PATH=path.join(temp,"test.db");
process.env.STORAGE_PATH=path.join(temp,"storage");
process.env.APPLYLITE_TEST_MODE="true";

const {db,initializeDatabase}=await import("../src/db/database.js");
initializeDatabase();
const {getDiscoveryResults}=await import("../src/services/discovery.js");
const {jobRoutes}=await import("../src/routes/jobs.js");

const breakdown=JSON.stringify({total:50,skills:0,title:0,location:0,experience:0,preference:0,matchedSkills:[],missingSkills:[],matchedRequiredSkills:[],missingRequiredSkills:[],reasons:[],concerns:[]});
const requirements=JSON.stringify({});
const insert=db.prepare(`INSERT INTO jobs(source_url,title,company,location,salary_text,description,score,score_json,analysis_json,ats,status,origin,score_kind,analysis_status,pre_score,score_profile_hash)
VALUES(?,?,?,?,?,?,?, ?,?,'lever','SCORED','discovery','quick','not_requested',?,'old-profile')`);
const tx=db.transaction(()=>{
  for(let i=0;i<1200;i++)insert.run(`https://example.invalid/job/${i}`,`Developer ${i}`,"Fixture Co","Ireland","","React TypeScript role",i%101,breakdown,requirements,i%101);
});
tx();

const before=(db.prepare("SELECT score_profile_hash AS hash FROM jobs WHERE id=1").get() as any).hash;
const page=getDiscoveryResults({limit:30});
assert.equal(page.items.length,30);
assert.equal(page.total,1200);
assert.equal(page.counts.all,1200);
assert.equal((db.prepare("SELECT score_profile_hash AS hash FROM jobs WHERE id=1").get() as any).hash,before,"Discovery reads must not synchronously rescore/write every row.");

db.prepare("UPDATE jobs SET status='FOCUSED' WHERE id=1").run();
const api=Fastify();
await api.register(jobRoutes);
const response=await api.inject({method:"GET",url:"/jobs?workspace=1&learned=0"});
assert.equal(response.statusCode,200);
const workspace=response.json();
assert.equal(workspace.length,1,"Dashboard workspace endpoint should not load the whole discovery inbox.");
assert.equal(workspace[0].id,1);

await api.close();
db.close();
fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:50});
console.log("Fast read regression PASS: SQL-paged discovery reads are side-effect free and Dashboard only loads focused jobs.");
''', encoding="utf-8")

api_package = Path("apps/api/package.json")
text = api_package.read_text(encoding="utf-8")
text = text.replace('"regression:workflow": "tsx scripts/onboardingRegression.ts && tsx scripts/cvParsingRegression.ts && tsx scripts/providerRegression.ts && tsx scripts/taskRegression.ts && tsx scripts/discoveryWorkflowRegression.ts && tsx scripts/workflowApiRegression.ts"', '"regression:workflow": "tsx scripts/onboardingRegression.ts && tsx scripts/cvParsingRegression.ts && tsx scripts/providerRegression.ts && tsx scripts/taskRegression.ts && tsx scripts/discoveryWorkflowRegression.ts && tsx scripts/workflowApiRegression.ts && tsx scripts/performanceWorkflowRegression.ts"', 1)
api_package.write_text(text, encoding="utf-8")

# 10) Version/docs.
for filename in ["package.json","package-lock.json","apps/api/package.json","apps/web/package.json"]:
    p=Path(filename)
    if p.exists():
        p.write_text(p.read_text(encoding="utf-8").replace('"version": "0.16.1"','"version": "0.16.2"'),encoding="utf-8")

readme=Path("README.md")
text=readme.read_text(encoding="utf-8")
text=text.replace("**Release candidate: 0.16.1.** Discovery is now the broad inbox and Dashboard is the focused application workspace.", "**Release candidate: 0.16.2.** Discovery is the broad inbox, Dashboard is the focused workspace, saved job views use bounded/cache-first reads, and package generation can continue in the background while you browse.")
text=text.replace("9. In **Dashboard**, generate/review the tailored CV and cover letter, then open the employer form for assisted filling. ApplyLite never clicks the employer's final Submit control.", "9. In **Dashboard**, start package generation. It runs in the background, so you can return to Discover and keep comparing jobs. A persistent in-app alert appears when the tailored CV and cover letter are ready (and a system notification is used if the browser already has notification permission). Review the package, then open the employer form for assisted filling. ApplyLite never clicks the employer's final Submit control.")
readme.write_text(text,encoding="utf-8")

changelog=Path("CHANGELOG.md")
c=changelog.read_text(encoding="utf-8")
c="# 0.16.2 - Fast saved views and background package alerts\n\n- Stop synchronous rescoring of every saved discovery job whenever Discover opens.\n- SQL-page common discovery views and preserve the last Discovery URL/results for instant cache-first navigation.\n- Make Dashboard request only focused/actioned jobs instead of loading the entire discovery inbox.\n- Run the main Generate application package action through the existing background preparation queue.\n- Add persistent cross-page package activity alerts with ready/failed actions and optional OS notification when already permitted.\n- Add a regression proving discovery reads are bounded/side-effect-free and Dashboard loads only focused jobs.\n\n"+c
changelog.write_text(c,encoding="utf-8")
