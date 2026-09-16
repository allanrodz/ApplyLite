import { useEffect, useMemo, useState } from "react";
import type {
  ApplicationOutcome,
  ApplicationTrackerDetail,
  ApplicationTrackerItem,
  ApplicationTrackerOverview
} from "@apply-lite/shared";
import { api } from "../lib/api";

const pipeline: Array<{ stage: ApplicationTrackerItem["stage"]; title: string; hint: string }> = [
  { stage: "PREPARING", title: "Preparing", hint: "Approved, tailoring or review" },
  { stage: "APPLIED", title: "Applied", hint: "Submitted and waiting" },
  { stage: "INTERVIEW", title: "Interview", hint: "Employer conversation in progress" },
  { stage: "OFFER", title: "Offer", hint: "Offers received" },
  { stage: "CLOSED", title: "Closed", hint: "Rejected or withdrawn" }
];

const outcomeOptions: Array<{ value: ApplicationOutcome; label: string }> = [
  { value: "WAITING", label: "Waiting" },
  { value: "INTERVIEW", label: "Interview" },
  { value: "OFFER", label: "Offer" },
  { value: "REJECTED", label: "Rejected" },
  { value: "WITHDRAWN", label: "Withdrawn" }
];

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
  const parsed = new Date(sqliteUtc ? `${value.replace(" ", "T")}Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: string | null | undefined, withTime = false) {
  const date = parseTimestamp(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, withTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function toDateTimeLocal(value: string | null | undefined) {
  const date = parseTimestamp(value);
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function outcomeLabel(value: ApplicationOutcome) {
  if (value === "ACTIVE") return "In progress";
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function scoreValue(item: ApplicationTrackerItem) {
  return item.submittedScore ?? item.score;
}

function isOverdue(value: string | null, stage: ApplicationTrackerItem["stage"]) {
  const date = parseTimestamp(value);
  return Boolean(date && date.getTime() < Date.now() && stage !== "CLOSED" && stage !== "OFFER");
}

function TrackerCard({ item, onOpen }: { item: ApplicationTrackerItem; onOpen: () => void }) {
  return (
    <button className="tracker-card" onClick={onOpen}>
      <div className="tracker-card-top">
        <span className="tracker-score">{scoreValue(item)}%</span>
        <span className={`outcome-chip ${item.outcome.toLowerCase()}`}>{outcomeLabel(item.outcome)}</span>
      </div>
      <strong>{item.title}</strong>
      <span>{item.company}{item.location ? ` · ${item.location}` : ""}</span>
      {item.submittedAt && <small>Applied {formatDate(item.submittedAt)}</small>}
      {item.nextAction && (
        <div className={`tracker-next ${isOverdue(item.nextActionAt, item.stage) ? "overdue" : ""}`}>
          <b>Next:</b> {item.nextAction}
          {item.nextActionAt && <em>{formatDate(item.nextActionAt, true)}</em>}
        </div>
      )}
    </button>
  );
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <div><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function ApplicationsPage() {
  const [overview, setOverview] = useState<ApplicationTrackerOverview | null>(null);
  const [detail, setDetail] = useState<ApplicationTrackerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [notes, setNotes] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [timelineNote, setTimelineNote] = useState("");

  async function refreshOverview() {
    const value = await api<ApplicationTrackerOverview>("/tracker/overview");
    setOverview(value);
    return value;
  }

  async function loadDetail(id: number) {
    const value = await api<ApplicationTrackerDetail>(`/applications/${id}/tracker`);
    setDetail(value);
    setNextAction(value.item.nextAction);
    setNextActionAt(toDateTimeLocal(value.item.nextActionAt));
    setNotes(value.item.notes);
    return value;
  }

  async function refreshAll(id?: number) {
    await refreshOverview();
    if (id) await loadDetail(id);
  }

  useEffect(() => { refreshOverview().catch((e) => setError(e.message)); }, []);

  const grouped = useMemo(() => {
    const map = new Map<ApplicationTrackerItem["stage"], ApplicationTrackerItem[]>();
    for (const column of pipeline) map.set(column.stage, []);
    for (const item of overview?.items ?? []) map.get(item.stage)?.push(item);
    return map;
  }, [overview]);

  async function saveTracker() {
    if (!detail) return;
    setLoading(true); setError(""); setNotice("");
    try {
      await api(`/applications/${detail.item.id}/tracker`, {
        method: "PUT",
        body: JSON.stringify({ nextAction, nextActionAt: nextActionAt || null, notes })
      });
      await refreshAll(detail.item.id);
      setNotice("Application tracker updated.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update application tracker"); }
    finally { setLoading(false); }
  }

  async function changeOutcome(outcome: ApplicationOutcome) {
    if (!detail) return;
    setLoading(true); setError(""); setNotice("");
    try {
      await api(`/applications/${detail.item.id}/outcome`, {
        method: "POST",
        body: JSON.stringify({ outcome, note: outcomeNote })
      });
      setOutcomeNote("");
      await refreshAll(detail.item.id);
      setNotice(`Outcome updated to ${outcomeLabel(outcome)}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update application outcome"); }
    finally { setLoading(false); }
  }

  async function addNote() {
    if (!detail || !timelineNote.trim()) return;
    setLoading(true); setError(""); setNotice("");
    try {
      await api(`/applications/${detail.item.id}/tracker/notes`, {
        method: "POST",
        body: JSON.stringify({ note: timelineNote.trim() })
      });
      setTimelineNote("");
      await refreshAll(detail.item.id);
      setNotice("Timeline note added.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add timeline note"); }
    finally { setLoading(false); }
  }

  async function markSubmitted() {
    if (!detail) return;
    if (!window.confirm("Only do this after you actually submitted the employer application. Mark this application as submitted?")) return;
    setLoading(true); setError(""); setNotice("");
    try {
      await api(`/applications/${detail.item.id}/mark-submitted`, { method: "POST", body: "{}" });
      await refreshAll(detail.item.id);
      setNotice("Application marked submitted and moved to Waiting.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not mark application submitted"); }
    finally { setLoading(false); }
  }

  const metrics = overview?.metrics;

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">M5 OUTCOME LOOP</span>
          <h1>Applications</h1>
          <p>Track every application from preparation through interviews, offers and closure. Outcomes stay local and now feed a confidence-weighted personal ranking model once enough evidence exists.</p>
        </div>
        <button onClick={() => refreshAll(detail?.item.id)} disabled={loading}>Refresh</button>
      </header>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {metrics && (
        <section className="tracker-metrics">
          <Metric label="Applications" value={metrics.applicationCount} detail={`${metrics.preparingCount} preparing`} />
          <Metric label="Submitted" value={metrics.submittedCount} detail={`${metrics.waitingCount} waiting`} />
          <Metric label="Interviews" value={metrics.interviewCount} detail={`${metrics.interviewRate}% of submitted`} />
          <Metric label="Offers" value={metrics.offerCount} detail={`${metrics.offerRate}% of submitted`} />
          <Metric label="Responses" value={`${metrics.responseRate}%`} detail={`${metrics.responseCount} applications`} />
        </section>
      )}

      <section className="panel tracker-board-panel">
        <div className="panel-title">
          <div><span className="eyebrow">PIPELINE</span><h2>Application board</h2></div>
          <span className="muted">Click a card to update outcome, follow-up and notes.</span>
        </div>
        <div className="tracker-board">
          {pipeline.map((column) => {
            const items = grouped.get(column.stage) ?? [];
            return (
              <section className="tracker-column" key={column.stage}>
                <div className="tracker-column-head"><div><strong>{column.title}</strong><small>{column.hint}</small></div><span>{items.length}</span></div>
                <div className="tracker-column-cards">
                  {items.map((item) => <TrackerCard key={item.id} item={item} onOpen={() => loadDetail(item.id).catch((e) => setError(e.message))} />)}
                  {!items.length && <div className="tracker-empty">No applications here.</div>}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      {metrics && (
        <section className="panel">
          <div className="panel-title"><div><span className="eyebrow">OUTCOME SIGNALS</span><h2>Fit score vs outcomes</h2></div><span className="muted">Scores are frozen at submission so future rescoring does not rewrite history.</span></div>
          <div className="outcome-signals">
            <Metric label="Submitted avg fit" value={metrics.averageSubmittedScore == null ? "—" : `${metrics.averageSubmittedScore}%`} />
            <Metric label="Interview avg fit" value={metrics.averageInterviewScore == null ? "—" : `${metrics.averageInterviewScore}%`} />
            <Metric label="Offer avg fit" value={metrics.averageOfferScore == null ? "—" : `${metrics.averageOfferScore}%`} />
            <Metric label="Rejected avg fit" value={metrics.averageRejectedScore == null ? "—" : `${metrics.averageRejectedScore}%`} />
          </div>
          <p className="muted tracker-signal-note">M5.1 uses these signals only after at least three labelled outcomes exist, and repeated title/skill patterns remain confidence-weighted to avoid overfitting.</p>
        </section>
      )}

      {detail && (
        <div className="drawer-backdrop" onClick={() => setDetail(null)}>
          <aside className="drawer tracker-drawer" onClick={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setDetail(null)}>×</button>
            <span className="eyebrow">APPLICATION #{detail.item.id}</span>
            <h2>{detail.item.title}</h2>
            <p className="muted">{detail.item.company}{detail.item.location ? ` · ${detail.item.location}` : ""} · {detail.item.ats}</p>
            {detail.item.sourceUrl && <a className="source-link" href={detail.item.sourceUrl} target="_blank" rel="noreferrer">Open employer posting ↗</a>}

            <div className="tracker-detail-summary">
              <div><span>Stage</span><strong>{detail.item.stage.toLowerCase()}</strong></div>
              <div><span>Outcome</span><strong>{outcomeLabel(detail.item.outcome)}</strong></div>
              <div><span>Fit at submission</span><strong>{scoreValue(detail.item)}%</strong></div>
              <div><span>Submitted</span><strong>{formatDate(detail.item.submittedAt)}</strong></div>
            </div>

            {!detail.item.submittedAt && detail.item.state !== "SUBMITTED" && detail.item.outcome !== "WITHDRAWN" && (
              <div className="tracker-submit-callout">
                <strong>Not marked submitted yet</strong>
                <span>If you already applied outside ApplyLite, you can confirm it here.</span>
                <button className="primary" onClick={markSubmitted} disabled={loading}>Mark manually submitted</button>
              </div>
            )}

            {(detail.item.submittedAt || detail.item.state === "SUBMITTED") && (
              <section className="tracker-outcome-editor">
                <h3>Employer outcome</h3>
                <div className="outcome-buttons">
                  {outcomeOptions.map((option) => (
                    <button
                      key={option.value}
                      className={detail.item.outcome === option.value ? `active ${option.value.toLowerCase()}` : ""}
                      onClick={() => changeOutcome(option.value)}
                      disabled={loading}
                    >{option.label}</button>
                  ))}
                </div>
                <input value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} placeholder="Optional note, e.g. first-round technical interview booked" />
              </section>
            )}

            {!detail.item.submittedAt && detail.item.state !== "SUBMITTED" && detail.item.outcome !== "WITHDRAWN" && (
              <button className="tracker-withdraw" onClick={() => changeOutcome("WITHDRAWN")} disabled={loading}>Withdraw / stop pursuing</button>
            )}

            {!detail.item.submittedAt && detail.item.state !== "SUBMITTED" && detail.item.outcome === "WITHDRAWN" && (
              <button onClick={() => changeOutcome("ACTIVE")} disabled={loading}>Resume pursuing</button>
            )}

            <section className="tracker-followup">
              <h3>Next action</h3>
              <label>Action<input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="Follow up with recruiter, prepare interview, send documents..." /></label>
              <label>When<input type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} /></label>
              <label>Private application notes<textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything you want to remember about this application." /></label>
              <button className="primary" onClick={saveTracker} disabled={loading}>{loading ? "Saving..." : "Save tracker"}</button>
            </section>

            <section className="tracker-timeline-section">
              <div className="panel-title"><div><span className="eyebrow">HISTORY</span><h3>Timeline</h3></div></div>
              <div className="timeline-note-entry">
                <textarea rows={2} value={timelineNote} onChange={(event) => setTimelineNote(event.target.value)} placeholder="Add a note to the timeline..." />
                <button onClick={addNote} disabled={loading || !timelineNote.trim()}>Add note</button>
              </div>
              <div className="tracker-timeline">
                {detail.timeline.map((event) => (
                  <article key={event.id} className={event.source === "tracker" ? "tracker-event" : event.source === "gmail" ? "gmail-event" : "workflow-event"}>
                    <div className="timeline-dot" />
                    <div><strong>{event.title}</strong><span>{formatDate(event.createdAt, true)}</span>{event.note && <p>{event.note}</p>}</div>
                  </article>
                ))}
                {!detail.timeline.length && <div className="empty"><strong>No history yet</strong><span>Outcome changes and notes will appear here.</span></div>}
              </div>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
