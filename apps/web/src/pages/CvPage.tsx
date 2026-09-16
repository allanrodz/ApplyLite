import { useEffect, useMemo, useState } from "react";
import type { CvDocument } from "@apply-lite/shared";
import { api } from "../lib/api";

function FactList({ values, empty }: { values: string[]; empty: string }) {
  return values.length
    ? <div className="chips">{values.map((value) => <span key={value}>{value}</span>)}</div>
    : <p className="muted">{empty}</p>;
}

export function CvPage() {
  const [cv, setCv] = useState<CvDocument | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  async function refresh() {
    try {
      setCv(await api<CvDocument | null>("/cv/current"));
    } catch (error) {
      throw error;
    }
  }

  useEffect(() => {
    refresh().catch((e) => setMessage(e.message));
    api<{ available: boolean }>("/ai/health").then((r) => setAiAvailable(r.available)).catch(() => setAiAvailable(false));
  }, []);

  const factsCount = useMemo(() => {
    if (!cv) return 0;
    return cv.facts.skills.length + cv.facts.employment.length + cv.facts.education.length + cv.facts.projects.length;
  }, [cv]);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return setMessage("Choose a PDF, DOCX, TXT, or Markdown CV first.");
    setBusy(true);
    setMessage("Reading CV, then extracting factual candidate memory with local Qwen3. The first run may load the 5.2 GB model into memory...");
    try {
      const body = new FormData();
      body.append("file", file);
      const imported = await api<CvDocument>("/cv/upload", { method: "POST", body });
      setCv(imported);
      setMessage(`Imported ${imported.sourceName}. Review the extracted facts before merging them into your profile.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not import CV");
    } finally {
      setBusy(false);
    }
  }

  async function importText() {
    if (paste.trim().length < 80) return setMessage("Paste at least 80 characters of CV text.");
    setBusy(true);
    setMessage("Extracting factual candidate memory locally...");
    try {
      const imported = await api<CvDocument>("/cv/import-text", {
        method: "POST",
        body: JSON.stringify({ sourceName: "pasted-cv.txt", text: paste })
      });
      setCv(imported);
      setPaste("");
      setMessage("CV text imported. Review the extracted facts before using them.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not import CV text");
    } finally {
      setBusy(false);
    }
  }

  async function mergeProfile() {
    setBusy(true);
    try {
      await api("/cv/current/merge-profile", { method: "POST", body: "{}" });
      setMessage("CV skills, summary, and current title were merged into blank/profile fields. Existing profile facts were preserved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not merge CV into profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">FACTUAL MEMORY</span>
          <h1>CV intelligence</h1>
          <p>Import your master CV once. ApplyLite extracts only source-backed facts and keeps the raw evidence locally for later job-specific tailoring.</p>
        </div>
        <span className={`ai-status ${aiAvailable ? "online" : "offline"}`}>{aiAvailable === null ? "Checking Ollama" : aiAvailable ? "Ollama online" : "Ollama offline"}</span>
      </header>

      {message && <div className={message.toLowerCase().includes("could not") || message.toLowerCase().includes("offline") ? "alert" : "notice"}>{message}</div>}

      <section className="cv-import-grid">
        <form className="panel" onSubmit={upload}>
          <span className="eyebrow">RECOMMENDED</span>
          <h2>Upload master CV</h2>
          <p className="muted">Supported: PDF, DOCX, TXT, Markdown. Maximum 10 MB. The file remains on this computer.</p>
          <label>CV file<input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <div className="actions"><button className="primary" disabled={busy || !file}>{busy ? "Extracting..." : "Import CV"}</button></div>
        </form>

        <section className="panel">
          <span className="eyebrow">FALLBACK / DEBUG</span>
          <h2>Paste CV text</h2>
          <label>Raw CV text<textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste the contents of your CV here..." /></label>
          <div className="actions"><button onClick={importText} disabled={busy || paste.trim().length < 80}>Extract pasted text</button></div>
        </section>
      </section>

      {cv ? (
        <>
          <section className="panel cv-summary">
            <div>
              <span className="eyebrow">LATEST IMPORT</span>
              <h2>{cv.sourceName}</h2>
              <p className="muted">{factsCount} structured fact groups/items · imported {new Date(cv.createdAt).toLocaleString()}</p>
            </div>
            <button className="primary" onClick={mergeProfile} disabled={busy}>Merge safe facts into profile</button>
          </section>

          <section className="facts-grid">
            <article className="panel">
              <span className="eyebrow">HEADLINE</span>
              <h2>{cv.facts.headline || "Not explicitly identified"}</h2>
              <p>{cv.facts.summary || "No summary extracted."}</p>
              <h3>Skills</h3>
              <FactList values={cv.facts.skills} empty="No explicit skills extracted." />
            </article>

            <article className="panel">
              <span className="eyebrow">EMPLOYMENT</span>
              <div className="fact-stack">
                {cv.facts.employment.map((item, index) => (
                  <div className="fact-item" key={`${item.employer}-${item.title}-${index}`}>
                    <strong>{item.title || "Title not stated"}</strong>
                    <span>{item.employer}{item.location ? ` · ${item.location}` : ""}</span>
                    <small>{[item.startDate, item.endDate].filter(Boolean).join(" – ")}</small>
                    {item.bullets.length > 0 && <ul>{item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
                  </div>
                ))}
                {!cv.facts.employment.length && <p className="muted">No employment records extracted.</p>}
              </div>
            </article>

            <article className="panel">
              <span className="eyebrow">EDUCATION</span>
              <div className="fact-stack">
                {cv.facts.education.map((item, index) => (
                  <div className="fact-item" key={`${item.institution}-${index}`}>
                    <strong>{item.qualification}{item.field ? ` · ${item.field}` : ""}</strong>
                    <span>{item.institution}</span>
                    <small>{[item.startDate, item.endDate].filter(Boolean).join(" – ")}</small>
                  </div>
                ))}
                {!cv.facts.education.length && <p className="muted">No education records extracted.</p>}
              </div>
            </article>

            <article className="panel">
              <span className="eyebrow">PROJECTS</span>
              <div className="fact-stack">
                {cv.facts.projects.map((item, index) => (
                  <div className="fact-item" key={`${item.name}-${index}`}>
                    <strong>{item.name || "Unnamed project"}</strong>
                    <span>{item.description}</span>
                    <FactList values={item.technologies} empty="No technologies explicitly listed." />
                  </div>
                ))}
                {!cv.facts.projects.length && <p className="muted">No projects extracted.</p>}
              </div>
            </article>
          </section>

          {cv.facts.evidenceNotes.length > 0 && (
            <section className="panel evidence-panel">
              <span className="eyebrow">DO NOT OVERSTATE</span>
              <h2>Evidence warnings</h2>
              <ul>{cv.facts.evidenceNotes.map((note) => <li key={note}>{note}</li>)}</ul>
            </section>
          )}
        </>
      ) : (
        <section className="panel empty"><strong>No CV imported yet</strong><span>Upload your master CV to create ApplyLite's local factual memory.</span></section>
      )}
    </>
  );
}
