import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Answer = { id: number; key: string; label: string; value: string; category: string; updatedAt: string };

export function AnswersPage() {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [draft, setDraft] = useState({ key: "", label: "", value: "", category: "general" });
  const [message, setMessage] = useState("");

  async function refresh() { setAnswers(await api<Answer[]>("/answers")); }
  useEffect(() => { refresh().catch((e) => setMessage(e.message)); }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/answers", { method: "POST", body: JSON.stringify(draft) });
      setDraft({ key: "", label: "", value: "", category: "general" });
      setMessage("Answer saved.");
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save answer");
    }
  }

  return (
    <>
      <header className="page-header"><div><span className="eyebrow">REUSABLE KNOWLEDGE</span><h1>Answer library</h1><p>Store recurring application answers once. Low-confidence questions should come back here rather than being guessed.</p></div></header>
      {message && <div className="notice">{message}</div>}
      <section className="answer-layout">
        <form className="panel" onSubmit={save}>
          <h2>Add or update answer</h2>
          <label>Key<input value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="work_authorization_ireland" required /></label>
          <label>Question / label<input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Are you authorised to work in Ireland?" required /></label>
          <label>Category<input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></label>
          <label>Answer<textarea rows={6} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} required /></label>
          <div className="actions"><button className="primary">Save answer</button></div>
        </form>

        <section className="panel">
          <div className="panel-title"><div><span className="eyebrow">KNOWN ANSWERS</span><h2>{answers.length} saved</h2></div></div>
          <div className="answer-list">
            {answers.map((answer) => <article key={answer.id}><div><strong>{answer.label}</strong><span>{answer.key} · {answer.category}</span></div><p>{answer.value}</p></article>)}
            {!answers.length && <div className="empty"><strong>No reusable answers yet</strong><span>Add common work-authorisation, salary, notice-period and application answers.</span></div>}
          </div>
        </section>
      </section>
    </>
  );
}
