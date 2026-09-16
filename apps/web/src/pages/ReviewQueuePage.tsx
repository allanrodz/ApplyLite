import { useEffect, useMemo, useState } from "react";
import type {
  ApplicationPrepSettings,
  ApplicationPrepStatus,
  BrowserSessionResult,
  DailyDiscoveryStatus,
  PreparedApplicationItem
} from "@apply-lite/shared";
import { API_BASE, api } from "../lib/api";

function statusLabel(status: PreparedApplicationItem["status"]) {
  return status.replaceAll("_", " ").toLowerCase();
}

function prettyTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ReviewQueuePage() {
  const [status, setStatus] = useState<ApplicationPrepStatus | null>(null);
  const [items, setItems] = useState<PreparedApplicationItem[]>([]);
  const [settings, setSettings] = useState<ApplicationPrepSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const [nextStatus, nextItems] = await Promise.all([
      api<ApplicationPrepStatus>("/application-prep/status"),
      api<PreparedApplicationItem[]>("/application-prep/queue?limit=60")
    ]);
    setStatus(nextStatus);
    setItems(nextItems);
    setSettings((current) => current ?? nextStatus.settings);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Could not load review queue"));
    const timer = window.setInterval(() => refresh().catch(() => undefined), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const actionable = useMemo(
    () => items.filter((item) => item.status === "READY" || item.status === "NEEDS_REVIEW"),
    [items]
  );

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await api<ApplicationPrepSettings>("/application-prep/settings", {
        method: "PUT",
        body: JSON.stringify(settings)
      });
      setSettings(saved);
      setMessage(saved.enabled
        ? `Autonomous preparation enabled: up to ${saved.maxPackagesPerBrief} package(s) per Daily Brief at ${saved.minScore}%+.`
        : "Preparation settings saved. Automatic package generation is disabled.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save M7 settings");
    } finally {
      setSaving(false);
    }
  }

  async function queueLatestBrief() {
    setError("");
    setMessage("");
    try {
      const daily = await api<DailyDiscoveryStatus>("/daily-discovery/status");
      if (!daily.latestBrief) {
        setError("There is no Daily Brief yet. Run M6 discovery first.");
        return;
      }
      const result = await api<{ queued: number; skipped: number }>(`/application-prep/briefs/${daily.latestBrief.id}/queue`, {
        method: "POST",
        body: "{}"
      });
      setMessage(`Queued ${result.queued} application package(s) from the latest brief${result.skipped ? `; ${result.skipped} already existed or were not eligible` : ""}.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue the latest brief");
    }
  }

  async function retry(item: PreparedApplicationItem) {
    setBusyId(item.id);
    setError("");
    try {
      await api(`/application-prep/items/${item.id}/retry`, { method: "POST", body: "{}" });
      setMessage(`${item.title} re-queued for package generation.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not retry preparation");
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(item: PreparedApplicationItem) {
    if (!window.confirm(`Remove ${item.title} at ${item.company} from the M7 review queue? This does not delete the job or generated files.`)) return;
    setBusyId(item.id);
    setError("");
    try {
      await api(`/application-prep/items/${item.id}/dismiss`, { method: "POST", body: "{}" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dismiss preparation item");
    } finally {
      setBusyId(null);
    }
  }

  async function openApplication(item: PreparedApplicationItem) {
    if (!item.applicationId) return;
    setBusyId(item.id);
    setError("");
    setMessage("Opening the employer form in visible Chromium. Final Submit remains manual.");
    try {
      const result = await api<BrowserSessionResult & { state: string }>(`/applications/${item.applicationId}/browser/start`, {
        method: "POST",
        body: "{}"
      });
      setMessage(result.message || "Employer application opened. Review the Chromium window before submitting anything.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the employer application");
    } finally {
      setBusyId(null);
    }
  }

  if (!settings) return <section className="panel"><p className="muted">Loading M7 review queue...</p></section>;

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">M7 AUTONOMOUS APPLICATION PREPARATION</span>
          <h1>Applications ready for review</h1>
          <p>Turn the strongest Daily Brief matches into evidence-audited CV and cover-letter packages in the background. Employer forms never open automatically.</p>
        </div>
        <button className="primary" onClick={queueLatestBrief}>Prepare latest Daily Brief</button>
      </header>

      {error && <div className="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <section className="stats-grid prep-stats">
        <article><span>Ready to review</span><strong>{(status?.counts.ready ?? 0) + (status?.counts.needsReview ?? 0)}</strong></article>
        <article><span>Generating</span><strong>{status?.counts.generating ?? 0}</strong></article>
        <article><span>Queued</span><strong>{status?.counts.queued ?? 0}</strong></article>
        <article><span>Failed</span><strong>{status?.counts.failed ?? 0}</strong></article>
      </section>

      <div className="daily-layout">
        <section className="panel">
          <div className="panel-title">
            <div><span className="eyebrow">AUTONOMY SETTINGS</span><h2>How much should M7 prepare?</h2></div>
          </div>
          <form onSubmit={saveSettings}>
            <div className="form-grid">
              <label className="daily-enable full">
                <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />
                <span>After each M6 Daily Brief, automatically queue the strongest matches for package generation</span>
              </label>
              <label>Packages per brief
                <input type="number" min="1" max="5" value={settings.maxPackagesPerBrief} onChange={(e) => setSettings({ ...settings, maxPackagesPerBrief: Number(e.target.value) })} />
              </label>
              <label>Minimum ranked fit
                <input type="number" min="0" max="100" value={settings.minScore} onChange={(e) => setSettings({ ...settings, minScore: Number(e.target.value) })} />
              </label>
            </div>
            <div className="actions"><button className="primary" disabled={saving}>{saving ? "Saving..." : "Save M7 settings"}</button></div>
          </form>
          <div className="daily-scheduler-note">
            <strong>Bounded background work</strong>
            <span>M7 generates one package at a time so local Qwen/Ollama is not overloaded. A REVIEW audit stays in the queue as Needs review. M7 never opens a browser, answers sensitive questions, or submits an application automatically.</span>
          </div>
        </section>

        <section className="panel daily-health">
          <div className="panel-title"><div><span className="eyebrow">WORKER STATUS</span><h2>Preparation engine</h2></div></div>
          <div className="daily-health-list">
            <div><span>Worker</span><strong>{status?.running ? "Running" : "Idle"}</strong></div>
            <div><span>Automatic prep</span><strong>{settings.enabled ? "ON" : "OFF"}</strong></div>
            <div><span>Threshold</span><strong>{settings.minScore}%+</strong></div>
            <div><span>Daily cap</span><strong>{settings.maxPackagesPerBrief}</strong></div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-title">
          <div><span className="eyebrow">REVIEW QUEUE</span><h2>{actionable.length} application package(s) ready for you</h2></div>
          <span className="muted">Queued and generating items refresh automatically.</span>
        </div>

        {items.length === 0 && (
          <div className="empty"><strong>No applications prepared yet.</strong><span>Enable M7 for future Daily Briefs or use Prepare latest Daily Brief.</span></div>
        )}

        <div className="prep-queue-list">
          {items.filter((item) => item.status !== "DISMISSED").map((item) => (
            <article className={`prep-card ${item.status.toLowerCase()}`} key={item.id}>
              <div className="prep-score"><strong>{Math.round(item.score)}</strong><span>fit</span></div>
              <div className="prep-main">
                <div className="prep-title-row">
                  <div>
                    <span className="eyebrow">{item.source === "daily" ? "DAILY BRIEF" : "MANUAL PREP"}</span>
                    <h3>{item.title}</h3>
                    <p>{item.company}{item.location ? ` · ${item.location}` : ""}</p>
                  </div>
                  <span className={`prep-status ${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span>
                </div>

                {item.status === "GENERATING" && <p className="muted">Qwen is selecting evidence, drafting the package, and running the factual audit. This can take several minutes.</p>}
                {item.status === "QUEUED" && <p className="muted">Waiting for the local package worker. Packages are generated sequentially.</p>}
                {item.errorMessage && <div className="alert">{item.errorMessage}</div>}

                {item.package && (
                  <div className="prep-package-preview">
                    <div className="audit-summary">
                      <div><span>Audit</span><strong>{item.package.status}</strong></div>
                      <div><span>Claims</span><strong>{item.package.audit.checkedClaims}</strong></div>
                      <div><span>Supported</span><strong>{item.package.audit.supportedClaims}</strong></div>
                      <div><span>Flagged</span><strong>{item.package.audit.flaggedClaims.length}</strong></div>
                    </div>
                    <div className="document-preview">
                      <strong>{item.package.tailoredCv.headline}</strong>
                      <p>{item.package.tailoredCv.summary}</p>
                    </div>
                    {item.package.coverLetter.paragraphs[0]?.text && (
                      <div className="document-preview"><strong>Cover letter opening</strong><p>{item.package.coverLetter.paragraphs[0].text}</p></div>
                    )}
                    {item.package.audit.warnings.length > 0 && (
                      <ul className="package-warnings">{item.package.audit.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                    )}
                    <div className="artifact-list">
                      {item.package.artifacts.map((artifact) => <a key={artifact.id} href={`${API_BASE}${artifact.downloadUrl}`}>{artifact.filename}</a>)}
                    </div>
                  </div>
                )}

                <small className="muted">Queued {prettyTime(item.queuedAt)}{item.completedAt ? ` · completed ${prettyTime(item.completedAt)}` : ""}</small>
              </div>

              <div className="prep-actions">
                {item.sourceUrl && <a className="daily-source-button" href={item.sourceUrl} target="_blank" rel="noreferrer">Original job ↗</a>}
                {(item.status === "READY" || item.status === "NEEDS_REVIEW") && item.applicationId && (
                  <button className="primary" onClick={() => openApplication(item)} disabled={busyId === item.id}>
                    {busyId === item.id ? "Opening..." : "Review & open application"}
                  </button>
                )}
                {item.status === "FAILED" && <button onClick={() => retry(item)} disabled={busyId === item.id}>Retry generation</button>}
                {item.status !== "GENERATING" && <button onClick={() => dismiss(item)} disabled={busyId === item.id}>Dismiss</button>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
