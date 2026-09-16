import { useEffect, useMemo, useState } from "react";
import type { DiscoverySource, Profile, ScoreBreakdown } from "@apply-lite/shared";
import { ProfileSchema } from "@apply-lite/shared";
import { api } from "../lib/api";

type ImportedMatch = {
  id: number;
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  ats: string;
  score: number;
  preScore: number;
  scoreBreakdown: ScoreBreakdown;
};

type DiscoveryResult = {
  runId: number;
  sourcesScanned: number;
  jobsSeen: number;
  candidatesAfterPrefilter: number;
  jobsAnalyzed: number;
  jobsImported: number;
  cacheHits: number;
  aiRequests: number;
  sourceFetchMs: number;
  analysisMs: number;
  durationMs: number;
  analysisConcurrency: number;
  useOutcomeLearning: boolean;
  entryLevelOnly: boolean;
  broadEntryLevelIT: boolean;
  includeRemoteUS: boolean;
  searchQueries: string[];
  targetTitles: string[];
  locations: string[];
  imported: ImportedMatch[];
  errors: string[];
};

type ExperienceSummary = {
  totalYears: number;
  technicalYears: number;
  relevantYears: number;
  parseableEmploymentCount: number;
  scoringDefaultYears: number;
  scoringSource: string;
  warnings: string[];
};

function csv(values: string[]) {
  return values.join(", ");
}

