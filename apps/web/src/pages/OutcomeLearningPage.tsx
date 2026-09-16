import { useEffect, useMemo, useState } from "react";
import type { OutcomeLearningModel } from "@apply-lite/shared";
import { api } from "../lib/api";

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function OutcomeLearningPage() {
  const [model, setModel] = useState<OutcomeLearningModel | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setModel(await api<OutcomeLearningModel>("/outcome-learning/model"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load outcome learning model");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const positive = useMemo(() => (model?.features ?? [])
    .filter((item) => item.samples >= 2 && item.adjustment > 0)
    .sort((a, b) => b.adjustment - a.adjustment)
    .slice(0, 12), [model]);
  const negative = useMemo(() => (model?.features ?? [])
    .filter((item) => item.samples >= 2 && item.adjustment < 0)
    .sort((a, b) => a.adjustment - b.adjustment)
    .slice(0, 12), [model]);

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">M5.1 PERSONAL RANKING</span>
          <h1>Outcome Learning</h1>
          <p>Turn real interviews, offers and rejections into small, explainable ranking adjustments without letting a tiny sample override your factual job fit.</p>
        </div>
        <button onClick={refresh} disabled={loading}>{loading ? "Refreshing..." : "Refresh model"}</button>
      </header>

      {error && <div className="alert">{error}</div>}

      {model && (
        <>
          <section className="stats-grid">
            <article><span>Submitted applications</span><strong>{model.submittedApplications}</strong></article>
            <article><span>Labelled outcomes</span><strong>{model.labelledApplications}</strong></article>
            <article><span>Activation threshold</span><strong>{model.minimumLabelledApplications}</strong></article>
            <article><span>Global confidence</span><strong>{percent(model.globalConfidence)}</strong></article>
          </section>

          <section className={model.active ? "notice learning-status active" : "notice learning-status"}>
            <strong>{model.active ? "Outcome learning is active" : "Collecting outcome evidence"}</strong>
            <span>{model.note}</span>
          </section>

          <section className="panel">
            <div className="panel-title">
              <div><span className="eyebrow">GUARDRAILS</span><h2>How ranking changes</h2></div>
              <span className="muted">Maximum learned adjustment: ±8 points</span>
            </div>
            <div className="learning-rules">
              <article><strong>1</strong><div><b>Only submitted applications count</b><span>Drafts, skipped jobs and unsubmitted forms never train ranking.</span></div></article>
              <article><strong>2</strong><div><b>Waiting is not a negative outcome</b><span>Only interview, offer and rejection create labels.</span></div></article>
              <article><strong>3</strong><div><b>Three labelled outcomes before activation</b><span>One application cannot make ApplyLite chase or avoid an entire category.</span></div></article>
              <article><strong>4</strong><div><b>Repeated patterns only</b><span>A title/skill must appear in at least two labelled applications before it can affect ranking.</span></div></article>
            </div>
          </section>

          <div className="learning-columns">
            <section className="panel">
              <div className="panel-title"><div><span className="eyebrow">POSITIVE SIGNALS</span><h2>Patterns earning interviews/offers</h2></div></div>
              <div className="learning-feature-list">
                {positive.map((feature) => (
                  <article key={`${feature.kind}-${feature.key}`}>
                    <div><strong>{feature.label}</strong><span>{feature.kind} · {feature.samples} outcomes · {feature.interviews} interviews · {feature.offers} offers</span></div>
                    <div className="learning-adjust positive">+{feature.adjustment.toFixed(1)}</div>
                  </article>
                ))}
                {!positive.length && <div className="empty"><strong>No reliable positive pattern yet</strong><span>Once the same skills or title patterns appear across multiple labelled applications, they will show here.</span></div>}
              </div>
            </section>

            <section className="panel">
              <div className="panel-title"><div><span className="eyebrow">NEGATIVE SIGNALS</span><h2>Patterns underperforming</h2></div></div>
              <div className="learning-feature-list">
                {negative.map((feature) => (
                  <article key={`${feature.kind}-${feature.key}`}>
                    <div><strong>{feature.label}</strong><span>{feature.kind} · {feature.samples} outcomes · {feature.rejections} rejections</span></div>
                    <div className="learning-adjust negative">{feature.adjustment.toFixed(1)}</div>
                  </article>
                ))}
                {!negative.length && <div className="empty"><strong>No reliable negative pattern yet</strong><span>ApplyLite will not infer one from a single rejection.</span></div>}
              </div>
            </section>
          </div>

          <section className="panel">
            <div className="panel-title"><div><span className="eyebrow">FEATURE EVIDENCE</span><h2>All learned patterns</h2></div><span className="muted">{model.features.length} observed features</span></div>
            <div className="learning-table">
              <div className="learning-table-head"><span>Pattern</span><span>Type</span><span>Samples</span><span>Signal</span><span>Confidence</span><span>Adjustment</span></div>
              {model.features.slice(0, 40).map((feature) => (
                <div className="learning-table-row" key={`${feature.kind}-${feature.key}`}>
                  <strong>{feature.label}</strong><span>{feature.kind}</span><span>{feature.samples}</span><span>{feature.signal.toFixed(2)}</span><span>{percent(feature.confidence)}</span><span>{feature.adjustment > 0 ? "+" : ""}{feature.adjustment.toFixed(1)}</span>
                </div>
              ))}
              {!model.features.length && <div className="empty"><strong>No outcome-labelled features yet</strong><span>Your current submitted applications may still be waiting for employer responses.</span></div>}
            </div>
          </section>
        </>
      )}
    </>
  );
}
