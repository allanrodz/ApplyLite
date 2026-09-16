import { useEffect, useMemo, useState } from "react";
import type {
  CareerCoachApplication,
  CareerCoachOverview,
  FollowUpDraft,
  InterviewPrepPack,
  MockInterviewTurn
} from "@apply-lite/shared";
import { api } from "../lib/api";

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
  const parsed = new Date(sqliteUtc ? `${value.replace(" ", "T")}Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: string | null | undefined, withTime = false) {
  const date = parseTimestamp(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat(undefined, withTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <article><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

function ApplicationLabel({ item }: { item: CareerCoachApplication }) {
  return (
    <div>
      <strong>{item.title}</strong>
      <span>{item.company}{item.location ? ` - ${item.location}` : ""}</span>
    </div>
  );
}

export function CareerCoachPage() {
  const [overview, setOverview] = useState<CareerCoachOverview | null>(null);
  const [active, setActive] = useState<CareerCoachApplication | null>(null);
  const [pack, setPack] = useState<InterviewPrepPack | null>(null);
  const [turns, setTurns] = useState<MockInterviewTurn[]>([]);
  const [questionId, setQuestionId] = useState("");
  const [answer, setAnswer] = useState("");
  const [draft, setDraft] = useState<FollowUpDraft | null>(null);
  const [draftFor, setDraftFor] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    setError("");
    const data = await api<CareerCoachOverview>("/career-coach/overview");
    setOverview(data);
    if (active) {
      const updated = [...data.interviews, ...data.waitingFollowUps].find((item) => item.applicationId === active.applicationId);
      if (updated) setActive(updated);
    }
  }

  useEffect(() => { refresh().catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);

  async function openPrep(item: CareerCoachApplication) {
    setBusy(`open-${item.applicationId}`); setError(""); setNotice("");
    try {
      const [{ pack: existing }, { turns: existingTurns }] = await Promise.all([
        api<{ pack: InterviewPrepPack | null }>(`/career-coach/applications/${item.applicationId}/interview-pack`),
        api<{ turns: MockInterviewTurn[] }>(`/career-coach/applications/${item.applicationId}/mock-turns`)
      ]);
      setActive(item);
      setPack(existing);
      setTurns(existingTurns);
      setQuestionId(existing?.questions[0]?.id ?? "");
      setAnswer("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open interview workspace"); }
    finally { setBusy(""); }
  }

  async function generatePack(item = active) {
    if (!item) return;
    setBusy(`pack-${item.applicationId}`); setError(""); setNotice("");
    try {
      const result = await api<{ pack: InterviewPrepPack }>(`/career-coach/applications/${item.applicationId}/interview-pack`, { method: "POST", body: "{}" });
      setActive(item);
      setPack(result.pack);
      setQuestionId(result.pack.questions[0]?.id ?? "");
      setAnswer("");
      setNotice("Interview prep pack generated from the saved job and verified CV evidence.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not generate interview prep"); }
    finally { setBusy(""); }
  }

  async function submitMock() {
    if (!active || !questionId || answer.trim().length < 20) return;
    setBusy("mock"); setError(""); setNotice("");
    try {
      const result = await api<{ turn: MockInterviewTurn }>(`/career-coach/applications/${active.applicationId}/mock`, {
        method: "POST",
        body: JSON.stringify({ questionId, answer: answer.trim() })
      });
      setTurns((current) => [result.turn, ...current]);
      setAnswer("");
      setNotice("Mock answer scored locally. Treat unsupported claims as review flags, not automatic truth judgments.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not score mock answer"); }
    finally { setBusy(""); }
  }

  async function createDraft(item: CareerCoachApplication, kind: "follow_up" | "thank_you") {
    setBusy(`draft-${item.applicationId}-${kind}`); setError(""); setNotice("");
    try {
      const result = await api<{ draft: FollowUpDraft }>(`/career-coach/applications/${item.applicationId}/follow-ups`, {
        method: "POST",
        body: JSON.stringify({ kind })
      });
      setDraft(result.draft);
      setDraftFor(`${item.title} at ${item.company}`);
      setNotice(kind === "follow_up" ? "Follow-up draft created. It is not sent automatically." : "Thank-you draft created. Review it before sending.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create draft"); }
    finally { setBusy(""); }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Copied to clipboard.");
    } catch { setError("Could not access the clipboard. Select and copy the text manually."); }
  }

  const selectedQuestion = useMemo(() => pack?.questions.find((item) => item.id === questionId) ?? null, [pack, questionId]);
  const latestTurn = turns[0] ?? null;

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">M8 RESPONSE LOOP</span>
          <h1>Interview & Follow-up</h1>
          <p>Prepare for interviews from verified CV evidence, practise answers locally, and draft recruiter follow-ups without sending anything automatically.</p>
        </div>
        <button onClick={() => refresh().catch((e) => setError(e.message))}>Refresh</button>
      </header>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {overview && (
        <section className="coach-stats">
          <Metric label="Interview stage" value={overview.counts.interviews} detail="active interview applications" />
          <Metric label="Follow-ups due" value={overview.counts.followUpsDue} detail={`after ${overview.followUpAfterDays} days waiting`} />
          <Metric label="Prep packs" value={overview.counts.prepPacks} detail="saved locally" />
          <Metric label="Practice answers" value={overview.counts.mockTurns} detail="scored locally" />
        </section>
      )}

      <div className="coach-grid">
        <section className="panel">
          <div className="panel-title"><div><span className="eyebrow">INTERVIEWS</span><h2>Active interview preparation</h2></div></div>
          {!overview?.interviews.length && <div className="empty"><strong>No applications are at Interview yet.</strong><span>When you mark an application Interview in the tracker, it appears here automatically.</span></div>}
          <div className="coach-application-list">
            {overview?.interviews.map((item) => (
              <article key={item.applicationId}>
                <ApplicationLabel item={item} />
                <div className="coach-meta">
                  <span>Applied {formatDate(item.submittedAt)}</span>
                  <span>{item.packGeneratedAt ? `Prep updated ${formatDate(item.packGeneratedAt, true)}` : "No prep pack yet"}</span>
                  <span>{item.mockTurnCount} practice answer(s)</span>
                </div>
                <div className="actions">
                  <button onClick={() => openPrep(item)} disabled={busy !== ""}>{item.packGeneratedAt ? "Open prep" : "Open workspace"}</button>
                  <button className="primary" onClick={() => generatePack(item)} disabled={busy !== ""}>{busy === `pack-${item.applicationId}` ? "Generating..." : item.packGeneratedAt ? "Regenerate prep" : "Generate prep pack"}</button>
                  <button onClick={() => createDraft(item, "thank_you")} disabled={busy !== ""}>Draft thank-you</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title"><div><span className="eyebrow">FOLLOW-UP QUEUE</span><h2>Waiting applications</h2></div></div>
          {!overview?.waitingFollowUps.length && <div className="empty"><strong>Nothing is due.</strong><span>Waiting applications appear here after the follow-up window.</span></div>}
          <div className="coach-followups">
            {overview?.waitingFollowUps.map((item) => (
              <article key={item.applicationId}>
                <ApplicationLabel item={item} />
                <span>{item.daysWaiting} days since submission</span>
                <button onClick={() => createDraft(item, "follow_up")} disabled={busy !== ""}>{busy === `draft-${item.applicationId}-follow_up` ? "Creating..." : "Draft follow-up"}</button>
              </article>
            ))}
          </div>
          <div className="daily-scheduler-note">
            <strong>Manual sending only</strong>
            <span>M8 drafts messages locally. It does not connect to email, contact employers, or send messages on your behalf.</span>
          </div>
        </section>
      </div>

      {draft && (
        <section className="panel coach-draft">
          <div className="panel-title"><div><span className="eyebrow">MESSAGE DRAFT</span><h2>{draftFor}</h2></div><button onClick={() => setDraft(null)}>Close</button></div>
          <label>Subject<input readOnly value={draft.subject} /></label>
          <label>Body<textarea readOnly rows={10} value={draft.body} /></label>
          <div className="actions"><button onClick={() => copyText(`Subject: ${draft.subject}\n\n${draft.body}`)}>Copy subject + body</button></div>
        </section>
      )}

      {active && (
        <section className="panel coach-workspace">
          <div className="panel-title">
            <div><span className="eyebrow">INTERVIEW WORKSPACE</span><h2>{active.title} - {active.company}</h2></div>
            <div className="actions"><button onClick={() => { setActive(null); setPack(null); setTurns([]); }}>Close workspace</button>{pack && <button onClick={() => generatePack()} disabled={busy !== ""}>Regenerate</button>}</div>
          </div>

          {!pack && (
            <div className="coach-generate-callout">
              <strong>No interview pack generated yet.</strong>
              <span>The pack uses the saved job requirements plus verified facts from your latest extracted CV. Generated coaching cannot add new candidate facts.</span>
              <button className="primary" onClick={() => generatePack()} disabled={busy !== ""}>{busy.startsWith("pack-") ? "Generating with Qwen..." : "Generate interview prep"}</button>
            </div>
          )}

          {pack && (
            <>
              <div className="coach-role-summary"><strong>Role summary</strong><p>{pack.roleSummary}</p><small>Generated {formatDate(pack.generatedAt, true)}</small></div>

              <div className="coach-two-col">
                <section>
                  <h3>Role focus</h3>
                  <div className="coach-focus-list">{pack.roleFocus.map((item) => <article key={`${item.topic}-${item.why}`}><strong>{item.topic}</strong><span>{item.why}</span></article>)}</div>
                </section>
                <section>
                  <h3>Refresh before interview</h3>
                  <div className="coach-refresh-list">{pack.refreshTopics.length ? pack.refreshTopics.map((item) => <article key={item.skill} className={item.priority}><strong>{item.skill}</strong><span>{item.reason}</span><b>{item.priority}</b></article>) : <p className="muted">No explicit refresh gaps were identified.</p>}</div>
                </section>
              </div>

              <section className="coach-question-section">
                <div className="panel-title"><div><span className="eyebrow">MOCK INTERVIEW</span><h3>Practice a likely question</h3></div></div>
                <div className="coach-question-tabs">
                  {pack.questions.map((item, index) => <button key={item.id} className={questionId === item.id ? "active" : ""} onClick={() => { setQuestionId(item.id); setAnswer(""); }}>{index + 1}. {item.category}</button>)}
                </div>
                {selectedQuestion && (
                  <div className="coach-question-card">
                    <div className="coach-question-head"><span className={`difficulty ${selectedQuestion.difficulty}`}>{selectedQuestion.difficulty}</span><strong>{selectedQuestion.question}</strong></div>
                    <p><b>Why it may be asked:</b> {selectedQuestion.whyAsked}</p>
                    <p><b>Answer strategy:</b> {selectedQuestion.guidance}</p>
                    {selectedQuestion.evidence.length > 0 && (
                      <div className="coach-evidence"><strong>Verified evidence you can use</strong>{selectedQuestion.evidence.map((item) => <div key={item.id}><span>{item.label}</span><p>{item.text}</p></div>)}</div>
                    )}
                    <label>Your practice answer<textarea rows={8} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type the answer you would give in the interview. Aim for a complete response, then let the local coach score it." /></label>
                    <button className="primary" onClick={submitMock} disabled={busy !== "" || answer.trim().length < 20}>{busy === "mock" ? "Scoring locally..." : "Score my answer"}</button>
                  </div>
                )}

                {latestTurn && (
                  <div className="coach-feedback">
                    <div className="coach-feedback-scores">
                      <Metric label="Overall" value={Math.round(latestTurn.feedback.overallScore)} />
                      <Metric label="Structure" value={Math.round(latestTurn.feedback.structureScore)} />
                      <Metric label="Relevance" value={Math.round(latestTurn.feedback.relevanceScore)} />
                      <Metric label="Evidence" value={Math.round(latestTurn.feedback.evidenceScore)} />
                      <Metric label="Clarity" value={Math.round(latestTurn.feedback.clarityScore)} />
                    </div>
                    <div className="coach-two-col">
                      <div><h4>What worked</h4><ul>{latestTurn.feedback.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div>
                      <div><h4>Improve next</h4><ul>{latestTurn.feedback.improvements.map((item) => <li key={item}>{item}</li>)}</ul></div>
                    </div>
                    {latestTurn.feedback.suggestedStructure && <div className="coach-structure"><strong>Suggested structure</strong><p>{latestTurn.feedback.suggestedStructure}</p></div>}
                    {latestTurn.feedback.unsupportedClaims.length > 0 && <div className="coach-unsupported"><strong>Claims to verify before repeating</strong><ul>{latestTurn.feedback.unsupportedClaims.map((item) => <li key={item}>{item}</li>)}</ul></div>}
                  </div>
                )}
              </section>

              <div className="coach-two-col">
                <section>
                  <h3>STAR story anchors</h3>
                  <div className="coach-story-list">{pack.stories.map((story) => <article key={story.id}><strong>{story.title}</strong><p>{story.prompt}</p>{story.evidence.map((item) => <div className="coach-story-evidence" key={item.id}><span>{item.label}</span><p>{item.text}</p></div>)}</article>)}</div>
                </section>
                <section>
                  <h3>Questions to ask them</h3>
                  <ol className="coach-ask-list">{pack.questionsToAsk.map((item) => <li key={item}>{item}</li>)}</ol>
                </section>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
