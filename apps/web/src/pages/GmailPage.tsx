import { useEffect, useMemo, useState } from "react";
import type { GmailMessage, GmailOverview } from "@apply-lite/shared";
import { api } from "../lib/api";

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
  const parsed = new Date(sqliteUtc ? `${value.replace(" ", "T")}Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: string | null | undefined) {
  const date = parseTimestamp(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function label(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function actionCopy(message: GmailMessage) {
  if (message.suggestedOutcome) return `Update application → ${label(message.suggestedOutcome)}`;
  if (message.classification === "ASSESSMENT") return "Record assessment request";
  if (message.classification === "RECRUITER_REPLY") return "Record recruiter response";
  return "Record in timeline";
}

export function GmailPage() {
  const [overview, setOverview] = useState<GmailOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [lookbackDays, setLookbackDays] = useState(30);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  async function refresh() {
    const value = await api<GmailOverview>("/gmail/overview");
    setOverview(value);
    setSyncEnabled(value.settings.syncEnabled);
    setIntervalMinutes(value.settings.intervalMinutes);
    setLookbackDays(value.settings.lookbackDays);
    return value;
  }

  useEffect(() => { refresh().catch((e) => setError(e.message)); }, []);

  const visibleMessages = useMemo(() => {
    const messages = overview?.messages ?? [];
    return filter === "pending" ? messages.filter((message) => message.actionStatus === "PENDING") : messages;
  }, [overview, filter]);

  async function importCredentials(file: File | undefined) {
    if (!file) return;
    setLoading(true); setError(""); setNotice("");
    try {
      const credentials = JSON.parse(await file.text()) as unknown;
      await api("/gmail/oauth/config", { method: "POST", body: JSON.stringify({ credentials }) });
      await refresh();
      setNotice("Google OAuth client imported locally. You can now connect Gmail.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not import OAuth JSON"); }
    finally { setLoading(false); }
  }

  async function connect() {
    setLoading(true); setError(""); setNotice("");
    const popup = window.open("about:blank", "applylite-gmail-oauth");
    try {
      const result = await api<{ authUrl: string }>("/gmail/oauth/start", { method: "POST", body: "{}" });
      if (popup) popup.location.href = result.authUrl;
      else window.open(result.authUrl, "_blank", "noopener,noreferrer");
      setNotice("Google authorization opened in a new tab. After approving, return here; ApplyLite will detect the connection.");
      let attempts = 0;
      const timer = window.setInterval(async () => {
        attempts += 1;
        try {
          const value = await refresh();
          if (value.settings.connected || attempts >= 30) window.clearInterval(timer);
        } catch {
          if (attempts >= 30) window.clearInterval(timer);
        }
      }, 2000);
    } catch (e) {
      popup?.close();
      setError(e instanceof Error ? e.message : "Could not start Gmail OAuth");
    } finally { setLoading(false); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Gmail? Cached career messages stay local, but ApplyLite will stop reading new Gmail messages.")) return;
    setLoading(true); setError(""); setNotice("");
    try {
      await api("/gmail/disconnect", { method: "POST", body: "{}" });
      await refresh();
      setNotice("Gmail disconnected. OAuth client configuration is still available for reconnecting.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not disconnect Gmail"); }
    finally { setLoading(false); }
  }

  async function removeConfig() {
    if (!window.confirm("Remove the local Google OAuth client configuration and disconnect Gmail?")) return;
    setLoading(true); setError(""); setNotice("");
    try {
      await api("/gmail/oauth/config", { method: "DELETE" });
      await refresh();
      setNotice("Google OAuth configuration removed from this computer.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not remove OAuth configuration"); }
    finally { setLoading(false); }
  }

  async function saveSettings() {
    setLoading(true); setError(""); setNotice("");
    try {
      await api("/gmail/settings", {
        method: "PUT",
        body: JSON.stringify({ syncEnabled, intervalMinutes, lookbackDays })
      });
      await refresh();
      setNotice("Gmail sync settings saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save Gmail settings"); }
    finally { setLoading(false); }
  }

  async function syncNow() {
    setLoading(true); setError(""); setNotice("Syncing relevant Gmail messages locally…");
    try {
      const value = await api<GmailOverview>("/gmail/sync", { method: "POST", body: "{}" });
      setOverview(value);
      setNotice(`Gmail sync complete. ${value.counts.pending} message${value.counts.pending === 1 ? "" : "s"} need review.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Gmail sync failed"); setNotice(""); }
    finally { setLoading(false); }
  }

  async function matchMessage(message: GmailMessage, applicationId: number | null) {
    setLoading(true); setError(""); setNotice("");
    try {
      const value = await api<GmailOverview>(`/gmail/messages/${encodeURIComponent(message.gmailId)}/match`, {
        method: "PUT",
        body: JSON.stringify({ applicationId })
      });
      setOverview(value);
      setNotice(applicationId ? "Email matched to application." : "Application match cleared.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update email match"); }
    finally { setLoading(false); }
  }

  async function confirmMessage(message: GmailMessage) {
    if (!message.applicationId) { setError("Match this email to an application before confirming it."); return; }
    const text = message.suggestedOutcome
      ? `${actionCopy(message)}? This will update the tracker only after you confirm.`
      : `${actionCopy(message)} for ${message.applicationCompany ?? "this application"}?`;
    if (!window.confirm(text)) return;
    setLoading(true); setError(""); setNotice("");
    try {
      const value = await api<GmailOverview>(`/gmail/messages/${encodeURIComponent(message.gmailId)}/confirm`, { method: "POST", body: "{}" });
      setOverview(value);
      setNotice("Employer email confirmed and recorded in the application timeline.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not confirm email action"); }
    finally { setLoading(false); }
  }

  async function ignoreMessage(message: GmailMessage) {
    setLoading(true); setError(""); setNotice("");
    try {
      const value = await api<GmailOverview>(`/gmail/messages/${encodeURIComponent(message.gmailId)}/ignore`, { method: "POST", body: "{}" });
      setOverview(value);
      setNotice("Email ignored for tracker updates.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not ignore email"); }
    finally { setLoading(false); }
  }

  async function draftReply(message: GmailMessage) {
    const popup = window.open("about:blank", "_blank");
    try {
      const value = await api<{ composeUrl: string }>(`/gmail/messages/${encodeURIComponent(message.gmailId)}/reply-draft`);
      if (popup) popup.location.href = value.composeUrl;
      else window.open(value.composeUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      popup?.close();
      setError(e instanceof Error ? e.message : "Could not prepare Gmail reply");
    }
  }

  const settings = overview?.settings;

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">M10 EMAIL INTELLIGENCE</span>
          <h1>Gmail Intelligence</h1>
          <p>Read-only Gmail integration for recruiter responses, interviews, assessments, offers and rejections. ApplyLite proposes changes; you confirm every tracker update and every sent email.</p>
        </div>
        <button onClick={() => refresh().catch((e) => setError(e.message))} disabled={loading}>Refresh</button>
      </header>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <section className="panel gmail-connection-panel">
        <div className="panel-title">
          <div><span className="eyebrow">GOOGLE OAUTH</span><h2>Connection</h2></div>
          <span className={`gmail-status ${settings?.connected ? "connected" : "disconnected"}`}>{settings?.connected ? `Connected · ${settings.email}` : "Not connected"}</span>
        </div>

        {!settings?.oauthConfigured && (
          <div className="gmail-setup-box">
            <strong>1. Import your Google OAuth Desktop client JSON</strong>
            <p className="muted">The client ID and secret are stored only in <code>.secrets</code> on this computer and are excluded from ApplyLite backups.</p>
            <label className="file-button">Choose OAuth JSON<input type="file" accept="application/json,.json" onChange={(event) => importCredentials(event.target.files?.[0])} disabled={loading} /></label>
          </div>
        )}

        {settings?.oauthConfigured && !settings.connected && (
          <div className="gmail-actions-row">
            <div><strong>OAuth client configured</strong><span className="muted">Authorize read-only Gmail access in your browser.</span></div>
            <button className="primary" onClick={connect} disabled={loading}>Connect Gmail</button>
            <button onClick={removeConfig} disabled={loading}>Remove OAuth config</button>
          </div>
        )}

        {settings?.connected && (
          <>
            <div className="gmail-actions-row">
              <div><strong>{settings.email}</strong><span className="muted">Scope: gmail.readonly · ApplyLite cannot send, delete or modify your mail.</span></div>
              <button className="primary" onClick={syncNow} disabled={loading || settings.syncing}>{settings.syncing ? "Syncing…" : "Sync now"}</button>
              <button onClick={disconnect} disabled={loading}>Disconnect</button>
            </div>
            <div className="gmail-settings-grid">
              <label><span>Background sync</span><select value={syncEnabled ? "on" : "off"} onChange={(event) => setSyncEnabled(event.target.value === "on")}><option value="on">On</option><option value="off">Off</option></select></label>
              <label><span>Check every</span><select value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}>{[5, 10, 15, 30, 60, 120].map((value) => <option value={value} key={value}>{value} min</option>)}</select></label>
              <label><span>First-sync lookback</span><select value={lookbackDays} onChange={(event) => setLookbackDays(Number(event.target.value))}>{[7, 14, 30, 60, 90].map((value) => <option value={value} key={value}>{value} days</option>)}</select></label>
              <button onClick={saveSettings} disabled={loading}>Save settings</button>
            </div>
            <p className="muted gmail-last-sync">Last sync: {formatDate(settings.lastSyncAt)}{settings.lastError ? ` · Last error: ${settings.lastError}` : ""}</p>
          </>
        )}
      </section>

      {overview && (
        <section className="gmail-metrics">
          <div><span>Needs review</span><strong>{overview.counts.pending}</strong></div>
          <div><span>Interviews</span><strong>{overview.counts.interviews}</strong></div>
          <div><span>Assessments</span><strong>{overview.counts.assessments}</strong></div>
          <div><span>Offers</span><strong>{overview.counts.offers}</strong></div>
          <div><span>Rejections</span><strong>{overview.counts.rejections}</strong></div>
          <div><span>Unmatched</span><strong>{overview.counts.unmatched}</strong></div>
        </section>
      )}

      <section className="panel">
        <div className="panel-title">
          <div><span className="eyebrow">INBOX INTELLIGENCE</span><h2>Career messages</h2></div>
          <div className="gmail-filter"><button className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>Needs review</button><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All relevant</button></div>
        </div>

        <div className="gmail-message-list">
          {visibleMessages.map((message) => (
            <article className={`gmail-message ${message.actionStatus.toLowerCase()}`} key={message.gmailId}>
              <div className="gmail-message-top">
                <div><span className={`gmail-type ${message.classification.toLowerCase()}`}>{label(message.classification)}</span><span className="gmail-confidence">{Math.round(message.classificationConfidence * 100)}%</span></div>
                <span>{formatDate(message.receivedAt)}</span>
              </div>
              <h3>{message.subject || "(No subject)"}</h3>
              <p className="gmail-from">{message.fromName || message.fromEmail}{message.fromName && message.fromEmail ? ` <${message.fromEmail}>` : ""}</p>
              <p>{message.summary || message.snippet}</p>

              {(message.details.interviewDate || message.details.interviewTime || message.details.meetingLink || message.details.assessmentDeadline || message.details.assessmentPlatform) && (
                <div className="gmail-details">
                  {message.details.interviewDate && <span><b>Date</b>{message.details.interviewDate}</span>}
                  {message.details.interviewTime && <span><b>Time</b>{message.details.interviewTime}{message.details.timezone ? ` ${message.details.timezone}` : ""}</span>}
                  {message.details.assessmentDeadline && <span><b>Deadline</b>{message.details.assessmentDeadline}</span>}
                  {message.details.assessmentPlatform && <span><b>Platform</b>{message.details.assessmentPlatform}</span>}
                  {message.details.meetingLink && <a href={message.details.meetingLink} target="_blank" rel="noreferrer">Meeting link ↗</a>}
                </div>
              )}

              <div className="gmail-match-row">
                <label><span>Application match</span><select value={message.applicationId ?? ""} onChange={(event) => matchMessage(message, event.target.value ? Number(event.target.value) : null)} disabled={loading}>
                  <option value="">Unmatched</option>
                  {overview?.applications.map((application) => <option value={application.applicationId} key={application.applicationId}>{application.company} · {application.title}</option>)}
                </select></label>
                {message.applicationId && <span className="gmail-match-confidence">{Math.round(message.matchConfidence * 100)}% match</span>}
              </div>

              <div className="gmail-message-actions">
                <a href={message.gmailUrl} target="_blank" rel="noreferrer">Open in Gmail ↗</a>
                {message.classification !== "REJECTION" && <button onClick={() => draftReply(message)}>Draft reply in Gmail</button>}
                {message.actionStatus === "PENDING" && <button className="primary" onClick={() => confirmMessage(message)} disabled={loading || !message.applicationId}>{actionCopy(message)}</button>}
                {message.actionStatus === "PENDING" && <button onClick={() => ignoreMessage(message)} disabled={loading}>Ignore</button>}
                {message.actionStatus === "APPLIED" && <span className="gmail-action-state">Recorded</span>}
                {message.actionStatus === "IGNORED" && <span className="gmail-action-state">Ignored</span>}
                {message.actionStatus === "INFO" && <span className="gmail-action-state">Info only</span>}
              </div>
            </article>
          ))}
          {!visibleMessages.length && <div className="empty"><strong>{settings?.connected ? "No messages need attention" : "Connect Gmail to begin"}</strong><span>{settings?.connected ? "Relevant recruiter and hiring messages will appear here after sync." : "ApplyLite stores only career-related messages locally."}</span></div>}
        </div>
      </section>

      {overview && overview.recentRuns.length > 0 && (
        <section className="panel">
          <div className="panel-title"><div><span className="eyebrow">SYNC DIAGNOSTICS</span><h2>Recent Gmail runs</h2></div></div>
          <div className="gmail-runs">
            {overview.recentRuns.map((run) => <div key={run.id}><strong>{run.status}</strong><span>{run.trigger} · {formatDate(run.startedAt)}</span><small>{run.messagesSeen} seen · {run.relevantMessages} relevant · {run.newMessages} new · {run.matchedMessages} matched · {run.aiClassified} local-AI classified · {(run.durationMs / 1000).toFixed(1)}s</small>{run.errorMessage && <em>{run.errorMessage}</em>}</div>)}
          </div>
        </section>
      )}
    </>
  );
}
