import { useEffect, useMemo, useState } from "react";
import { API_BASE, api } from "../lib/api";

type Check = {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  meta?: Record<string, unknown>;
};

type Doctor = {
  version: string;
  schemaVersion: number;
  overall: "pass" | "warn" | "fail";
  failed: number;
  warnings: number;
  checkedAt: string;
  checks: Check[];
};

type Backup = { name: string; sizeBytes: number; createdAt: string; kind: string };

type Diagnostics = {
  generatedAt: string;
  discoveryRuns: Array<Record<string, unknown>>;
  dailyBriefs: Array<Record<string, unknown>>;
  prepRuns: Array<Record<string, unknown>>;
  gmailRuns: Array<Record<string, unknown>>;
  maintenance: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value > 20 * 1024 * 1024 ? 0 : 1)} MB`;
}

function when(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function duration(value: unknown) {
  const ms = Number(value ?? 0);
  if (!ms) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function SystemPage() {
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resetText, setResetText] = useState("");

  async function load() {
    setError("");
    try {
      const [nextDoctor, nextBackups, nextDiagnostics] = await Promise.all([
        api<Doctor>("/system/doctor"),
        api<Backup[]>("/system/backups"),
        api<Diagnostics>("/system/diagnostics")
      ]);
      setDoctor(nextDoctor);
      setBackups(nextBackups);
      setDiagnostics(nextDiagnostics);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  useEffect(() => { void load(); }, []);

  async function createBackup() {
    setBusy("backup"); setMessage(""); setError("");
    try {
      const result = await api<Backup>("/system/backups", { method: "POST", body: JSON.stringify({ label: "manual" }) });
      setMessage(`Backup created: ${result.name}`);
      await load();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(""); }
  }

  async function restoreBackup(name: string) {
    const confirmed = window.confirm(`Stage restore from ${name}?\n\nApplyLite will not replace the live database until you restart the app.`);
    if (!confirmed) return;
    setBusy(`restore:${name}`); setMessage(""); setError("");
    try {
      await api(`/system/backups/${encodeURIComponent(name)}/restore`, { method: "POST" });
      setMessage("Restore staged successfully. Stop ApplyLite with Ctrl+C and start it again to apply the backup. A safety copy of your current data will be kept automatically.");
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(""); }
  }

  async function exportHistory(format: "json" | "csv") {
    setBusy(`export:${format}`); setMessage(""); setError("");
    try {
      const result = await api<{ name: string; rows: number }>(`/system/export/${format}`, { method: "POST" });
      setMessage(`${format.toUpperCase()} export created with ${result.rows} application record(s).`);
      window.open(`${API_BASE}/system/exports/${encodeURIComponent(result.name)}/download`, "_blank", "noopener,noreferrer");
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(""); }
  }

  async function resetData() {
    if (resetText !== "RESET APPLYLITE") return;
    const confirmed = window.confirm("This deletes local CV/profile/job/application/generated-package data after first creating a backup. Continue?");
    if (!confirmed) return;
    setBusy("reset"); setMessage(""); setError("");
    try {
      const result = await api<{ backup: string }>("/system/reset", { method: "POST", body: JSON.stringify({ confirmation: resetText }) });
      setMessage(`Local data reset. Safety backup: ${result.backup}`);
      setResetText("");
      await load();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(""); }
  }

  const summary = useMemo(() => {
    if (!doctor) return "Checking local services…";
    if (doctor.overall === "pass") return "All essential local systems passed.";
    if (doctor.overall === "warn") return `${doctor.warnings} item(s) need attention, but no hard failure was detected.`;
    return `${doctor.failed} essential check(s) failed.`;
  }, [doctor]);

  return (
    <section className="system-page">
      <header className="page-header system-header">
        <div>
          <span className="eyebrow">M9 · Production hardening</span>
          <h1>System & Recovery</h1>
          <p>Doctor checks, backups, crash recovery, exports and run diagnostics for your local ApplyLite data.</p>
        </div>
        <button onClick={() => void load()} disabled={Boolean(busy)}>Run doctor again</button>
      </header>

      {error && <div className="system-banner fail">{error}</div>}
      {message && <div className="system-banner pass">{message}</div>}

      <div className={`system-overview ${doctor?.overall ?? "warn"}`}>
        <div>
          <span>System status</span>
          <strong>{doctor?.overall.toUpperCase() ?? "CHECKING"}</strong>
          <p>{summary}</p>
        </div>
        <div className="system-version">
          <span>ApplyLite</span><strong>{doctor?.version ?? "—"}</strong>
          <span>Schema</span><strong>v{doctor?.schemaVersion ?? "—"}</strong>
        </div>
      </div>

      <div className="system-checks">
        {(doctor?.checks ?? []).map((check) => (
          <article key={check.key} className={`system-check ${check.status}`}>
            <div className="system-check-icon">{check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "×"}</div>
            <div><strong>{check.label}</strong><span>{check.detail}</span></div>
          </article>
        ))}
      </div>

      <div className="system-grid">
        <section className="panel system-panel">
          <div className="panel-heading"><div><span className="eyebrow">Data protection</span><h2>Backups & restore</h2></div><button onClick={() => void createBackup()} disabled={Boolean(busy)}>{busy === "backup" ? "Creating…" : "Create backup now"}</button></div>
          <p className="muted-copy">A backup contains the SQLite database plus generated files under local storage. Your .env and secrets are deliberately excluded.</p>
          <div className="backup-list">
            {backups.length === 0 && <div className="empty-state compact">No M9 backup archive yet.</div>}
            {backups.slice(0, 8).map((backup) => (
              <article key={backup.name}>
                <div><strong>{backup.name}</strong><span>{when(backup.createdAt)} · {formatBytes(backup.sizeBytes)}</span></div>
                <div className="row-actions">
                  <a className="button-link" href={`${API_BASE}/system/backups/${encodeURIComponent(backup.name)}/download`} target="_blank" rel="noreferrer">Download</a>
                  <button className="secondary" onClick={() => void restoreBackup(backup.name)} disabled={Boolean(busy)}>{busy === `restore:${backup.name}` ? "Staging…" : "Restore"}</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel system-panel">
          <div className="panel-heading"><div><span className="eyebrow">Portable history</span><h2>Export applications</h2></div></div>
          <p className="muted-copy">Export the application tracker independently of the internal database.</p>
          <div className="system-export-actions">
            <button onClick={() => void exportHistory("csv")} disabled={Boolean(busy)}>Export CSV</button>
            <button className="secondary" onClick={() => void exportHistory("json")} disabled={Boolean(busy)}>Export JSON + timeline</button>
          </div>
          <div className="system-recovery-note"><strong>Restore safety</strong><span>A restore is staged first. It only takes effect after restart, and M9 saves the current database/storage into <code>backups/recovery</code> before replacing anything.</span></div>
        </section>
      </div>

      <section className="panel system-panel diagnostics-panel">
        <div className="panel-heading"><div><span className="eyebrow">Operational evidence</span><h2>Recent autonomous runs</h2></div></div>
        <div className="diagnostics-grid">
          <div>
            <h3>M6 discovery</h3>
            {(diagnostics?.discoveryRuns ?? []).slice(0, 6).map((row) => (
              <article className="diagnostic-row" key={String(row.id)}>
                <div><strong>Run #{String(row.id)}</strong><span>{when(row.startedAt)} · {String(row.status)}</span></div>
                <div><b>{String(row.jobsSeen ?? 0)} seen</b><b>{String(row.jobsAnalyzed ?? 0)} AI</b><b>{String(row.cacheHits ?? 0)} cache</b><b>{duration(row.durationMs)}</b></div>
              </article>
            ))}
            {(diagnostics?.discoveryRuns ?? []).length === 0 && <span className="muted-copy">No discovery runs yet.</span>}
          </div>
          <div>
            <h3>M7 preparation</h3>
            {(diagnostics?.prepRuns ?? []).slice(0, 6).map((row) => (
              <article className={`diagnostic-row ${String(row.status).toLowerCase()}`} key={String(row.id)}>
                <div><strong>{String(row.title)}</strong><span>{String(row.company)} · {String(row.status)}</span></div>
                <div><b>fit {String(row.score ?? 0)}%</b><b>{row.completedAt ? duration(new Date(String(row.completedAt)).getTime() - new Date(String(row.startedAt ?? row.queuedAt)).getTime()) : "pending"}</b></div>
                {Boolean(row.errorMessage) && <small>{String(row.errorMessage)}</small>}
              </article>
            ))}
            {(diagnostics?.prepRuns ?? []).length === 0 && <span className="muted-copy">No preparation runs yet.</span>}
          </div>
          <div>
            <h3>M10 Gmail sync</h3>
            {(diagnostics?.gmailRuns ?? []).slice(0, 6).map((row) => (
              <article className={`diagnostic-row ${String(row.status).toLowerCase()}`} key={String(row.id)}>
                <div><strong>Sync #{String(row.id)}</strong><span>{when(row.startedAt)} · {String(row.status)} · {String(row.trigger)}</span></div>
                <div><b>{String(row.messagesSeen ?? 0)} seen</b><b>{String(row.relevantMessages ?? 0)} relevant</b><b>{String(row.matchedMessages ?? 0)} matched</b><b>{duration(row.durationMs)}</b></div>
                {Boolean(row.errorMessage) && <small>{String(row.errorMessage)}</small>}
              </article>
            ))}
            {(diagnostics?.gmailRuns ?? []).length === 0 && <span className="muted-copy">No Gmail sync runs yet.</span>}
          </div>
        </div>
      </section>

      <section className="panel system-panel">
        <div className="panel-heading"><div><span className="eyebrow">Coverage</span><h2>Discovery source health</h2></div></div>
        <div className="source-health-list">
          {(diagnostics?.sources ?? []).map((row) => (
            <article key={String(row.id)} className={row.lastError ? "warn" : Number(row.enabled) ? "pass" : "disabled"}>
              <div><strong>{String(row.name)}</strong><span>{String(row.ats)} · {Number(row.enabled) ? "enabled" : "disabled"}</span></div>
              <div><b>{row.lastScanAt ? `last scan ${when(row.lastScanAt)}` : "not scanned yet"}</b>{Boolean(row.lastError) && <small>{String(row.lastError)}</small>}</div>
            </article>
          ))}
          {(diagnostics?.sources ?? []).length === 0 && <span className="muted-copy">No discovery sources are configured.</span>}
        </div>
      </section>

      <section className="panel system-panel">
        <div className="panel-heading"><div><span className="eyebrow">Recovery log</span><h2>Maintenance events</h2></div></div>
        <div className="maintenance-list">
          {(diagnostics?.maintenance ?? []).slice(0, 12).map((row) => (
            <article key={String(row.id)}><span className={`status-dot ${String(row.status).toLowerCase()}`}></span><div><strong>{String(row.kind)} · {String(row.status)}</strong><span>{String(row.message)} · {when(row.createdAt)}</span></div></article>
          ))}
          {(diagnostics?.maintenance ?? []).length === 0 && <span className="muted-copy">No maintenance events have been recorded yet.</span>}
        </div>
      </section>

      <section className="panel system-panel danger-zone">
        <div><span className="eyebrow">Danger zone</span><h2>Reset local user data</h2><p>ApplyLite automatically creates a backup before deleting CV/profile/jobs/applications/packages. Discovery source definitions and the app installation remain.</p></div>
        <label>Type <strong>RESET APPLYLITE</strong> to unlock reset<input value={resetText} onChange={(event) => setResetText(event.target.value)} placeholder="RESET APPLYLITE" /></label>
        <button className="danger-button" onClick={() => void resetData()} disabled={resetText !== "RESET APPLYLITE" || Boolean(busy)}>{busy === "reset" ? "Backing up and resetting…" : "Backup then reset local data"}</button>
      </section>
    </section>
  );
}
