import { useEffect, useState } from "react";
import { ProfileSchema, type DiscoverySource, type Profile, type ScoreBreakdown } from "@apply-lite/shared";
import { api } from "../lib/api";
import { navigate, useLocation } from "../lib/navigation";
import { TaskProgress, taskActive, type Task } from "../components/TaskProgress";

type ResultJob = { id:number;title:string;company:string;location:string;sourceUrl:string;description:string;score:number;scoreKind:string;analysisStatus:string;inWorkspace:boolean;stale:boolean;scoreBreakdown:ScoreBreakdown;requirements:{workplaceType:string} };
type Results = {items:ResultJob[];counts:{all:number;strong:number;possible:number;stretch:number;notDeep:number};total:number;offset:number;limit:number;hasMore:boolean};
const csv=(value:string)=>value.split(/[,;\n]/).map(s=>s.trim()).filter(Boolean);
const blank:Results={items:[],counts:{all:0,strong:0,possible:0,stretch:0,notDeep:0},total:0,offset:0,limit:30,hasMore:false};
export function DiscoverPage(){
  const location=useLocation();
  const params=new URLSearchParams(window.location.search);
  const [profile,setProfile]=useState<Profile>(ProfileSchema.parse({}));
  const [sources,setSources]=useState<DiscoverySource[]>([]);
  const [titles,setTitles]=useState("");
  const [places,setPlaces]=useState("");
  const [analyses,setAnalyses]=useState(0);
  const [broadIT,setBroadIT]=useState(false);
  const [task,setTask]=useState<Task|null>(null);
  const [deepTask,setDeepTask]=useState<Task|null>(null);
  const [results,setResults]=useState<Results>(blank);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [sourceUrl,setSourceUrl]=useState("");
  const [sourceName,setSourceName]=useState("");
  const [refreshKey,setRefreshKey]=useState(0);
  const refresh=()=>setRefreshKey(n=>n+1);

  useEffect(()=>{
    let alive=true;
    void Promise.all([api<Profile>("/profile"),api<DiscoverySource[]>("/discovery/sources"),api<any>("/discovery/settings")]).then(([p,s,settings])=>{
      if(!alive)return;setProfile(p);setSources(s);
      setTitles((p.targetTitles.length?p.targetTitles:[p.currentTitle].filter(Boolean)).join(", "));
      setPlaces(p.preferredLocations.join(", "));setAnalyses(settings.maxDeepAnalysis??0);setBroadIT(settings.broadEntryLevelIT??false);
    }).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;};
  },[]);

  useEffect(()=>{
    let alive=true,timer:number|undefined;const controller=new AbortController();
    const poll=async()=>{
      try{
        const query=new URLSearchParams(window.location.search),id=query.get("task");
        const current=await api<Task|null>(id?`/discovery/runs/${encodeURIComponent(id)}`:"/discovery/runs/latest",{signal:controller.signal});
        if(!alive)return;setTask(current);
        const runId=current?.result?.runId??current?.counters.runId;
        const filters=new URLSearchParams(query);filters.delete("task");
        filters.delete("scope");
        if(runId && query.get("scope")==="run")filters.set("runId",String(runId));
        const result=await api<Results>(`/discovery/results?${filters}`,{signal:controller.signal});
        if(!alive)return;setResults(result);setLoaded(true);
        let pendingDeep=false;
        if(deepTask?.id){const t=await api<Task>(`/tasks/${deepTask.id}`,{signal:controller.signal});if(!alive)return;setDeepTask(t);pendingDeep=taskActive(t);}
        if((current&&taskActive(current))||pendingDeep)timer=window.setTimeout(poll,2000);
      }catch(e){if(alive){setError(e instanceof Error?e.message:"Could not load saved discovery status.");timer=window.setTimeout(poll,5000);}}
    };
    void poll();return()=>{alive=false;controller.abort();if(timer)window.clearTimeout(timer);};
  },[location,refreshKey,deepTask?.id]);

  function filter(key:string,value:string){const q=new URLSearchParams(window.location.search);if(value)q.set(key,value);else q.delete(key);if(key!=="offset")q.delete("offset");navigate(`/discover${q.size?`?${q}`:""}`,true);}
  async function run(){
    setBusy(true);setError("");
    try{
      const t=await api<Task>("/discovery/runs",{method:"POST",body:JSON.stringify({targetTitles:csv(titles),locations:csv(places),maxDeepAnalysis:analyses,analysisConcurrency:1,minPreScore:0,minFinalScore:0,broadEntryLevelIT:broadIT,useOutcomeLearning:true,entryLevelOnly:false,includeRemoteUS:true})});
      setTask(t);const q=new URLSearchParams(window.location.search);q.set("task",t.id);q.delete("offset");navigate(`/discover?${q}`,true);setNotice("Discovery queued. You can leave this page; keep ApplyLite running.");refresh();
    }catch(e){setError(e instanceof Error?e.message:"Could not start discovery.");}finally{setBusy(false);}
  }
  async function deepAnalyze(id:number){try{setDeepTask(await api<Task>(`/discovery/jobs/${id}/analyze`,{method:"POST",body:"{}"}));refresh();}catch(e){setError(e instanceof Error?e.message:"Could not queue deep analysis.");}}
  async function moveToDashboard(job:ResultJob){
    if(job.inWorkspace){navigate("/");return;}
    setError("");
    try{
      await api(`/jobs/${job.id}/workspace-status`,{method:"PATCH",body:JSON.stringify({status:"FOCUSED"})});
      setNotice(`${job.title} moved to Dashboard. It is now in your focused workspace for package generation and assisted applying.`);
      refresh();
    }catch(e){setError(e instanceof Error?e.message:"Could not move this job to Dashboard.");}
  }
  async function addSource(event:React.FormEvent){event.preventDefault();try{await api("/discovery/sources",{method:"POST",body:JSON.stringify({url:sourceUrl,name:sourceName})});setSourceUrl("");setSourceName("");setSources(await api<DiscoverySource[]>("/discovery/sources"));}catch(e){setError(e instanceof Error?e.message:"Could not add source.");}}
  async function toggleSource(source:DiscoverySource){try{await api(`/discovery/sources/${source.id}`,{method:"PATCH",body:JSON.stringify({enabled:!source.enabled})});setSources(await api<DiscoverySource[]>("/discovery/sources"));}catch(e){setError(e instanceof Error?e.message:"Could not update source.");}}
  const running=!!task&&taskActive(task);
  const checks:[string,string][]=[["strictTitle","Strict target-title match"],["entryLevelOnly","Entry-level only"],["hideSenior","Hide senior roles"],["strictLocation","Location-compatible only"],["remoteOnly","Remote only"]];
  return <>
    <header className="page-header"><div><span className="eyebrow">DISCOVERY INBOX</span><h1>Discover opportunities</h1><p>Collect broadly, compare against your CV and keep even lower-score possibilities here. Move only promising jobs to the focused Dashboard.</p></div><button className="primary" onClick={run} disabled={busy||running||!sources.some(s=>s.enabled)||(!titles.trim()&&!broadIT)}>{running?"Discovery running":"Find jobs now"}</button></header>
    <section className="panel"><div className="panel-title"><div><span className="eyebrow">DISCOVER → DASHBOARD → APPLY</span><h2>This page is your broad job inbox</h2></div><button onClick={()=>navigate("/")}>Open focused Dashboard</button></div><div className="stats-grid"><article><span>1 · Discover</span><strong>See the broad market</strong><small>Low scores stay visible so useful possibilities are not silently discarded.</small></article><article><span>2 · Compare</span><strong>Inspect fit and evidence</strong><small>Filter, read the posting and request deep analysis when a job deserves it.</small></article><article><span>3 · Promote</span><strong>Move to Dashboard</strong><small>Promoting means “I may pursue this”; it does not apply anywhere.</small></article><article><span>4 · Action</span><strong>Prepare and apply there</strong><small>The Dashboard handles CV/cover-letter packages and assisted form filling.</small></article></div></section>
    {error&&<div role="alert" className="alert">{error}</div>}{notice&&<p role="status" className="notice">{notice}</p>}
    <section className="panel"><h2>Your search</h2><div className="form-grid"><label>Target roles or career terms<input value={titles} onChange={e=>setTitles(e.target.value)} placeholder="Your chosen roles, separated by commas"/></label><label>Search locations<input value={places} onChange={e=>setPlaces(e.target.value)} placeholder="Ireland, Remote, or your preferred places"/></label><label>Optional deep analyses per run<input type="number" min="0" max="20" value={analyses} onChange={e=>setAnalyses(Math.max(0,Math.min(20,Number(e.target.value)||0)))}/></label><label className="choice-row"><input type="checkbox" checked={broadIT} onChange={e=>setBroadIT(e.target.checked)}/><span>Also explore entry-level IT role families</span></label></div><p className="muted">Zero deep analyses gives a fully non-AI discovery run. Public searches use your terms, while employer feeds may include broader options. Collection limits and available source coverage still apply.</p></section>
    {task&&<TaskProgress task={task} onChange={refresh}/>} {deepTask&&<TaskProgress task={deepTask} onChange={next=>{if(next)setDeepTask(next);refresh();}}/>}
    <section className="panel" id="discovery-results"><div className="panel-title"><div><span className="eyebrow">SAVED OPPORTUNITIES</span><h2>{results.counts.all} jobs collected</h2></div><button onClick={refresh}>Refresh saved results</button></div>
      <div className="pipeline-tabs">{[["","All",results.counts.all],["strong","Strong",results.counts.strong],["possible","Possible",results.counts.possible],["stretch","Stretch",results.counts.stretch]].map(([key,label,n])=><button className={`pipeline-tab ${((params.get("band")||"")===key)?"active":""}`} key={String(key)} onClick={()=>filter("band",String(key))}>{label}<span>{n}</span></button>)}</div>
      <p>{results.total} currently match your display filters. {results.counts.notDeep} have no completed deep analysis. These counts overlap the fit bands.</p>
      <div className="discovery-filter-grid"><label>Results scope<select value={params.get("scope")||"all"} onChange={e=>filter("scope",e.target.value)}><option value="all">All saved discoveries</option><option value="run">This discovery run</option></select></label><label>Search saved results<input value={params.get("query")||""} onChange={e=>filter("query",e.target.value)}/></label><label>Minimum score<select value={params.get("minScore")||"0"} onChange={e=>filter("minScore",e.target.value)}><option value="0">Any score</option><option value="40">40+</option><option value="60">60+</option><option value="75">75+</option></select></label><label>Analysis<select value={params.get("analysis")||""} onChange={e=>filter("analysis",e.target.value)}><option value="">Any analysis</option><option value="quick">Not deeply analyzed</option><option value="deep">Deeply analyzed</option></select></label></div>
      <div className="filter-checks">{checks.map(([key,label])=><label className="choice-row" key={key}><input type="checkbox" checked={params.get(key)==="true"} onChange={e=>filter(key,e.target.checked?"true":"")}/><span>{label}</span></label>)}<label className="choice-row"><input type="checkbox" checked={params.get("includeRemoteUS")!=="false"} onChange={e=>filter("includeRemoteUS",e.target.checked?"true":"false")}/><span>Show US-scoped remote jobs (hiring eligibility unverified)</span></label></div>
      <button onClick={()=>{const q=new URLSearchParams();if(params.get("task"))q.set("task",params.get("task")!);navigate(`/discover?${q}`,true);}}>Clear display filters</button>
      <div className="broad-job-list">{results.items.map(job=><article className="broad-job-card" key={job.id}><div className="job-card-heading"><span className={`score ${job.score>=75?"strong":job.score>=50?"good":"weak"}`}>{job.score}</span><div><h3>{job.title}</h3><p>{job.company} - {job.location||"Location not stated"}</p></div><a href={job.sourceUrl} target="_blank" rel="noreferrer">Open posting</a></div><p className="score-kind">{job.scoreKind==="deep"?"AI-analyzed fit; review evidence":job.scoreKind==="quick"?"Quick score - provisional":"Previous analysis"} {job.analysisStatus==="failed"&&"- AI analysis failed; previous result retained"}{job.analysisStatus==="stale"&&" - source changed; previous detailed analysis retained until reanalysis"}{job.stale&&" - profile/CV has changed; rescore recommended"}</p><p><strong>{job.scoreKind==="deep"?"Matched skills":"CV skills mentioned"}:</strong> {job.scoreBreakdown.matchedSkills?.join(", ")||"No explicit matches identified yet"}</p>{job.scoreKind==="deep"&&<p><strong>Missing or unverified:</strong> {job.scoreBreakdown.missingSkills?.join(", ")||"None identified; check the posting"}</p>}<details><summary>Why this score?</summary><p>Skills {job.scoreBreakdown.skills}/40; role {job.scoreBreakdown.title}/20; experience {job.scoreBreakdown.experience}/15; location {job.scoreBreakdown.location}/10; preferences {job.scoreBreakdown.preference}/15.</p>{job.scoreBreakdown.reasons?.map((s,i)=><p key={`r${i}`}>{s}</p>)}{job.scoreBreakdown.concerns?.map((s,i)=><p className="muted" key={`c${i}`}>{s}</p>)}<p>Fit scores are ranking aids, not a hiring probability or proof of eligibility.</p></details><details><summary>Posting text</summary><p className="source-preview">{job.description}</p></details><div className="actions"><button className="primary" onClick={()=>moveToDashboard(job)}>{job.inWorkspace?"Open in Dashboard":"Move to Dashboard"}</button><button disabled={!!deepTask&&taskActive(deepTask)} onClick={()=>deepAnalyze(job.id)}>Deep analyze this job</button></div></article>)}</div>
      {loaded&&!results.items.length&&<div className="empty"><strong>{results.counts.all?"No jobs match these filters":"No collected jobs yet"}</strong><span>{results.counts.all?"Your lower-scoring jobs are still saved. Clear filters to see them.":"Run discovery or check the source warnings. You can import an employer URL from Dashboard."}</span></div>}
      <div className="actions"><button disabled={results.offset===0} onClick={()=>filter("offset",String(Math.max(0,results.offset-results.limit)))}>Previous page</button><span>{results.total?`${results.offset+1}-${Math.min(results.total,results.offset+results.limit)} of ${results.total}`:"0 results"}</span><button disabled={!results.hasMore} onClick={()=>filter("offset",String(results.offset+results.limit))}>Next page</button></div>
      {task && task.result?.errors?.length>0&&<details><summary>Source and analysis warnings ({task.result.errors.length})</summary>{task.result.errors.map((e:string,i:number)=><p key={i}>{e}</p>)}</details>}
    </section>
    <details className="panel"><summary>Manage discovery sources ({sources.filter(s=>s.enabled).length} enabled)</summary><p>Current starter boards are mostly Ireland/technology-focused. Add public employer boards relevant to your field.</p>{sources.map(source=><article className="source-row" key={source.id}><div><strong>{source.name}</strong><small>{source.lastError||source.ats}</small></div><a href={source.boardUrl} target="_blank" rel="noreferrer">Open board</a><button onClick={()=>toggleSource(source)}>{source.enabled?"Disable":"Enable"}</button></article>)}<form onSubmit={addSource} className="form-grid"><label>Job or board URL<input value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} required/></label><label>Company name<input value={sourceName} onChange={e=>setSourceName(e.target.value)}/></label><button>Add source</button></form></details>
    <p className="muted">Profile: {profile.targetTitles.join(", ")||"No confirmed target titles"}. Missing dates are not a reason to hide opportunities. Remote is not proof an employer can hire in your country.</p>
  </>;
}