function parseCsv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function DiscoverPage() {
  const [profile, setProfile] = useState<Profile>(ProfileSchema.parse({}));
  const [sources, setSources] = useState<DiscoverySource[]>([]);
  const [experience, setExperience] = useState<ExperienceSummary | null>(null);
  const [targetTitles, setTargetTitles] = useState("");
  const [locations, setLocations] = useState("");
  const [minFinalScore, setMinFinalScore] = useState(60);
  const [maxDeepAnalysis, setMaxDeepAnalysis] = useState(12);
  const [analysisConcurrency, setAnalysisConcurrency] = useState(2);
  const [useOutcomeLearning, setUseOutcomeLearning] = useState(true);
  const [entryLevelOnly, setEntryLevelOnly] = useState(false);
  const [broadEntryLevelIT, setBroadEntryLevelIT] = useState(false);
  const [includeRemoteUS, setIncludeRemoteUS] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refreshSources() {
    setSources(await api<DiscoverySource[]>("/discovery/sources"));
  }

  useEffect(() => {
    Promise.all([
      api<Profile>("/profile"),
      api<DiscoverySource[]>("/discovery/sources"),
      api<ExperienceSummary>("/experience/summary")
    ]).then(([savedProfile, savedSources, summary]) => {
      setProfile(savedProfile);
      setSources(savedSources);
      setExperience(summary);
      setTargetTitles(csv(savedProfile.targetTitles.length ? savedProfile.targetTitles : [savedProfile.currentTitle].filter(Boolean)));
      setLocations(csv([...savedProfile.preferredLocations, savedProfile.city, savedProfile.country].filter(Boolean)));
    }).catch((e) => setError(e instanceof Error ? e.message : "Could not load discovery settings"));
  }, []);

  const enabledCount = useMemo(() => sources.filter((source) => source.enabled).length, [sources]);

  async function addSource(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await api("/discovery/sources", {
        method: "POST",
        body: JSON.stringify({ url: sourceUrl.trim(), name: sourceName.trim() })
      });
      setSourceUrl("");
      setSourceName("");
      setMessage("Discovery source added. ApplyLite will scan its public job board on the next run.");
      await refreshSources();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add source");
    }
  }

  async function toggleSource(source: DiscoverySource) {
    setError("");
    try {
      await api(`/discovery/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !source.enabled })
      });
      await refreshSources();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update source");
    }
  }

  async function runDiscovery() {
    setLoading(true);
    setError("");
    setMessage("Scanning Irish-market, global-remote, and employer-board sources with diversified entry-level IT searches. Uncached Qwen analysis can take several minutes; keep this page open...");
    setResult(null);
    try {
      const output = await api<DiscoveryResult>("/discovery/run", {
        method: "POST",
        // Irish-market discovery can legitimately exceed the generic 5-minute API timeout
        // when public sources are slow and several uncached Qwen analyses are required.
        signal: AbortSignal.timeout(900_000),
        body: JSON.stringify({
          targetTitles: parseCsv(targetTitles),
          locations: parseCsv(locations),
          minPreScore: 25,
          minFinalScore,
          maxDeepAnalysis,
          analysisConcurrency,
          useOutcomeLearning,
          entryLevelOnly,
          broadEntryLevelIT,
          includeRemoteUS
        })
      });
      setResult(output);
      const seconds = Math.max(0.1, output.durationMs / 1000).toFixed(1);
      setMessage(`Discovery completed in ${seconds}s: ${output.searchQueries.length} diversified search terms, ${output.jobsSeen} jobs seen, ${output.jobsAnalyzed} evaluated, ${output.cacheHits} cache hits, ${output.aiRequests} Qwen requests, ${output.jobsImported} new matches saved.`);
      await refreshSources();
    } catch (e) {
      setMessage("");
      setError(e instanceof Error ? e.message : "Discovery failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">M5.2 BROAD ENTRY-LEVEL DISCOVERY</span>
          <h1>Find jobs for me</h1>
          <p>Scan direct employer ATS boards, Irish-market searches, and global remote feeds using diversified entry-level IT queries, then use Qwen only on the strongest candidates.</p>
        </div>
        <button className="primary" onClick={runDiscovery} disabled={loading || enabledCount === 0}>
          {loading ? "Discovering..." : "Find jobs now"}
        </button>
      </header>

      {error && <div className="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <section className="stats-grid discovery-stats">
        <article><span>Enabled sources</span><strong>{enabledCount}</strong></article>
        <article><span>CV technical experience</span><strong>{experience ? `${experience.technicalYears}y` : "—"}</strong></article>
        <article><span>Target titles</span><strong>{parseCsv(targetTitles).length}</strong></article>
        <article><span>Search mode</span><strong>{entryLevelOnly ? (broadEntryLevelIT ? "Entry-level IT" : "Entry level") : "Broad"}</strong></article>
        <article><span>Minimum final fit</span><strong>{minFinalScore}%</strong></article>
      </section>

      <div className="discovery-layout">
        <section className="panel">
          <div className="panel-title">
            <div><span className="eyebrow">SEARCH PROFILE</span><h2>What should ApplyLite look for?</h2></div>
          </div>
          <div className="form-grid">
            <label className="full">Target titles
              <input value={targetTitles} onChange={(e) => setTargetTitles(e.target.value)} placeholder="Software Developer, Junior Software Engineer, IT Project Manager" />
            </label>
            <label className="full">Locations
              <input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="Dublin, Ireland, Remote" />
            </label>
            <label>Minimum final fit
              <input type="number" min="0" max="100" value={minFinalScore} onChange={(e) => setMinFinalScore(Number(e.target.value))} />
            </label>
            <label>Deep analyses per run
              <input type="number" min="1" max="20" value={maxDeepAnalysis} onChange={(e) => setMaxDeepAnalysis(Number(e.target.value))} />
            </label>
            <label>AI concurrency
              <input type="number" min="1" max="4" value={analysisConcurrency} onChange={(e) => setAnalysisConcurrency(Number(e.target.value))} />
            </label>
            <label className="learning-toggle full">
              <input type="checkbox" checked={useOutcomeLearning} onChange={(e) => setUseOutcomeLearning(e.target.checked)} />
              <span>Use outcome learning when enough real application history exists</span>
            </label>
            <label className="learning-toggle full">
              <input type="checkbox" checked={entryLevelOnly} onChange={(e) => setEntryLevelOnly(e.target.checked)} />
              <span>Entry-level focus: reject senior/lead/manager/architect roles and postings asking for 4+ years</span>
            </label>
            <label className="learning-toggle full">
              <input type="checkbox" checked={broadEntryLevelIT} onChange={(e) => setBroadEntryLevelIT(e.target.checked)} />
              <span>Broaden beyond my exact titles across entry-level IT: software, support, QA, data, cloud, security, project and AI</span>
            </label>
            <label className="learning-toggle full">
              <input type="checkbox" checked={includeRemoteUS} onChange={(e) => setIncludeRemoteUS(e.target.checked)} />
              <span>Include US-scoped remote roles when they are otherwise entry-level compatible</span>
            </label>
          </div>
          <p className="muted discovery-note">ApplyLite no longer burns its public-board search budget on the first few near-duplicate titles. It rotates across software, support, QA, IT, project, AI, data, cloud, and security families, then ranks everything locally before sending at most {maxDeepAnalysis} candidates to Qwen. US remote matches receive a small location penalty so Ireland/Europe-compatible roles still rank first.</p>
        </section>

        <section className="panel">
          <div className="panel-title">
            <div><span className="eyebrow">EXPERIENCE ENGINE</span><h2>CV-derived experience</h2></div>
          </div>
          {experience ? (
            <div className="experience-summary">
              <div><span>All employment</span><strong>{experience.totalYears} years</strong></div>
              <div><span>Technical employment</span><strong>{experience.technicalYears} years</strong></div>
              <div><span>Date ranges parsed</span><strong>{experience.parseableEmploymentCount}</strong></div>
              <small>Job scoring now derives relevant experience from dated CV evidence instead of trusting a default profile value of zero.</small>
            </div>
          ) : <p className="muted">Upload a CV to calculate experience.</p>}
        </section>
      </div>

      <section className="panel">
        <div className="panel-title">
          <div><span className="eyebrow">DISCOVERY SOURCES</span><h2>Irish market + employer boards + global remote</h2></div>
          <span className="muted">JobsIreland · IrishJobs · Remote OK · Lever · Ashby · Greenhouse</span>
        </div>

        <div className="source-list">
          {sources.map((source) => (
            <article key={source.id} className={source.enabled ? "source-row" : "source-row disabled"}>
              <div>
                <strong>{source.name}</strong>
                <span>{source.ats} · {source.boardKey}</span>
                {source.lastError && <small className="source-error">Last scan: {source.lastError}</small>}
                {!source.lastError && source.lastScanAt && <small>Last scanned {source.lastScanAt}</small>}
              </div>
              <a href={source.boardUrl} target="_blank" rel="noreferrer">Open board ↗</a>
              <button onClick={() => toggleSource(source)}>{source.enabled ? "Disable" : "Enable"}</button>
            </article>
          ))}
        </div>

        <form className="add-source" onSubmit={addSource}>
          <div>
            <label>Job or board URL
              <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://jobs.lever.co/company/..." required />
            </label>
            <label>Company name (optional)
              <input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="Company name" />
            </label>
          </div>
          <button className="primary">Add source</button>
        </form>
        <p className="muted discovery-note">ApplyLite combines direct employer ATS boards with diversified JobsIreland/IrishJobs searches and the Remote OK public feed. Generic worldwide/Europe remote jobs remain eligible, and US-scoped remote jobs can be included with the search toggle. Every supported URL you manually import is still learned as a future discovery source too.</p>
      </section>

      {result && (
        <section className="panel">
          <div className="panel-title">
            <div><span className="eyebrow">LATEST RUN</span><h2>{result.jobsImported} new matches saved</h2></div>
            <span className="muted">{result.searchQueries.length} search terms · {result.jobsSeen} seen · {result.candidatesAfterPrefilter} passed cheap filter · {result.jobsAnalyzed} evaluated · {result.cacheHits} cached · {result.aiRequests} AI calls · {(result.durationMs / 1000).toFixed(1)}s</span>
          </div>

          <div className="discovered-matches">
            {result.imported.map((job) => (
              <article key={job.id}>
                <div className={`score ${job.score >= 85 ? "strong" : job.score >= 70 ? "good" : "weak"}`}>{job.score}</div>
                <div>
                  <strong>{job.title}</strong>
                  <span>{job.company} · {job.location || "Location not specified"} · {job.ats}</span>
                  <small>{job.scoreBreakdown.matchedRequiredSkills?.slice(0, 5).join(" · ") || "Open Dashboard for full analysis"}</small>
                  {job.scoreBreakdown.baseTotal !== undefined && job.scoreBreakdown.outcomeLearningActive && (job.scoreBreakdown.outcomeAdjustment ?? 0) !== 0 && (
                    <small className="outcome-score-note">Base {job.scoreBreakdown.baseTotal}% · learned {(job.scoreBreakdown.outcomeAdjustment ?? 0) > 0 ? "+" : ""}{job.scoreBreakdown.outcomeAdjustment} → {job.score}%</small>
                  )}
                </div>
                <a href={job.sourceUrl} target="_blank" rel="noreferrer">Posting ↗</a>
              </article>
            ))}
            {!result.imported.length && <div className="empty"><strong>No new jobs cleared the final threshold</strong><span>Try another source, broaden target titles/locations, or lower the final fit threshold slightly.</span></div>}
          </div>

          {result.errors.length > 0 && (
            <details className="discovery-errors">
              <summary>{result.errors.length} source/job warnings</summary>
              <ul>{result.errors.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
