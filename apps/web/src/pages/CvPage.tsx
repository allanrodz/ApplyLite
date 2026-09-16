import { useEffect, useRef, useState } from "react";
import { CandidateFactsSchema, type CandidateFacts, type CvDocument } from "@apply-lite/shared";
import { api } from "../lib/api";
type Draft = CvDocument & { status: string; message: string; revision: number; publishedCvId: number | null };
const groups = [
  { key: "employment", label: "Employment", fields: ["title", "employer", "startDate", "endDate", "location", "bullets"] },
  { key: "education", label: "Education", fields: ["qualification", "institution", "field", "startDate", "endDate", "details"] },
  { key: "projects", label: "Projects", fields: ["name", "description", "technologies", "bullets"] }
] as const;
const arrayFields = new Set(["bullets", "details", "technologies"]);
const title = (s: string) => s.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
export function CvPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [facts, setFacts] = useState<CandidateFacts | null>(null);
  const [current, setCurrent] = useState<CvDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const [edited, setEdited] = useState(false);
  const markEdited = () => { dirty.current = true; setEdited(true); };
  function show(value: Draft) { setDraft(value); setFacts(value.facts); dirty.current = false; setEdited(false); }
  async function load() { const [d, c] = await Promise.all([api<Draft | null>("/cv/draft"), api<CvDocument | null>("/cv/current")]); if (d) show(d); setCurrent(c); }
  useEffect(() => { void load().catch(e => setNotice(e.message)); }, []);
  useEffect(() => {
    if (!draft || draft.status !== "enhancing") return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const update = await api<Draft>(`/cv/drafts/${draft.id}`);
        if (cancelled) return;
        if (!dirty.current) show(update);
        else if (update.status === "needs_review") {
          // Only the AI draft changed; the user's visible edits intentionally retain priority.
          setDraft(update); setNotice("AI finished. Your edits are still shown and will take priority when you save reviewed facts.");
        } else if (update.status === "ready") {
          setDraft(old => old ? { ...old, status: "ready", message: "This CV was saved elsewhere. Reload before saving your changes." } : old);
        }
      } catch (error) { if (!cancelled) setNotice(error instanceof Error ? error.message : "Could not check AI progress. Your source is saved."); }
    }, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [draft?.id, draft?.status]);
  async function operation(run: () => Promise<void>) { setBusy(true); try { await run(); } catch (e) { setNotice(e instanceof Error ? e.message : "Request failed"); } finally { setBusy(false); } }
  async function upload(event: React.FormEvent) {
    event.preventDefault(); if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setNotice("Maximum upload size is 10 MB.");
    await operation(async () => { const body = new FormData(); body.append("file", file); show(await api<Draft>("/cv/upload", { method: "POST", body })); setNotice("Source saved. Review the draft below; AI is optional."); });
  }
  function setScalar(key: keyof CandidateFacts, value: string | string[]) { markEdited(); setFacts(old => old ? { ...old, [key]: value } : old); }
  function editRecord(key: typeof groups[number]["key"], index: number, field: string, value: string) {
    markEdited(); setFacts(old => old ? { ...old, [key]: old[key].map((row, i) => i === index ? { ...row, [field]: arrayFields.has(field) ? value.split(/\r?\n/) : value } : row) } : old);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || !facts) return;
    await operation(async () => {
      const value = CandidateFactsSchema.parse(facts);
      for (const key of ["skills", "languages", "certifications"] as const) value[key] = value[key].map(s => s.trim()).filter(Boolean);
      show(await api<Draft>(`/cv/drafts/${draft.id}`, { method: "PUT", body: JSON.stringify({ facts: value, revision: draft.revision }) }));
      setCurrent(await api<CvDocument>("/cv/current")); setNotice("Reviewed facts saved for matching and application documents. Merge into Profile, then check your own target roles and locations.");
    });
  }
  return <>
    <header className="page-header"><div><span className="eyebrow">YOUR LOCAL CV</span><h1>CV intelligence</h1><p>Save your CV without waiting for AI. Check the source, edit your facts, then save a reviewed version.</p></div></header>
    {notice && <div className="notice" role="status">{notice}</div>}
    <section className="panel"><p>{current ? `Matching currently uses your last saved CV: ${current.sourceName}. Importing a draft does not replace it until you save reviewed facts.` : "No reviewed CV saved yet. Import and review a CV to provide factual evidence for matching and documents."}</p>
      {current && <button disabled={busy} onClick={() => void operation(async () => { show(await api<Draft>("/cv/drafts/from-current", { method: "POST", body: "{}" })); setNotice("Existing CV opened as an editable draft."); })}>Edit the saved CV</button>}</section>
    <section className="cv-import-grid"><form className="panel" onSubmit={upload}><h2>Upload a CV</h2><p>PDF with selectable text, DOCX, TXT or Markdown; maximum 10 MB. Image-only PDFs need a text export or pasted text.</p><label>CV file<input type="file" accept=".pdf,.docx,.txt,.md" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label><button className="primary" disabled={busy || !file}>{busy ? "Working..." : "Import CV"}</button></form>
      <section className="panel"><h2>Paste CV text</h2><label>Full source text<textarea rows={6} value={text} onChange={e => setText(e.target.value)} /></label><button disabled={busy || text.trim().length < 80} onClick={() => void operation(async () => { show(await api<Draft>("/cv/import-text", { method: "POST", body: JSON.stringify({ text }) })); setText(""); setNotice("Text imported without AI. Review it below."); })}>Import text</button></section></section>
    {draft && facts && <>
      <section className="panel"><h2>{draft.sourceName}</h2><p><strong>{draft.status}</strong> - {draft.message}</p><p>{draft.rawText.length.toLocaleString()} source characters saved. Unknown fields may be blank; complete them manually or request AI enhancement.</p>
        <div className="actions"><button disabled={busy || edited || draft.status === "ready" || draft.status === "enhancing"} onClick={() => void operation(async () => { show(await api<Draft>(`/cv/drafts/${draft.id}/enhance`, { method: "POST", body: "{}" })); setNotice("Enhancement started separately from the upload. Your source stays safe if AI is unavailable."); })}>Enhance draft with local AI (optional)</button>
          <button disabled={busy} onClick={() => { if (!edited || window.confirm("Discard unsaved edits and reload the saved draft?")) void operation(load); }}>Reload saved draft</button></div>
        <details><summary>Full extracted source text</summary><textarea aria-label="Full source text" rows={14} value={draft.rawText} readOnly /></details>
      </section>
      <form className="panel" onSubmit={save}><h2>Review and edit facts</h2><p>Leave unknown values empty. Saving confirms your review and makes this CV available to matching and document generation.</p><div className="form-grid">
        {(["fullName", "email", "phone", "headline", "summary"] as const).map(key => <label key={key} className={key === "summary" ? "full" : ""}>{title(key)}{key === "summary" ? <textarea rows={4} value={facts[key]} onChange={e => setScalar(key, e.target.value)} /> : <input value={facts[key]} onChange={e => setScalar(key, e.target.value)} />}</label>)}
        {(["skills", "languages", "certifications"] as const).map(key => <label key={key} className="full">{title(key)} (one per line)<textarea rows={key === "skills" ? 5 : 2} value={facts[key].join("\n")} onChange={e => setScalar(key, e.target.value.split(/\r?\n/))} /></label>)}</div>
        {groups.map(group => <section key={group.key}><h3>{group.label}</h3>{facts[group.key].map((row, index) => <fieldset key={`${group.key}-${index}`}><legend>{group.label} {index + 1}</legend><div className="form-grid">{group.fields.map(field => <label key={field}>{title(field)}{arrayFields.has(field) ? " (one per line)" : ""}{arrayFields.has(field) ? <textarea rows={3} value={((row as unknown as Record<string, string[]>)[field] || []).join("\n")} onChange={e => editRecord(group.key, index, field, e.target.value)} /> : <input value={(row as unknown as Record<string, string>)[field] || ""} onChange={e => editRecord(group.key, index, field, e.target.value)} />}</label>)}</div><button type="button" onClick={() => { markEdited(); setFacts({ ...facts, [group.key]: facts[group.key].filter((_, i) => i !== index) }); }}>Remove entry</button></fieldset>)}<button type="button" onClick={() => { markEdited(); setFacts(CandidateFactsSchema.parse({ ...facts, [group.key]: [...facts[group.key], Object.fromEntries(group.fields.map(f => [f, arrayFields.has(f) ? [] : ""]))] })); }}>Add {group.label.toLowerCase()} entry</button></section>)}
        <div className="actions"><button className="primary" disabled={busy}>Save reviewed facts</button></div></form>
      <section className="panel"><h2>Use reviewed facts in Profile</h2><p>Fills blank contact/profile values and merges skills. Your target roles, locations and work-authorisation answers are never invented. Review Profile after merging.</p><button disabled={busy || edited || draft.status !== "ready" || !draft.publishedCvId} onClick={() => void operation(async () => { await api("/cv/current/merge-profile", { method: "POST", body: JSON.stringify({ cvId: draft.publishedCvId }) }); setNotice("Profile updated. Set your desired roles and review skills, contact details and preferences in Profile."); })}>Merge reviewed facts into Profile</button></section>
    </>}
  </>;
}
