import { useEffect, useState } from "react";
import type { SkillGrowthOverview, SkillLearningPlan } from "@apply-lite/shared";
import { api } from "../lib/api";

function SkillCard({ item, onPlan, loading }: { item: SkillGrowthOverview["missing"][number]; onPlan: (skill: string) => void; loading: string }) {
  return (
    <article className="skill-growth-card">
      <div className="skill-growth-card-head">
        <div><strong>{item.skill}</strong><span className={item.status === "missing" ? "gap-badge" : "evidence-badge"}>{item.status === "missing" ? "Gap" : "Existing skill"}</span></div>
        <span className="priority-score">Priority {item.priority}</span>
      </div>
      <p><strong>{item.requiredCount}</strong> required · <strong>{item.preferredCount}</strong> preferred · <strong>{item.totalJobCount}</strong> jobs</p>
      {item.evidence.length > 0 && <small>Evidence: {item.evidence.join(" · ")}</small>}
      {item.exampleJobs.length > 0 && <div className="skill-job-context">{item.exampleJobs.map((job) => <span key={job}>{job}</span>)}</div>}
      <button onClick={() => onPlan(item.skill)} disabled={loading === item.skill}>{loading === item.skill ? "Building plan..." : item.status === "missing" ? "Build learning plan" : "Deepen this skill"}</button>
    </article>
  );
}

export function SkillGrowthPage() {
  const [overview, setOverview] = useState<SkillGrowthOverview | null>(null);
  const [plans, setPlans] = useState<SkillLearningPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<SkillLearningPlan | null>(null);
  const [loading, setLoading] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    const [nextOverview, nextPlans] = await Promise.all([
      api<SkillGrowthOverview>("/growth/overview"),
      api<SkillLearningPlan[]>("/growth/plans")
    ]);
    setOverview(nextOverview);
    setPlans(nextPlans);
  }

  useEffect(() => { refresh().catch((e) => setMessage(e.message)); }, []);

  async function generatePlan(skill: string) {
    setLoading(skill); setMessage("");
    try {
      const plan = await api<SkillLearningPlan>("/growth/plan", { method: "POST", body: JSON.stringify({ skill }) });
      setSelectedPlan(plan);
      await refresh();
      setMessage(`Learning plan ready for ${skill}.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not generate learning plan"); }
    finally { setLoading(""); }
  }

  async function updateStatus(plan: SkillLearningPlan, status: SkillLearningPlan["status"]) {
    await api(`/growth/plans/${encodeURIComponent(plan.skill)}/status`, { method: "PUT", body: JSON.stringify({ status }) });
    const updated = { ...plan, status };
    setSelectedPlan(updated);
    await refresh();
  }

  return (
    <>
      <header className="page-header">
        <div><span className="eyebrow">CONTINUOUS GROWTH</span><h1>Skill Growth</h1><p>Turn the skills employers repeatedly ask for into focused learning plans and portfolio projects.</p></div>
      </header>
      {message && <div className="notice">{message}</div>}

      {overview && (
        <section className="growth-stats">
          <div><span>Jobs analysed</span><strong>{overview.jobsAnalyzed}</strong></div>
          <div><span>Verified skills</span><strong>{overview.candidateSkillCount}</strong></div>
          <div><span>Priority gaps</span><strong>{overview.missing.length}</strong></div>
          <div><span>Skills to deepen</span><strong>{overview.deepen.length}</strong></div>
        </section>
      )}

      <section className="panel">
        <div className="panel-title"><div><span className="eyebrow">JOB-DRIVEN GAPS</span><h2>Skills worth learning next</h2></div><span className="muted">Required skills are weighted more heavily than preferred skills.</span></div>
        <div className="skill-growth-grid">
          {(overview?.missing ?? []).slice(0, 12).map((item) => <SkillCard key={item.skill} item={item} onPlan={generatePlan} loading={loading} />)}
          {overview && overview.missing.length === 0 && <div className="empty"><strong>No recurring gaps yet</strong><span>Discover or import more jobs to build a demand signal.</span></div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title"><div><span className="eyebrow">COMPOUND YOUR STRENGTHS</span><h2>Skills to deepen</h2></div><span className="muted">These already appear in your evidence and in jobs you are seeing.</span></div>
        <div className="skill-growth-grid">
          {(overview?.deepen ?? []).slice(0, 10).map((item) => <SkillCard key={item.skill} item={item} onPlan={generatePlan} loading={loading} />)}
        </div>
      </section>

      {plans.length > 0 && (
        <section className="panel">
          <div className="panel-title"><div><span className="eyebrow">YOUR PLANS</span><h2>Saved learning plans</h2></div></div>
          <div className="saved-plan-list">
            {plans.map((plan) => <button key={plan.skill} onClick={() => setSelectedPlan(plan)}><strong>{plan.skill}</strong><span>{plan.mode === "learn" ? "Learn" : "Deepen"} · {plan.status}</span></button>)}
          </div>
        </section>
      )}

      {selectedPlan && (
        <div className="drawer-backdrop" onClick={() => setSelectedPlan(null)}>
          <aside className="drawer growth-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setSelectedPlan(null)}>×</button>
            <span className="eyebrow">{selectedPlan.mode === "learn" ? "LEARNING PLAN" : "DEEPENING PLAN"}</span>
            <h2>{selectedPlan.skill}</h2>
            <p>{selectedPlan.whyNow}</p>
            <div className="plan-status-row">
              {(["suggested", "learning", "built", "paused"] as const).map((status) => <button key={status} className={selectedPlan.status === status ? "active" : ""} onClick={() => updateStatus(selectedPlan, status)}>{status}</button>)}
            </div>
            {selectedPlan.currentEvidence.length > 0 && <><h3>Current evidence</h3><ul>{selectedPlan.currentEvidence.map((item) => <li key={item}>{item}</li>)}</ul></>}
            {selectedPlan.prerequisites.length > 0 && <><h3>Prerequisites</h3><ul>{selectedPlan.prerequisites.map((item) => <li key={item}>{item}</li>)}</ul></>}
            <h3>Learning objectives</h3><ul>{selectedPlan.objectives.map((item) => <li key={item}>{item}</li>)}</ul>
            <section className="learning-project">
              <span className="eyebrow">PORTFOLIO PROJECT</span><h3>{selectedPlan.project.title}</h3><p>{selectedPlan.project.goal}</p>
              <strong>Milestones</strong><ol>{selectedPlan.project.milestones.map((item) => <li key={item}>{item}</li>)}</ol>
              <strong>Deliverables</strong><ul>{selectedPlan.project.deliverables.map((item) => <li key={item}>{item}</li>)}</ul>
              {selectedPlan.project.stretchGoals.length > 0 && <><strong>Stretch goals</strong><ul>{selectedPlan.project.stretchGoals.map((item) => <li key={item}>{item}</li>)}</ul></>}
              <strong>Portfolio proof</strong><ul>{selectedPlan.project.portfolioProof.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
            <h3>Free learning material</h3>
            <div className="material-list">{selectedPlan.materials.map((material) => <a key={material.url} href={material.url} target="_blank" rel="noreferrer"><strong>{material.title}</strong><span>{material.note}</span><small>{material.type}</small></a>)}</div>
          </aside>
        </div>
      )}
    </>
  );
}
