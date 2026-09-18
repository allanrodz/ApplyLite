import { useEffect, useMemo, useState } from "react";
import type { ApplicationPackage, ApplicationTrackerOverview, BrowserSessionResult, JobInput, JobRequirements, ScoreBreakdown } from "@apply-lite/shared";
import { API_BASE, api } from "../lib/api";
import { navigate } from "../lib/navigation";
import { watchPackageGeneration } from "../components/PackageNotifications";
import { TaskProgress, taskActive, type Task } from "../components/TaskProgress";

type Job = JobInput & {
  id: number;
  score: number;
  status: string;
  ats: string;
  requirements: JobRequirements;
  scoreBreakdown: ScoreBreakdown;
  createdAt: string;
  origin?: string;
  scoreKind?: string;
  analysisStatus?: string;
};

type Application = {
  id: number;
  jobId: number;
  state: string;
  ats: string;
  title: string;
  company: string;
  score: number;
};

type DashboardTab = "OPPORTUNITIES" | "SUBMITTED" | "CLOSED" | "ALL";
type TrackerItem = ApplicationTrackerOverview["items"][number];

const emptyJob: JobInput = {
  sourceUrl: "",
  title: "",
  company: "",
  location: "",
  salaryText: "",
  description: ""
};

function ScoreBadge({ score }: { score: number }) {
  const band = score >= 85 ? "strong" : score >= 70 ? "good" : "weak";
  return <div className={`score ${band}`}>{score}</div>;
}

function SkillChips({ values, tone = "good" }: { values: string[]; tone?: "good" | "bad" | "neutral" }) {
  if (!values.length) return <p className="muted">None identified.</p>;
  const className = tone === "bad" ? "chips danger" : tone === "neutral" ? "chips subdued" : "chips";
  return <div className={className}>{values.map((value) => <span key={value}>{value}</span>)}</div>;
}

function MissingSkillChips({ values, addingSkill, onAdd }: { values: string[]; addingSkill: string; onAdd: (skill: string) => void }) {
  if (!values.length) return <p className="muted">None identified.</p>;
  return (
    <div className="missing-skill-grid">
      {values.map((value) => (
        <span className="missing-skill-chip" key={value}>
          <span>{value}</span>
          <button
            type="button"
            className="missing-skill-add"
            aria-label={`Add ${value} to profile`}
            title="Add this skill to your Profile only if you genuinely have it"
            disabled={Boolean(addingSkill)}
            onClick={() => onAdd(value)}
          >
            {addingSkill === value ? "…" : "+"}
          </button>
        </span>
      ))}
    </div>
  );
}

function MatchedSkillChips({ values, removingSkill, onRemove }: { values: string[]; removingSkill: string; onRemove: (skill: string) => void }) {
  if (!values.length) return <p className="muted">None identified.</p>;
  return (
    <div className="matched-skill-grid">
      {values.map((value) => (
        <span className="matched-skill-chip" key={value}>
          <span>{value}</span>
          <button
            type="button"
            className="matched-skill-remove"
            aria-label={`Remove ${value} from profile`}
            title="Remove this skill from your Profile"
            disabled={Boolean(removingSkill)}
            onClick={() => onRemove(value)}
          >
            {removingSkill === value ? "…" : "−"}
          </button>
        </span>
      ))}
    </div>
  );
}

