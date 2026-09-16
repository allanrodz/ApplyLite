import { useEffect, useMemo, useState } from "react";
import type {
  DailyDiscoveryBrief,
  DailyDiscoveryItem,
  DailyDiscoverySettings,
  DailyDiscoveryStatus
} from "@apply-lite/shared";
import { api } from "../lib/api";

function csv(values: string[]) {
  return values.join(", ");
}

function parseCsv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatSeconds(ms: number) {
  if (!ms) return "—";
  if (ms < 60_000) return `${Math.max(0.1, ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function prettyTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.replace("T", " ");
  return parsed.toLocaleString();
}

function scoreTone(score: number) {
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  return "weak";
}

type SettingsForm = {
  enabled: boolean;
  runTime: string;
  targetTitles: string;
  locations: string;
  minPreScore: number;
  minFinalScore: number;
  maxDeepAnalysis: number;
  analysisConcurrency: number;
  shortlistSize: number;
  useOutcomeLearning: boolean;
};

function toForm(settings: DailyDiscoverySettings): SettingsForm {
  return {
    enabled: settings.enabled,
    runTime: settings.runTime,
    targetTitles: csv(settings.targetTitles),
    locations: csv(settings.locations),
    minPreScore: settings.minPreScore,
    minFinalScore: settings.minFinalScore,
    maxDeepAnalysis: settings.maxDeepAnalysis,
    analysisConcurrency: settings.analysisConcurrency,
    shortlistSize: settings.shortlistSize,
    useOutcomeLearning: settings.useOutcomeLearning
  };
}

export function DailyBriefPage() {
  const [status, setStatus] = useState<DailyDiscoveryStatus | null>(null);
  const [history, setHistory] = useState<DailyDiscoveryBrief[]>([]);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh(keepForm = true) {
    const [nextStatus, recent] = await Promise.all([
      api<DailyDiscoveryStatus>("/daily-discovery/status"),
      api<DailyDiscoveryBrief[]>("/daily-discovery/briefs?limit=8")
    ]);
    setStatus(nextStatus);
    setHistory(recent);
    if (!keepForm || !form) setForm(toForm(nextStatus.settings));
  }

  useEffect(() => {
    refresh(false).catch((e) => setError(e instanceof Error ? e.message : "Could not load Daily Brief"));
    const timer = window.setInterval(() => {
      refresh(true).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latest = status?.latestBrief ?? null;
  const newCount = useMemo(() => latest?.items.filter((item) => item.status === "NEW").length ?? 0, [latest]);

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await api<DailyDiscoverySettings>("/daily-discovery/settings", {
        method: "PUT",
        body: JSON.stringify({
          enabled: form.enabled,
          runTime: form.runTime,
          targetTitles: parseCsv(form.targetTitles),
          locations: parseCsv(form.locations),
          minPreScore: form.minPreScore,
          minFinalScore: form.minFinalScore,
          maxDeepAnalysis: form.maxDeepAnalysis,
          analysisConcurrency: form.analysisConcurrency,
          shortlistSize: form.shortlistSize,
          useOutcomeLearning: form.useOutcomeLearning
        })
      });
      setForm(toForm(saved));
      setMessage(saved.enabled
        ? `Daily discovery enabled for ${saved.runTime} local time.`
        : "Daily discovery settings saved. Automatic runs are currently disabled.");
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save Daily Brief settings");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setError("");
    setMessage("Scanning enabled ATS boards and building today's shortlist...");
    try {
      const brief = await api<DailyDiscoveryBrief>("/daily-discovery/run-now", { method: "POST", body: "{}" });
      setMessage(`Daily brief ready: ${brief.shortlistCount} matches shortlisted from ${brief.jobsSeen} jobs seen.`);
      await refresh(true);
    } catch (e) {
      setMessage("");
      setError(e instanceof Error ? e.message : "Daily discovery failed");
    } finally {
      setRunning(false);
    }
  }

  async function prepareItem(item: DailyDiscoveryItem) {
    setError("");
    setMessage("");
    try {
      const result = await api<{ queued: boolean; reason?: string }>(`/application-prep/jobs/${item.jobId}/queue`, {
        method: "POST",
        body: "{}"
      });
      setMessage(result.queued
        ? `${item.title} queued for M7 background package preparation.`
        : (result.reason ?? `${item.title} is already in the M7 review queue.`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue this job for M7 preparation");
    }
  }

  async function setItemStatus(item: DailyDiscoveryItem, nextStatus: DailyDiscoveryItem["status"]) {
    setError("");
    try {
      await api(`/daily-discovery/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus })
      });
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update brief item");
    }
  }

  if (!form) {
    return <div className="panel"><p className="muted">Loading M6 Daily Brief...</p></div>;
  }

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">M6 DAILY AUTONOMOUS DISCOVERY</span>
          <h1>Your daily job brief</h1>
          <p>ApplyLite scans your enabled employer boards once per day, ranks new opportunities with CV fit and outcome learning, then gives you a small review-first shortlist.</p>
        </div>
        <button className="primary" onClick={runNow} disabled={running || status?.running}>
          {running || status?.running ? "Discovery running..." : "Run today's discovery now"}
        </button>
      </header>

      {error && <div className="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <section className="stats-grid daily-stats">
        <article><span>Automation</span><strong>{status?.settings.enabled ? "ON" : "OFF"}</strong></article>
        <article><span>Next scheduled run</span><strong className="daily-stat-text">{status?.dueToday ? "Due now" : prettyTime(status?.nextRunAt ?? null)}</strong></article>
        <article><span>New matches to review</span><strong>{newCount}</strong></article>
        <article><span>Last run</span><strong className="daily-stat-text">{latest ? formatSeconds(latest.durationMs) : "—"}</strong></article>
      </section>

      <div className="daily-layout">
        <section className="panel">
          <div className="panel-title">
            <div><span className="eyebrow">AUTOMATION SETTINGS</span><h2>When should ApplyLite search?</h2></div>
          </div>
          <form onSubmit={saveSettings}>
            <div className="form-grid">
              <label className="daily-enable full">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                <span>Run discovery automatically once per day while the local ApplyLite API is available</span>
              </label>
              <label>Local run time
                <input type="time" value={form.runTime} onChange={(e) => setForm({ ...form, runTime: e.target.value })} />
              </label>
              <label>Daily shortlist size
                <input type="number" min="1" max="10" value={form.shortlistSize} onChange={(e) => setForm({ ...form, shortlistSize: Number(e.target.value) })} />
              </label>
              <label className="full">Target titles
                <input value={form.targetTitles} onChange={(e) => setForm({ ...form, targetTitles: e.target.value })} placeholder="Software Engineer, AI Engineer, IT Project Manager" />
              </label>
              <label className="full">Locations
                <input value={form.locations} onChange={(e) => setForm({ ...form, locations: e.target.value })} placeholder="Dublin, Ireland, Remote" />
              </label>
              <label>Minimum final fit
                <input type="number" min="0" max="100" value={form.minFinalScore} onChange={(e) => setForm({ ...form, minFinalScore: Number(e.target.value) })} />
              </label>
              <label>Local prefilter minimum
                <input type="number" min="0" max="100" value={form.minPreScore} onChange={(e) => setForm({ ...form, minPreScore: Number(e.target.value) })} />
              </label>
              <label>Deep analyses per day
                <input type="number" min="1" max="20" value={form.maxDeepAnalysis} onChange={(e) => setForm({ ...form, maxDeepAnalysis: Number(e.target.value) })} />
              </label>
              <label>AI concurrency
                <input type="number" min="1" max="4" value={form.analysisConcurrency} onChange={(e) => setForm({ ...form, analysisConcurrency: Number(e.target.value) })} />
              </label>
              <label className="daily-enable full">
                <input type="checkbox" checked={form.useOutcomeLearning} onChange={(e) => setForm({ ...form, useOutcomeLearning: e.target.checked })} />
                <span>Use M5.1 outcome learning when enough labelled application history exists</span>
              </label>
            </div>
            <div className="actions"><button className="primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save daily schedule"}</button></div>
          </form>
          <div className="daily-scheduler-note">
            <strong>Local-first scheduler</strong>
            <span>ApplyLite does not need a cloud account. The scheduler runs inside the local API. If the app was closed at the scheduled time, it catches up the next time you start ApplyLite after that time. A manual Run now counts as today's run so it will not duplicate work later the same day.</span>
          </div>
        </section>

        <section className="panel daily-health">
          <div className="panel-title">
            <div><span className="eyebrow">SCHEDULER STATUS</span><h2>Local automation health</h2></div>
          </div>
          <div className="daily-health-list">
            <div><span>Local API time</span><strong>{status ? `${status.localDate} ${status.localTime}` : "—"}</strong></div>
            <div><span>Last started</span><strong>{prettyTime(status?.settings.lastStartedAt ?? null)}</strong></div>
            <div><span>Last completed</span><strong>{prettyTime(status?.settings.lastCompletedAt ?? null)}</strong></div>
            <div><span>Last run date</span><strong>{status?.settings.lastRunDate ?? "—"}</strong></div>
          </div>
          {status?.settings.lastError && <div className="daily-error"><strong>Last scheduler error</strong><span>{status.settings.lastError}</span></div>}
        </section>
      </div>

      <section className="panel">
        <div className="panel-title">
          <div><span className="eyebrow">LATEST DAILY BRIEF</span><h2>{latest ? `${latest.runDate} · ${latest.shortlistCount} matches` : "No daily brief yet"}</h2></div>
          {latest && <span className={`daily-run-pill ${latest.status.toLowerCase()}`}>{latest.status.toLowerCase()}</span>}
        </div>

        {!latest && <div className="empty"><strong>Your first brief is waiting.</strong><span>Enable the schedule or run discovery now.</span></div>}
        {latest && latest.status === "FAILED" && <div className="alert">{latest.errorMessage ?? "The latest daily discovery failed."}</div>}
        {latest && latest.items.length === 0 && latest.status === "COMPLETED" && (
          <div className="empty"><strong>No fresh matches cleared today's threshold.</strong><span>ApplyLite did not recycle jobs that already appeared in an earlier Daily Brief or already have an application.</span></div>
        )}

        {latest && latest.items.length > 0 && (
          <div className="daily-match-list">
            {latest.items.map((item) => (
              <article key={item.id} className={`daily-match-card ${item.status.toLowerCase()}`}>
                <div className={`score ${scoreTone(item.score)}`}>{Math.round(item.score)}</div>
                <div className="daily-match-main">
                  <div className="daily-rank-row">
                    <span className="daily-rank">#{item.rank}</span>
                    <span className="state-pill">{item.ats}</span>
                    <span className={`daily-item-status ${item.status.toLowerCase()}`}>{item.status.toLowerCase()}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.company}{item.location ? ` · ${item.location}` : ""}</p>
                  <div className="daily-score-line">
                    <span>Base fit {Math.round(item.baseScore)}%</span>
                    {(item.outcomeAdjustment !== 0) && <span>Outcome {item.outcomeAdjustment > 0 ? "+" : ""}{item.outcomeAdjustment}</span>}
                    <span>Ranked fit {Math.round(item.score)}%</span>
                  </div>
                  {item.reasons.length > 0 && <ul className="daily-reasons">{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                  {item.matchedRequiredSkills.length > 0 && (
                    <div className="daily-skill-row"><strong>Required matched</strong><div className="chips">{item.matchedRequiredSkills.slice(0, 7).map((skill) => <span key={skill}>{skill}</span>)}</div></div>
                  )}
                  {item.missingRequiredSkills.length > 0 && (
                    <div className="daily-skill-row"><strong>Still unverified</strong><div className="chips danger">{item.missingRequiredSkills.slice(0, 7).map((skill) => <span key={skill}>{skill}</span>)}</div></div>
                  )}
                </div>
                <div className="daily-match-actions">
                  {item.sourceUrl && <a className="daily-source-button" href={item.sourceUrl} target="_blank" rel="noreferrer">Open job ↗</a>}
                  <button className="primary" onClick={() => prepareItem(item)}>Prepare application</button>
                  {item.status !== "REVIEWED" && <button onClick={() => setItemStatus(item, "REVIEWED")}>Mark reviewed</button>}
                  {item.status !== "DISMISSED" && <button onClick={() => setItemStatus(item, "DISMISSED")}>Dismiss</button>}
                  {item.status !== "NEW" && <button onClick={() => setItemStatus(item, "NEW")}>Undo</button>}
                </div>
              </article>
            ))}
          </div>
        )}

        {latest && latest.errors.length > 0 && (
          <details className="discovery-errors"><summary>{latest.errors.length} source/analysis warnings</summary><ul>{latest.errors.map((entry) => <li key={entry}>{entry}</li>)}</ul></details>
        )}
      </section>

      <section className="panel">
        <div className="panel-title"><div><span className="eyebrow">RECENT RUNS</span><h2>Daily discovery history</h2></div></div>
        <div className="daily-history">
          {history.length === 0 && <span className="muted">No runs yet.</span>}
          {history.map((brief) => (
            <div key={brief.id}>
              <strong>{brief.runDate}</strong>
              <span>{brief.trigger}</span>
              <span>{brief.status.toLowerCase()}</span>
              <span>{brief.jobsSeen} seen · {brief.jobsAnalyzed} analysed · {brief.jobsImported} new · {brief.shortlistCount} shortlisted</span>
              <span>{formatSeconds(brief.durationMs)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