function humanizeStatus(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function dashboardBucket(job: Job, application: Application | undefined, trackerItem: TrackerItem | undefined): DashboardTab {
  if (job.status === "NOT_PURSUING" || trackerItem?.outcome === "WITHDRAWN" || trackerItem?.outcome === "REJECTED") return "CLOSED";
  if (application?.state === "SUBMITTED" || Boolean(trackerItem?.submittedAt)) return "SUBMITTED";
  return "OPPORTUNITIES";
}

function pipelineLabel(job: Job, application: Application | undefined, trackerItem: TrackerItem | undefined, bucket: DashboardTab) {
  if (bucket === "CLOSED") {
    if (trackerItem?.outcome === "REJECTED") return "Rejected";
    if (trackerItem?.outcome === "WITHDRAWN") return "Withdrawn";
    return "Not pursuing";
  }
  if (trackerItem?.outcome === "INTERVIEW") return "Interview";
  if (trackerItem?.outcome === "OFFER") return "Offer";
  if (trackerItem?.outcome === "WAITING") return "Waiting";
  if (application) return humanizeStatus(application.state);
  return "Opportunity";
}

export function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [trackerOverview, setTrackerOverview] = useState<ApplicationTrackerOverview | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>("OPPORTUNITIES");
  const [form, setForm] = useState<JobInput>(emptyJob);
  const [jobUrl, setJobUrl] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [selected, setSelected] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [packageLoading, setPackageLoading] = useState(false);
  const [applicationPackage, setApplicationPackage] = useState<ApplicationPackage | null>(null);
  const [browserSession, setBrowserSession] = useState<BrowserSessionResult | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [useOutcomeLearning, setUseOutcomeLearning] = useState(true);
  const [addingSkill, setAddingSkill] = useState("");
  const [removingSkill, setRemovingSkill] = useState("");
  const [deepTask, setDeepTask] = useState<Task | null>(null);
  const [deepJobId, setDeepJobId] = useState<number | null>(null);

  async function refresh(learned = useOutcomeLearning) {
    const [jobRows, applicationRows, trackerRows] = await Promise.all([
      api<Job[]>(`/jobs?workspace=1&learned=${learned ? "1" : "0"}`),
      api<Application[]>("/applications"),
      api<ApplicationTrackerOverview>("/tracker/overview")
    ]);
    setJobs(jobRows);
    setApplications(applicationRows);
    setTrackerOverview(trackerRows);
    setSelected((current) => current ? (jobRows.find((job) => job.id === current.id) ?? current) : null);
    return jobRows;
  }

  useEffect(() => {
    refresh(useOutcomeLearning).catch((e) => setError(e.message));
  }, [useOutcomeLearning]);

  useEffect(() => {
    setApplicationPackage(null);
    setBrowserSession(null);
    if (!selected) return;
    api<ApplicationPackage | null>(`/jobs/${selected.id}/application-package`)
      .then((value) => setApplicationPackage(value))
      .catch(() => setApplicationPackage(null));
  }, [selected?.id]);

  const trackerByJobId = useMemo(() => new Map((trackerOverview?.items ?? []).map((item) => [item.jobId, item])), [trackerOverview]);
  const workspaceJobs = useMemo(() => jobs.filter((job) => {
    const hasApplication = applications.some((item) => item.jobId === job.id);
    return job.origin !== "discovery" || job.status === "FOCUSED" || job.status === "NOT_PURSUING" || hasApplication;
  }), [jobs, applications]);

  const organizedJobs = useMemo(() => workspaceJobs.map((job) => {
    const application = applications.find((item) => item.jobId === job.id);
    const trackerItem = trackerByJobId.get(job.id);
    return { job, application, trackerItem, bucket: dashboardBucket(job, application, trackerItem) };
  }), [workspaceJobs, applications, trackerByJobId]);

  const selectedMeta = selected ? organizedJobs.find((item) => item.job.id === selected.id) : undefined;
  const selectedApplication = selectedMeta?.application;
  const selectedTrackerItem = selectedMeta?.trackerItem;
  const selectedBucket = selectedMeta?.bucket;

  useEffect(() => {
    if (!selectedApplication) {
      setBrowserSession(null);
      return;
    }
    api<BrowserSessionResult | null>(`/applications/${selectedApplication.id}/browser`)
      .then((value) => setBrowserSession(value))
      .catch(() => setBrowserSession(null));
  }, [selectedApplication?.id]);

  useEffect(() => {
    if (!deepTask || !taskActive(deepTask)) return;
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await api<Task>(`/tasks/${deepTask.id}`);
        if (!alive) return;
        setDeepTask(next);
        if (taskActive(next)) {
          timer = window.setTimeout(poll, 1800);
          return;
        }
        if (next.status === "COMPLETED") {
          sessionStorage.removeItem("applylite:discovery-results-v2");
          const rows = await refresh();
          const updated = deepJobId ? rows.find((job) => job.id === deepJobId) : undefined;
          setNotice(updated
            ? `Deep analysis completed. Updated fit score: ${updated.score}%.`
            : "Deep analysis completed. The focused job has been refreshed.");
        } else if (["FAILED", "INTERRUPTED", "CANCELLED"].includes(next.status)) {
          setError(next.error?.message ?? `Deep analysis ${next.status.toLowerCase()}.`);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not refresh deep-analysis status");
      }
    };
    void poll();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [deepTask?.id, deepTask?.status, deepJobId]);

  const stats = useMemo(() => ({
    opportunities: organizedJobs.filter((item) => item.bucket === "OPPORTUNITIES").length,
    submitted: organizedJobs.filter((item) => item.bucket === "SUBMITTED").length,
    closed: organizedJobs.filter((item) => item.bucket === "CLOSED").length,
    jobs: organizedJobs.length
  }), [organizedJobs]);

  const visibleJobs = useMemo(() => activeTab === "ALL" ? organizedJobs : organizedJobs.filter((item) => item.bucket === activeTab), [organizedJobs, activeTab]);

  const emptyTabMessage = activeTab === "OPPORTUNITIES"
    ? "No focused opportunities yet. Move promising jobs from Discover, or import a specific employer posting."
    : activeTab === "SUBMITTED"
      ? "No submitted applications yet."
      : activeTab === "CLOSED"
        ? "No withdrawn, rejected, or not-pursuing jobs."
        : "Import your first job to begin.";

  async function importFromUrl(event: React.FormEvent) {
    event.preventDefault();
    if (!jobUrl.trim()) return;
    setLoading(true);
    setError("");
    setNotice("Opening the job page, extracting explicit requirements with local Qwen3, then scoring it against your CV...");
    try {
      const imported = await api<Job>("/jobs/import-url", {
        method: "POST",
        body: JSON.stringify({ sourceUrl: jobUrl.trim() })
      });
      setJobUrl("");
      setShowImport(false);
      setNotice(`Imported ${imported.title} at ${imported.company} with a ${imported.score}% fit score.`);
      await refresh();
      setSelected(imported);
    } catch (e) {
      setNotice("");
      setError(e instanceof Error ? e.message : "Could not import this job URL");
    } finally {
      setLoading(false);
    }
  }

  async function addJob(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await api("/jobs", { method: "POST", body: JSON.stringify(form) });
      setForm(emptyJob);
      setShowManual(false);
      setShowImport(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import job");
    } finally {
      setLoading(false);
    }
  }

  async function createApplication(jobId: number) {
    setLoading(true);
    setError("");
    try {
      await api(`/jobs/${jobId}/applications`, { method: "POST", body: "{}" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create application");
    } finally {
      setLoading(false);
    }
  }

  async function setWorkspaceStatus(jobId: number, status: "SCORED" | "FOCUSED" | "NOT_PURSUING") {
    await api(`/jobs/${jobId}/workspace-status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
  }

  async function addMissingSkill(skill: string) {
    if (!selected) return;
    const confirmed = window.confirm(
      `Add "${skill}" to your Profile?\n\nOnly add it if you genuinely have this skill. ApplyLite will use it as a factual profile skill for future matching and application materials, and job scores may change.`
    );
    if (!confirmed) return;

    const jobId = selected.id;
    const before = selected.score;
    setAddingSkill(skill);
    setError("");
    try {
      const result = await api<{ added: boolean }>("/profile/skills", {
        method: "POST",
        body: JSON.stringify({ skill })
      });
      sessionStorage.removeItem("applylite:discovery-results-v2");
      const rows = await refresh();
      const updated = rows.find((job) => job.id === jobId);
      if (result.added) {
        setNotice(updated
          ? `Added ${skill} to your Profile. This job's fit score is now ${updated.score}%${updated.score !== before ? ` (was ${before}%)` : ""}.`
          : `Added ${skill} to your Profile.`);
      } else {
        setNotice(`${skill} was already in your Profile. The job score has been refreshed.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add this skill to Profile");
    } finally {
      setAddingSkill("");
    }
  }

  async function removeMatchedSkill(skill: string) {
    if (!selected) return;
    const confirmed = window.confirm(
      `Remove "${skill}" from your Profile?\n\nThis removes it as a factual skill across ApplyLite, so scores and future application materials may change. Only continue if this skill should not be represented in your Profile.`
    );
    if (!confirmed) return;

    const jobId = selected.id;
    const before = selected.score;
    setRemovingSkill(skill);
    setError("");
    try {
      const result = await api<{ removed: boolean }>("/profile/skills", {
        method: "DELETE",
        body: JSON.stringify({ skill })
      });
      sessionStorage.removeItem("applylite:discovery-results-v2");
      const rows = await refresh();
      const updated = rows.find((job) => job.id === jobId);
      if (result.removed) {
        setNotice(updated
          ? `Removed ${skill} from your Profile. This job's fit score is now ${updated.score}%${updated.score !== before ? ` (was ${before}%)` : ""}.`
          : `Removed ${skill} from your Profile.`);
      } else {
        setNotice(`${skill} was not present in your Profile. The job score has been refreshed.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove this skill from Profile");
    } finally {
      setRemovingSkill("");
    }
  }

  async function deepAnalyze(job: Job) {
    if (deepTask && taskActive(deepTask)) return;
    setError("");
    setNotice("Deep analysis queued. ApplyLite will extract detailed requirements and refresh this job's score when it completes.");
    try {
      const task = await api<Task>(`/discovery/jobs/${job.id}/analyze`, { method: "POST", body: "{}" });
      setDeepJobId(job.id);
      setDeepTask(task);
    } catch (e) {
      setNotice("");
      setError(e instanceof Error ? e.message : "Could not start deep analysis");
    }
  }

  async function markNotPursuing(job: Job, application?: Application, trackerItem?: TrackerItem) {
    const submitted = application?.state === "SUBMITTED" || Boolean(trackerItem?.submittedAt);
    const prompt = submitted
      ? "Move this job to Closed and record the application as Withdrawn? This does not contact the employer or withdraw anything on their website."
      : "Move this job to Closed as Not pursuing? You can restore it later.";
    if (!window.confirm(prompt)) return;

    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (application && trackerItem?.outcome !== "REJECTED" && trackerItem?.outcome !== "WITHDRAWN") {
        await api(`/applications/${application.id}/outcome`, {
          method: "POST",
          body: JSON.stringify({ outcome: "WITHDRAWN", note: "Marked not pursuing from the job dashboard." })
        });
      }
      await setWorkspaceStatus(job.id, "NOT_PURSUING");
      await refresh();
      setNotice(submitted ? "Moved to Closed and recorded as Withdrawn locally." : "Moved to Closed as Not pursuing.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close this job");
    } finally {
      setLoading(false);
    }
  }

  async function restoreJob(job: Job, application?: Application, trackerItem?: TrackerItem) {
    if (trackerItem?.outcome === "REJECTED") return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (application && trackerItem?.outcome === "WITHDRAWN") {
        const restoredOutcome = trackerItem.submittedAt || application.state === "SUBMITTED" ? "WAITING" : "ACTIVE";
        await api(`/applications/${application.id}/outcome`, {
          method: "POST",
          body: JSON.stringify({ outcome: restoredOutcome, note: "Restored from the Closed dashboard tab." })
        });
      }
      await setWorkspaceStatus(job.id, job.origin === "discovery" ? "FOCUSED" : "SCORED");
      await refresh();
      setNotice(application?.state === "SUBMITTED" || trackerItem?.submittedAt
        ? "Restored. This job is back under Submitted."
        : "Restored. This job is back under Opportunities.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore this job");
    } finally {
      setLoading(false);
    }
  }

  async function generatePackage(jobId: number) {
    setPackageLoading(true);
    setError("");
    setNotice("Starting package generation in the background...");
    try {
      const result = await api<{ queued: boolean; id?: number; reason?: string }>(`/application-prep/jobs/${jobId}/queue`, { method: "POST", body: "{}" });
      if (result.id && selected) {
        watchPackageGeneration({ id: result.id, jobId, title: selected.title, company: selected.company });
      }
      setNotice(result.queued
        ? "Package generation started in the background. Go browse other opportunities — ApplyLite will alert you when the tailored CV and cover letter are ready."
        : (result.reason ?? "This package is already queued or ready. ApplyLite will keep watching it."));
    } catch (e) {
      setNotice("");
      setError(e instanceof Error ? e.message : "Could not start background application package generation");
    } finally {
      setPackageLoading(false);
    }
  }

  async function approveFallbackPackage(jobId: number) {
    setPackageLoading(true);
    setError("");
    setNotice("");
    try {
      const approved = await api<ApplicationPackage>(`/jobs/${jobId}/application-package/approve-fallback`, { method: "POST", body: "{}" });
      setApplicationPackage(approved);
      setNotice("Fallback package approved for the application assistant after your explicit review. Review every uploaded document and form field before submitting.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve the fallback package");
    } finally {
      setPackageLoading(false);
    }
  }

  async function startBrowser(applicationId: number) {
    setBrowserLoading(true);
    setError("");
    setNotice("Opening a visible Chromium application session and filling only high-confidence fields. ApplyLite will never click final Submit.");
    try {
      const result = await api<BrowserSessionResult & { state: string }>(`/applications/${applicationId}/browser/start`, { method: "POST", body: "{}" });
      setBrowserSession(result);
      setNotice(result.message);
      await refresh();
    } catch (e) {
      setNotice("");
      setError(e instanceof Error ? e.message : "Could not open the employer application browser");
    } finally {
      setBrowserLoading(false);
    }
  }

  async function refillBrowser(applicationId: number) {
    setBrowserLoading(true);
    setError("");
    try {
      const result = await api<BrowserSessionResult & { state: string }>(`/applications/${applicationId}/browser/fill`, { method: "POST", body: "{}" });
      setBrowserSession(result);
      setNotice(result.message);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fill the current application step");
    } finally {
      setBrowserLoading(false);
    }
  }

  async function draftBrowserAnswers(applicationId: number) {
    setBrowserLoading(true);
    setError("");
    setNotice("Reading the current employer form and drafting evidence-grounded answers with local Qwen3...");
    try {
      const result = await api<BrowserSessionResult & { state: string }>(`/applications/${applicationId}/browser/draft-answers`, { method: "POST", body: "{}" });
      setBrowserSession(result);
      setNotice(result.message);
      await refresh();
    } catch (e) {
      setNotice("");
      setError(e instanceof Error ? e.message : "Could not draft answers for the current employer form");
    } finally {
      setBrowserLoading(false);
    }
  }

  async function closeBrowser(applicationId: number) {
    setBrowserLoading(true);
    setError("");
    try {
      await api(`/applications/${applicationId}/browser/close`, { method: "POST", body: "{}" });
      setBrowserSession(null);
      setNotice("Application browser closed. Nothing was submitted automatically.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close the application browser");
    } finally {
      setBrowserLoading(false);
    }
  }

  async function markSubmitted(applicationId: number) {
    if (!window.confirm("Only confirm this after YOU clicked the employer's final Submit/Send Application control and saw a successful submission. Mark this application as submitted?")) return;
    setBrowserLoading(true);
    setError("");
    try {
      await api(`/applications/${applicationId}/mark-submitted`, { method: "POST", body: "{}" });
      setBrowserSession(null);
      setNotice("Application marked as submitted after your manual confirmation.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark the application as submitted");
    } finally {
      setBrowserLoading(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">LOCAL WORKSPACE</span>
          <h1>Your application pipeline</h1>
          <p>Your focused application workspace. Jobs only appear here after you move them from Discover, import them directly, or begin an application.</p>
        </div>
        <div className="page-header-actions">
          <label className="learning-toggle">
            <input type="checkbox" checked={useOutcomeLearning} onChange={(event) => setUseOutcomeLearning(event.target.checked)} />
            <span>Outcome learning</span>
          </label>
          <button className="primary" onClick={() => setShowImport(!showImport)}>+ Import job</button>
        </div>
      </header>

      <section className="panel">
        <div className="panel-title">
          <div><span className="eyebrow">HOW THE PIPELINE WORKS</span><h2>Discover broadly, act selectively</h2></div>
          <button onClick={() => navigate("/discover")}>Browse discovery</button>
        </div>
        <div className="stats-grid">
          <article><span>1 · Discover</span><strong>Browse broadly</strong><small>Discovery can hold many low- and high-score jobs without crowding this workspace.</small></article>
          <article><span>2 · Focus</span><strong>Move promising jobs here</strong><small>Use “Move to Dashboard” only for roles you may actually pursue.</small></article>
          <article><span>3 · Prepare</span><strong>Generate your package</strong><small>Create the tailored CV and cover letter, then review the evidence audit.</small></article>
          <article><span>4 · Apply</span><strong>Use assisted filling</strong><small>Open the employer form, let ApplyLite help fill it, and personally review and submit.</small></article>
        </div>
      </section>

      {error && <div className="alert">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <section className="stats-grid">
        <article><span>Opportunities</span><strong>{stats.opportunities}</strong></article>
        <article><span>Submitted</span><strong>{stats.submitted}</strong></article>
        <article><span>Closed</span><strong>{stats.closed}</strong></article>
        <article><span>Focused jobs</span><strong>{stats.jobs}</strong></article>
      </section>

      {showImport && (
        <section className="panel import-panel">
          <div className="panel-title">
            <div><span className="eyebrow">M2 URL INTELLIGENCE</span><h2>Import from a job URL</h2></div>
            <span className="muted">Best with employer/ATS pages such as Greenhouse, Lever, Ashby, Workable and Workday.</span>
          </div>

          <form className="url-import" onSubmit={importFromUrl}>
            <input
              type="url"
              value={jobUrl}
              onChange={(event) => setJobUrl(event.target.value)}
              placeholder="https://jobs.lever.co/company/..."
              required
            />
            <button className="primary" disabled={loading || !jobUrl.trim()}>{loading ? "Reading & scoring..." : "Import & score"}</button>
          </form>

          <div className="import-help">
            <span>ApplyLite stores the page text locally as evidence. If a site blocks automation or requires login, use manual import instead.</span>
            <button onClick={() => setShowManual(!showManual)}>{showManual ? "Hide manual import" : "Manual import"}</button>
          </div>

          {showManual && (
            <form className="manual-import" onSubmit={addJob}>
              <div className="form-grid">
                <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
                <label>Company<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} required /></label>
                <label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
                <label>Salary text<input value={form.salaryText} onChange={(e) => setForm({ ...form, salaryText: e.target.value })} /></label>
                <label className="full">Source URL<input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://..." /></label>
                <label className="full">Job description<textarea rows={10} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></label>
              </div>
              <div className="actions"><button className="primary" disabled={loading}>{loading ? "Scoring..." : "Save manual job"}</button></div>
            </form>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-title">
          <div><span className="eyebrow">MATCH QUEUE</span><h2>Job workspace</h2></div>
          <span className="muted">{jobs.length ? (useOutcomeLearning ? "Sorted by learned fit when enough outcome evidence exists" : "Showing deterministic base fit only") : "Import your first job to begin"}</span>
        </div>

        <div className="pipeline-tabs" role="tablist" aria-label="Job workspace views">
          {([
            ["OPPORTUNITIES", "Opportunities", stats.opportunities],
            ["SUBMITTED", "Submitted", stats.submitted],
            ["CLOSED", "Closed", stats.closed],
            ["ALL", "All", stats.jobs]
          ] as Array<[DashboardTab, string, number]>).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={activeTab === value}
              className={`pipeline-tab ${activeTab === value ? "active" : ""}`}
              onClick={() => setActiveTab(value)}
            >
              {label}<span>{count}</span>
            </button>
          ))}
        </div>

        <div className="job-list">
          {visibleJobs.map(({ job, application, trackerItem, bucket }) => (
            <article className={`job-row ${bucket === "CLOSED" ? "job-row-closed" : ""}`} key={job.id}>
              <ScoreBadge score={job.score} />
              <button className="job-main" onClick={() => setSelected(job)}>
                <strong>{job.title}</strong><small className={`score-confidence ${job.scoreKind === "quick" ? "quick" : job.scoreKind === "deep" ? "deep" : "previous"}`}>{job.scoreKind === "quick" ? "Quick score (provisional)" : job.scoreKind === "deep" ? "AI-analyzed; review requirements" : "Previous score"}{job.analysisStatus === "failed" ? " - deep analysis needs retry" : ""}</small>
                <span>{job.company} · {job.location || "Location not specified"} · {job.ats || "manual"}</span>
                <small>{job.scoreBreakdown.matchedRequiredSkills?.slice(0, 5).join(" · ") || job.scoreBreakdown.matchedSkills.slice(0, 5).join(" · ") || "Open details for the evidence-backed fit analysis"}</small>
                {job.scoreBreakdown.baseTotal !== undefined && job.scoreBreakdown.outcomeLearningActive && (job.scoreBreakdown.outcomeAdjustment ?? 0) !== 0 && (
                  <small className="outcome-score-note">Base {job.scoreBreakdown.baseTotal}% · outcome learning {(job.scoreBreakdown.outcomeAdjustment ?? 0) > 0 ? "+" : ""}{job.scoreBreakdown.outcomeAdjustment} → {job.score}%</small>
                )}
              </button>
              <div className="job-actions">
                <span className={`state-pill ${bucket === "CLOSED" ? "closed" : bucket === "SUBMITTED" ? "submitted" : ""}`}>
                  {pipelineLabel(job, application, trackerItem, bucket)}
                </span>
                {!application && bucket !== "CLOSED" && <button onClick={() => createApplication(job.id)} disabled={loading}>Approve</button>}
                {bucket !== "CLOSED" && (
                  <button className="job-secondary danger" onClick={() => markNotPursuing(job, application, trackerItem)} disabled={loading}>Not pursuing</button>
                )}
                {bucket === "CLOSED" && trackerItem?.outcome !== "REJECTED" && (
                  <button className="job-secondary" onClick={() => restoreJob(job, application, trackerItem)} disabled={loading}>Restore</button>
                )}
                <button onClick={() => setSelected(job)}>Details</button>
              </div>
            </article>
          ))}
          {!visibleJobs.length && <div className="empty"><strong>Nothing in this tab</strong><span>{emptyTabMessage}</span></div>}
        </div>
      </section>

      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="drawer" onClick={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setSelected(null)}>×</button>
            <ScoreBadge score={selected.score} />
            <h2>{selected.title}</h2>
            <p className="muted">{selected.company} · {selected.location || "Location not specified"} · {selected.ats}</p>
            {selected.sourceUrl && <a className="source-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">Open original posting ↗</a>}
            <p className={`score-confidence drawer-confidence ${selected.scoreKind === "quick" ? "quick" : selected.scoreKind === "deep" ? "deep" : "previous"}`}>
              {selected.scoreKind === "quick"
                ? "Quick score (provisional) — based on fast deterministic matching."
                : selected.scoreKind === "deep"
                  ? "AI-analyzed fit — detailed requirements extracted; still review the evidence."
                  : "Previous score — open the evidence and re-run deep analysis if needed."}
            </p>

            <div className="dashboard-analysis-actions">
              <button
                type="button"
                onClick={() => deepAnalyze(selected)}
                disabled={Boolean(deepTask && taskActive(deepTask))}
              >
                {deepTask && taskActive(deepTask) && deepJobId === selected.id
                  ? "Deep analysis running…"
                  : selected.scoreKind === "deep"
                    ? "Re-run deep analysis"
                    : "Deep analyze this job"}
              </button>
              <small>Deep analysis can identify required/preferred skills more precisely and may update the fit score.</small>
            </div>
            {deepTask && deepJobId === selected.id && (
              <TaskProgress task={deepTask} onChange={(next) => next && setDeepTask(next)} />
            )}

            {selectedBucket && (
              <div className="workspace-status-bar">
                <div><span>Dashboard</span><strong>{selectedBucket === "OPPORTUNITIES" ? "Opportunities" : selectedBucket === "SUBMITTED" ? "Submitted" : "Closed"}</strong></div>
                {selectedBucket !== "CLOSED" && (
                  <button className="job-secondary danger" onClick={() => markNotPursuing(selected, selectedApplication, selectedTrackerItem)} disabled={loading}>Not pursuing</button>
                )}
                {selectedBucket === "CLOSED" && selectedTrackerItem?.outcome !== "REJECTED" && (
                  <button className="job-secondary" onClick={() => restoreJob(selected, selectedApplication, selectedTrackerItem)} disabled={loading}>Restore</button>
                )}
              </div>
            )}

            {selected.requirements.summary && <p className="job-summary">{selected.requirements.summary}</p>}

            {selected.scoreBreakdown.baseTotal !== undefined && (
              <section className="outcome-learning-score">
                <div><span>Base fit</span><strong>{selected.scoreBreakdown.baseTotal}%</strong></div>
                <div><span>Outcome adjustment</span><strong>{(selected.scoreBreakdown.outcomeAdjustment ?? 0) > 0 ? "+" : ""}{selected.scoreBreakdown.outcomeAdjustment ?? 0}</strong></div>
                <div><span>Ranked fit</span><strong>{selected.scoreBreakdown.total}%</strong></div>
                <div><span>Labelled history</span><strong>{selected.scoreBreakdown.outcomeSamples ?? 0}</strong></div>
                {(selected.scoreBreakdown.outcomeReasons ?? []).length > 0 && (
                  <ul>{selected.scoreBreakdown.outcomeReasons!.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                )}
              </section>
            )}

            <h3>Why it matches</h3>
            {selected.scoreBreakdown.reasons.length ? <ul>{selected.scoreBreakdown.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="muted">No strong positive signals identified yet.</p>}

            <div className="breakdown">
              <div><span>Skills</span><strong>{selected.scoreBreakdown.skills}/40</strong></div>
              <div><span>Title</span><strong>{selected.scoreBreakdown.title}/20</strong></div>
              <div><span>Location</span><strong>{selected.scoreBreakdown.location}/10</strong></div>
              <div><span>Experience</span><strong>{selected.scoreBreakdown.experience}/15</strong></div>
              <div><span>Preference</span><strong>{selected.scoreBreakdown.preference}/15</strong></div>
            </div>

            <div className="experience-inline">
              <strong>{selected.scoreBreakdown.candidateExperienceYears ?? 0} years relevant experience</strong>
              <span>{selected.scoreBreakdown.experienceSource === "cv-derived" ? "derived from dated CV evidence" : selected.scoreBreakdown.experienceSource === "profile" ? "from saved profile" : "not yet verified"}</span>
              {(selected.scoreBreakdown.experienceEvidence ?? []).slice(0, 4).map((item) => (
                <small key={`${item.employer}-${item.title}-${item.startDate}`}>{item.title} · {item.employer} · {item.startDate}–{item.endDate || "Present"} · {item.relevance}</small>
              ))}
            </div>

            <div className="skill-section-heading">
              <div>
                <h3>Required skills matched</h3>
                <small>Use − only if a skill should not be represented in your Profile. Removing it refreshes matching across ApplyLite.</small>
              </div>
            </div>
            <MatchedSkillChips values={selected.scoreBreakdown.matchedRequiredSkills ?? []} removingSkill={removingSkill} onRemove={removeMatchedSkill} />

            <div className="skill-section-heading">
              <div>
                <h3>Required skills missing / unverified</h3>
                <small>Add a skill only when it is genuinely part of your experience. Adding it updates your Profile and refreshes this fit score.</small>
              </div>
            </div>
            <MissingSkillChips values={selected.scoreBreakdown.missingRequiredSkills ?? []} addingSkill={addingSkill} onAdd={addMissingSkill} />

            {(selected.scoreBreakdown.matchedPreferredSkills ?? []).length > 0 && (
              <>
                <div className="skill-section-heading">
                  <div>
                    <h3>Preferred skills matched</h3>
                    <small>Use − if this skill should be removed from your Profile.</small>
                  </div>
                </div>
                <MatchedSkillChips values={selected.scoreBreakdown.matchedPreferredSkills ?? []} removingSkill={removingSkill} onRemove={removeMatchedSkill} />
              </>
            )}

            {selected.requirements.preferredSkills.length > 0 && (
              <>
                <h3>All preferred skills from the posting</h3>
                <SkillChips values={selected.requirements.preferredSkills} tone="neutral" />
              </>
            )}

            {(selected.scoreBreakdown.missingPreferredSkills ?? []).length > 0 && (
              <>
                <div className="skill-section-heading">
                  <div>
                    <h3>Preferred skills missing / unverified</h3>
                    <small>If you already have one of these skills, add it to Profile and ApplyLite will refresh the score.</small>
                  </div>
                </div>
                <MissingSkillChips values={selected.scoreBreakdown.missingPreferredSkills ?? []} addingSkill={addingSkill} onAdd={addMissingSkill} />
              </>
            )}

            {selected.scoreBreakdown.concerns?.length > 0 && (
              <>
                <h3>Things to review</h3>
                <ul className="concerns">{selected.scoreBreakdown.concerns.map((concern) => <li key={concern}>{concern}</li>)}</ul>
              </>
            )}

            {selected.requirements.responsibilities.length > 0 && (
              <>
                <h3>Core responsibilities</h3>
                <ul>{selected.requirements.responsibilities.slice(0, 8).map((responsibility) => <li key={responsibility}>{responsibility}</li>)}</ul>
              </>
            )}

            <section className="package-panel">
              <div className="package-heading">
                <div><span className="eyebrow">M3 APPLICATION PACKAGE</span><h3>Evidence-grounded application</h3></div>
                {applicationPackage && <span className={`audit-pill ${applicationPackage.status.toLowerCase()}`}>{applicationPackage.status === "PASS" ? "Audit passed" : "Review flags"}</span>}
              </div>
              <p className="muted">Package generation runs in the background. Start it, keep browsing other jobs, and ApplyLite will alert you when the tailored CV and cover letter are ready to review.</p>
              {applicationPackage && !applicationPackage.generation.readyToUse && (
                <div className="package-degraded">
                  <strong>PACKAGE DEGRADED · REVIEW REQUIRED</strong>
                  <p>{applicationPackage.generation.message}</p>
                  <small>Failed stages: {applicationPackage.generation.failedStages.join(", ") || "unknown"}. Regenerate first; ApplyLite will now try to recover a stopped local Ollama service automatically.</small>
                  <button
                    type="button"
                    onClick={() => approveFallbackPackage(selected.id)}
                    disabled={packageLoading || applicationPackage.audit.flaggedClaims.length > 0}
                    title={applicationPackage.audit.flaggedClaims.length > 0 ? "Unsupported factual claims must be resolved before this fallback can be used." : undefined}
                  >
                    I reviewed this fallback — allow application assistant
                  </button>
                </div>
              )}
              {applicationPackage && applicationPackage.generation.readyToUse && applicationPackage.generation.mode !== "AI" && (
                <div className="package-mixed"><strong>Partial AI fallback</strong><span>{applicationPackage.generation.message}</span></div>
              )}
              <div className="package-action-row">
                <button className="primary package-generate" onClick={() => generatePackage(selected.id)} disabled={packageLoading}>
                  {packageLoading ? "Working..." : applicationPackage ? "Regenerate package" : "Generate application package"}
                </button>
                <button onClick={() => navigate("/discover")}>Browse more jobs</button>
              </div>

              {applicationPackage && (
                <div className="package-preview">
                  <div className="audit-summary">
                    <div><span>Claims checked</span><strong>{applicationPackage.audit.checkedClaims}</strong></div>
                    <div><span>Supported</span><strong>{applicationPackage.audit.supportedClaims}</strong></div>
                    <div><span>Flagged</span><strong>{applicationPackage.audit.flaggedClaims.length}</strong></div>
                  </div>

                  {applicationPackage.audit.flaggedClaims.length > 0 && (
                    <div className="audit-flags">
                      <strong>Review these claims before use</strong>
                      {applicationPackage.audit.flaggedClaims.map((flag, index) => (
                        <article key={`${flag.section}-${index}`}><span>{flag.section}</span><p>{flag.text}</p><small>{flag.reason}</small></article>
                      ))}
                    </div>
                  )}
                  {applicationPackage.audit.warnings.length > 0 && <ul className="package-warnings">{applicationPackage.audit.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}

                  <h3>Tailored CV preview</h3>
                  <div className="document-preview">
                    <strong>{applicationPackage.tailoredCv.headline}</strong>
                    <p>{applicationPackage.tailoredCv.summary}</p>
                    <div className="chips subdued">{applicationPackage.tailoredCv.skills.slice(0, 12).map((skill) => <span key={skill}>{skill}</span>)}</div>
                  </div>

                  <h3>Cover letter preview</h3>
                  <div className="document-preview">
                    <p>{applicationPackage.coverLetter.salutation}</p>
                    {applicationPackage.coverLetter.paragraphs.map((paragraph, index) => <p key={index}>{paragraph.text}</p>)}
                    <p>{applicationPackage.coverLetter.closing}</p>
                  </div>

                  <h3>Screening answer drafts</h3>
                  <div className="screening-list">
                    {applicationPackage.screeningAnswers.map((answer) => (
                      <article key={`${answer.key}-${answer.question}`}><strong>{answer.question}</strong><p>{answer.answer}</p><small>{answer.source === "answer-library" ? "Saved Answer Library" : "Generated draft · review before use"}</small></article>
                    ))}
                  </div>

                  <h3>Downloads</h3>
                  <div className="artifact-list">
                    {applicationPackage.artifacts.map((artifact) => <a key={artifact.id} href={`${API_BASE}${artifact.downloadUrl}`}>{artifact.filename}</a>)}
                  </div>
                </div>
              )}
            </section>

            {applicationPackage && selectedApplication && (
              <section className="application-assistant">
                <div className="package-heading">
                  <div><span className="eyebrow">M4.1 ADAPTIVE APPLICATION ASSISTANT</span><h3>Fill the real employer form</h3></div>
                  <span className={`browser-pill ${browserSession?.active ? "active" : "idle"}`}>{browserSession?.active ? "Browser open" : selectedApplication.state === "SUBMITTED" ? "Submitted" : "Browser closed"}</span>
                </div>
                <p className="muted">ApplyLite uses labels, name/id, placeholder, autocomplete, ARIA metadata and learned ATS mappings to fill high-confidence fields. If you manually correct a field, click Fill current step again so ApplyLite can learn that mapping. Final Submit, legal terms and sensitive questions always remain manual. M10.6 can also draft answers from the actual open-ended questions visible on the employer form.</p>

                {selectedApplication.state !== "SUBMITTED" && !browserSession?.active && (
                  <button
                    className="primary package-generate"
                    onClick={() => startBrowser(selectedApplication.id)}
                    disabled={browserLoading || !applicationPackage.generation.readyToUse}
                    title={!applicationPackage.generation.readyToUse ? "Regenerate the degraded package before opening the employer form." : undefined}
                  >
                    {browserLoading ? "Opening employer form..." : !applicationPackage.generation.readyToUse ? "Regenerate package before opening" : "Open & fill application"}
                  </button>
                )}

                {browserSession?.active && (
                  <div className="browser-session">
                    <div className="browser-summary">
                      <div><span>ATS</span><strong>{browserSession.ats}</strong></div>
                      <div><span>Filled</span><strong>{browserSession.filled.length}</strong></div>
                      <div><span>Uploads</span><strong>{browserSession.uploaded.length}</strong></div>
                      <div><span>Needs you</span><strong>{browserSession.unknownQuestions.length + browserSession.manualQuestions.length}</strong></div>
                    </div>

                    <div className="browser-current">
                      <strong>{browserSession.pageTitle || "Employer application"}</strong>
                      <a href={browserSession.finalUrl} target="_blank" rel="noreferrer">Current URL ↗</a>
                      <small>{browserSession.message}</small>
                    </div>

                    <div className="document-status">
                      <span>CV: <strong>{browserSession.resumeFilename || "not available"}</strong></span>
                      <span>Cover letter: <strong>{browserSession.coverLetterFilename || "not available / not requested"}</strong></span>
                    </div>

                    {(browserSession.captchaDetected || browserSession.loginDetected || browserSession.submitDetected) && (
                      <div className="browser-warnings">
                        {browserSession.captchaDetected && <p><strong>Human verification:</strong> complete the CAPTCHA manually in Chromium, then click Fill current step.</p>}
                        {browserSession.loginDetected && <p><strong>Authentication:</strong> sign in or create the account manually, then click Fill current step.</p>}
                        {browserSession.submitDetected && <p><strong>Final control detected:</strong> review every answer in Chromium. Only you should click Submit/Send Application.</p>}
                      </div>
                    )}

                    {browserSession.formAnswerDrafts.length > 0 && (
                      <div className="screening-list live-form-drafts">
                        <strong>Answers drafted from the live employer form</strong>
                        <p className="muted">These use your verified CV/profile evidence and the actual questions currently visible in Chromium. Review them before submission.</p>
                        {browserSession.formAnswerDrafts.map((answer) => (
                          <article key={`live-${answer.key}-${answer.question}`}>
                            <strong>{answer.question}</strong>
                            <p>{answer.answer}</p>
                            <small>Live form draft · review before use</small>
                          </article>
                        ))}
                      </div>
                    )}

                    {browserSession.unknownQuestions.length > 0 && (
                      <div className="m4-question-list"><strong>Unknown questions</strong>{browserSession.unknownQuestions.slice(0, 12).map((question) => <span key={`unknown-${question}`}>{question}</span>)}</div>
                    )}
                    {browserSession.manualQuestions.length > 0 && (
                      <div className="m4-question-list manual"><strong>Manual / sensitive / legal</strong>{browserSession.manualQuestions.slice(0, 12).map((question) => <span key={`manual-${question}`}>{question}</span>)}</div>
                    )}

                    {browserSession.fieldResults.length > 0 && (
                      <details className="m4-field-details">
                        <summary>Field intelligence ({browserSession.fieldResults.length})</summary>
                        <div className="m4-field-results">
                          {browserSession.fieldResults.slice(0, 24).map((field, index) => (
                            <div className="m4-field-result" key={`${field.label}-${index}`}>
                              <strong>{field.label}</strong>
                              <span>{field.status}{field.fieldKey ? ` · ${field.fieldKey}` : ""}</span>
                              <span>{field.confidence ? `${Math.round(field.confidence * 100)}%` : ""}{field.learned ? " · learned" : ""}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    <div className="m4-instructions">
                      <strong>Multi-step forms</strong>
                      <span>Review this step in Chromium. If there is a Next/Continue button, click it yourself, then return here and press Fill current step again.</span>
                    </div>

                    <div className="browser-actions">
                      <button className="primary" onClick={() => refillBrowser(selectedApplication.id)} disabled={browserLoading}>{browserLoading ? "Working..." : "Fill current step again"}</button>
                      {browserSession.unknownQuestions.length > 0 && (
                        <button onClick={() => draftBrowserAnswers(selectedApplication.id)} disabled={browserLoading}>Draft answers for unknown questions</button>
                      )}
                      <button onClick={() => closeBrowser(selectedApplication.id)} disabled={browserLoading}>Close browser</button>
                      <button className="submitted-button" onClick={() => markSubmitted(selectedApplication.id)} disabled={browserLoading}>I submitted it</button>
                    </div>
                  </div>
                )}

                {selectedApplication.state === "SUBMITTED" && <div className="submitted-confirmation"><strong>Application marked submitted</strong><span>This status was set only after manual confirmation.</span></div>}
              </section>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
