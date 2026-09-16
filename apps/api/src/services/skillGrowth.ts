import { z } from "zod";
import { CandidateFactsSchema, JobRequirementsSchema, ProfileSchema, SkillLearningPlanSchema, type SkillGrowthItem, type SkillLearningPlan } from "@apply-lite/shared";
import { db } from "../db/database.js";
import { askOllamaStructured } from "./ollama.js";

const PlanModelSchema = z.object({
  whyNow: z.string(),
  prerequisites: z.array(z.string()).max(6),
  objectives: z.array(z.string()).min(3).max(7),
  project: z.object({
    title: z.string(),
    goal: z.string(),
    milestones: z.array(z.string()).min(3).max(7),
    deliverables: z.array(z.string()).min(2).max(7),
    stretchGoals: z.array(z.string()).max(5),
    portfolioProof: z.array(z.string()).min(2).max(6)
  })
});

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9+#./\- ]/g, " ").replace(/\s+/g, " ").trim();
}

const aliases = [
  ["javascript", "js"], ["typescript", "ts"], ["node.js", "nodejs", "node js"],
  ["react", "react.js", "reactjs"], ["postgresql", "postgres"], ["aws", "amazon web services"],
  ["gcp", "google cloud", "google cloud platform", "google compute engine"], ["ci/cd", "cicd", "continuous integration", "continuous delivery"],
  ["machine learning", "ml"], ["artificial intelligence", "ai"], ["kubernetes", "k8s", "gke"]
];

function canonical(value: string) {
  const n = normalize(value);
  for (const group of aliases) if (group.some((item) => normalize(item) === n)) return normalize(group[0]);
  return n;
}

function candidateSkillEvidence() {
  const profileRow = db.prepare("SELECT data_json AS dataJson FROM profile WHERE id = 1").get() as { dataJson: string } | undefined;
  const profile = profileRow ? ProfileSchema.parse(JSON.parse(profileRow.dataJson)) : ProfileSchema.parse({});
  const cvRow = db.prepare("SELECT facts_json AS factsJson FROM cv_documents ORDER BY id DESC LIMIT 1").get() as { factsJson: string } | undefined;
  const facts = cvRow ? CandidateFactsSchema.safeParse(JSON.parse(cvRow.factsJson)) : null;
  const factData = facts?.success ? facts.data : null;
  const evidence = new Map<string, string[]>();
  const add = (skill: string, source: string) => {
    const key = canonical(skill);
    if (!key) return;
    const list = evidence.get(key) ?? [];
    if (!list.includes(source)) list.push(source);
    evidence.set(key, list);
  };
  profile.skills.forEach((skill) => add(skill, "Saved profile"));
  factData?.skills.forEach((skill) => add(skill, "CV skills"));
  factData?.projects.forEach((project) => project.technologies.forEach((skill) => add(skill, `Project: ${project.name}`)));
  return { profile, facts: factData, evidence };
}

export function buildSkillGrowthOverview() {
  const { evidence } = candidateSkillEvidence();
  const rows = db.prepare("SELECT title, company, analysis_json AS analysisJson FROM jobs WHERE analysis_json <> '{}' ORDER BY score DESC").all() as Array<{ title: string; company: string; analysisJson: string }>;
  const demand = new Map<string, { display: string; required: number; preferred: number; jobs: Set<string> }>();
  for (const row of rows) {
    const parsed = JobRequirementsSchema.safeParse(JSON.parse(row.analysisJson));
    if (!parsed.success) continue;
    const jobName = `${row.title} · ${row.company}`;
    for (const [kind, skills] of [["required", parsed.data.requiredSkills], ["preferred", parsed.data.preferredSkills]] as const) {
      for (const skill of skills) {
        const key = canonical(skill);
        if (!key) continue;
        const current = demand.get(key) ?? { display: skill, required: 0, preferred: 0, jobs: new Set<string>() };
        if (kind === "required") current.required += 1; else current.preferred += 1;
        current.jobs.add(jobName);
        if (skill.length < current.display.length) current.display = skill;
        demand.set(key, current);
      }
    }
  }
  const evidenceFor = (key: string) => {
    const matches: string[] = [];
    for (const [candidateKey, sources] of evidence.entries()) {
      if (candidateKey === key || candidateKey.includes(key) || key.includes(candidateKey)) {
        for (const source of sources) if (!matches.includes(source)) matches.push(source);
      }
    }
    return matches;
  };
  const items: SkillGrowthItem[] = [...demand.entries()].map(([key, value]) => {
    const matchedEvidence = evidenceFor(key);
    const existing = matchedEvidence.length > 0;
    const status: SkillGrowthItem["status"] = existing ? "existing" : "missing";
    return {
      skill: value.display,
      status,
      priority: Math.round((value.required * 3 + value.preferred * 1.25) * 10) / 10,
      requiredCount: value.required,
      preferredCount: value.preferred,
      totalJobCount: value.jobs.size,
      exampleJobs: [...value.jobs].slice(0, 4),
      evidence: matchedEvidence
    };
  }).sort((a, b) => b.priority - a.priority || b.totalJobCount - a.totalJobCount);
  return {
    missing: items.filter((item) => item.status === "missing").slice(0, 30),
    deepen: items.filter((item) => item.status === "existing").slice(0, 30),
    jobsAnalyzed: rows.length,
    candidateSkillCount: evidence.size,
    generatedAt: new Date().toISOString()
  };
}

const resources: Array<{ match: RegExp; items: Array<{ title: string; type: "official-docs" | "tutorial" | "reference"; url: string; note: string }> }> = [
  { match: /fastapi/i, items: [{ title: "FastAPI Tutorial", type: "official-docs", url: "https://fastapi.tiangolo.com/tutorial/", note: "Build APIs progressively from fundamentals to deployment." }] },
  { match: /langchain/i, items: [{ title: "LangChain Documentation", type: "official-docs", url: "https://python.langchain.com/docs/", note: "Core concepts, retrieval, tools and agents." }] },
  { match: /langgraph/i, items: [{ title: "LangGraph Documentation", type: "official-docs", url: "https://langchain-ai.github.io/langgraph/", note: "Stateful agent workflows and graph orchestration." }] },
  { match: /kubernetes|gke/i, items: [{ title: "Kubernetes Tutorials", type: "official-docs", url: "https://kubernetes.io/docs/tutorials/", note: "Hands-on cluster, workload and service tutorials." }] },
  { match: /terraform/i, items: [{ title: "HashiCorp Terraform Tutorials", type: "tutorial", url: "https://developer.hashicorp.com/terraform/tutorials", note: "Official hands-on infrastructure-as-code tutorials." }] },
  { match: /vertex ai/i, items: [{ title: "Vertex AI Documentation", type: "official-docs", url: "https://cloud.google.com/vertex-ai/docs", note: "Google Cloud model development and deployment docs." }] },
  { match: /gcp|google cloud/i, items: [{ title: "Google Cloud Documentation", type: "official-docs", url: "https://cloud.google.com/docs", note: "Official product and architecture documentation." }] },
  { match: /docker/i, items: [{ title: "Docker Get Started", type: "official-docs", url: "https://docs.docker.com/get-started/", note: "Containers, images, Compose and deployment basics." }] },
  { match: /github actions|ci\/cd/i, items: [{ title: "GitHub Actions Documentation", type: "official-docs", url: "https://docs.github.com/actions", note: "Workflow syntax, CI/CD patterns and deployment automation." }] },
  { match: /pytest/i, items: [{ title: "pytest Documentation", type: "official-docs", url: "https://docs.pytest.org/", note: "Fixtures, parametrization, plugins and test architecture." }] },
  { match: /python/i, items: [{ title: "Python Tutorial", type: "official-docs", url: "https://docs.python.org/3/tutorial/", note: "Official language tutorial and standard-library reference." }] },
  { match: /react/i, items: [{ title: "React Learn", type: "official-docs", url: "https://react.dev/learn", note: "Official modern React learning path." }] },
  { match: /typescript/i, items: [{ title: "TypeScript Handbook", type: "official-docs", url: "https://www.typescriptlang.org/docs/handbook/intro.html", note: "Official language handbook." }] },
  { match: /node/i, items: [{ title: "Node.js Learn", type: "official-docs", url: "https://nodejs.org/en/learn", note: "Official Node.js guides." }] },
  { match: /firebase/i, items: [{ title: "Firebase Documentation", type: "official-docs", url: "https://firebase.google.com/docs", note: "Official Firebase product documentation and guides." }] },
  { match: /prometheus/i, items: [{ title: "Prometheus Documentation", type: "official-docs", url: "https://prometheus.io/docs/introduction/overview/", note: "Metrics, querying and monitoring concepts." }] },
  { match: /grafana/i, items: [{ title: "Grafana Tutorials", type: "tutorial", url: "https://grafana.com/tutorials/", note: "Dashboards, observability and visualization tutorials." }] },
  { match: /scikit|machine learning/i, items: [{ title: "scikit-learn User Guide", type: "official-docs", url: "https://scikit-learn.org/stable/user_guide.html", note: "Algorithms, model selection and practical examples." }] }
];

function materialsFor(skill: string) {
  const matched = resources.find((entry) => entry.match.test(skill));
  if (matched) return matched.items;
  const query = encodeURIComponent(`${skill} official documentation tutorial`);
  return [{ title: `${skill} official documentation search`, type: "search" as const, url: `https://www.google.com/search?q=${query}`, note: "Use this to find the official documentation or maintainer tutorial." }];
}

function fallbackPlan(skill: string, mode: "learn" | "deepen", currentEvidence: string[]): SkillLearningPlan {
  const title = mode === "learn" ? `Build a practical ${skill} portfolio project` : `Deepen ${skill} with a production-style project`;
  return SkillLearningPlanSchema.parse({
    skill, mode,
    whyNow: mode === "learn" ? `${skill} appears repeatedly in jobs you are evaluating but is not yet verified in your CV.` : `${skill} already appears in your evidence and is also demanded by jobs, so deeper proof can strengthen future applications.`,
    currentEvidence,
    prerequisites: [],
    objectives: [`Understand the core ${skill} concepts used in production`, `Build one working end-to-end example with ${skill}`, `Add testing, documentation and a repeatable setup`, `Explain the trade-offs and architecture in a README`],
    project: {
      title,
      goal: `Create a small but complete project that demonstrates practical ${skill} ability and can be linked from your CV or portfolio.`,
      milestones: ["Define a narrow real-world use case and acceptance criteria", `Implement the core solution using ${skill}`, "Add tests, logging or validation appropriate to the project", "Document setup, architecture and decisions", "Publish screenshots/results and a concise portfolio write-up"],
      deliverables: ["GitHub repository with clear README", "Runnable local demo", "Automated tests or validation", "Architecture/decision notes"],
      stretchGoals: ["Add CI/CD", "Containerize the project", "Measure performance or reliability"],
      portfolioProof: [`A README explaining where ${skill} is used`, "A reproducible demo", "Evidence of tests and engineering quality"]
    },
    materials: materialsFor(skill), status: "suggested", createdAt: new Date().toISOString()
  });
}

export async function generateSkillLearningPlan(skill: string): Promise<SkillLearningPlan> {
  const overview = buildSkillGrowthOverview();
  const item = [...overview.missing, ...overview.deepen].find((entry) => canonical(entry.skill) === canonical(skill));
  const mode: "learn" | "deepen" = item?.status === "existing" ? "deepen" : "learn";
  const currentEvidence = item?.evidence ?? [];
  const context = item ? `Demand: required in ${item.requiredCount} jobs, preferred in ${item.preferredCount}. Example jobs: ${item.exampleJobs.join("; ")}` : "No aggregated job context available.";
  const prompt = `Create a concise practical learning plan for the skill "${skill}". The learner is building a software/AI engineering portfolio. ${context}\nMode: ${mode}. Existing evidence: ${currentEvidence.join("; ") || "none verified"}.\nThe project must be achievable locally, portfolio-worthy, and should combine the target skill with existing software engineering practices. Do not invent certifications or claim the learner already knows the skill. Return only the requested structured fields.`;
  let model: z.infer<typeof PlanModelSchema>;
  try {
    model = PlanModelSchema.parse(await askOllamaStructured<unknown>(prompt, z.toJSONSchema(PlanModelSchema), { numPredict: 1100, numCtx: 4096, timeoutMs: 75_000 }));
  } catch {
    const fallback = fallbackPlan(skill, mode, currentEvidence);
    db.prepare(`INSERT INTO skill_learning_plans (skill, mode, status, plan_json) VALUES (?, ?, ?, ?) ON CONFLICT(skill) DO UPDATE SET mode=excluded.mode, plan_json=excluded.plan_json, updated_at=CURRENT_TIMESTAMP`).run(skill, mode, fallback.status, JSON.stringify(fallback));
    return fallback;
  }
  const plan = SkillLearningPlanSchema.parse({ ...model, skill, mode, currentEvidence, materials: materialsFor(skill), status: "suggested", createdAt: new Date().toISOString() });
  db.prepare(`INSERT INTO skill_learning_plans (skill, mode, status, plan_json) VALUES (?, ?, ?, ?) ON CONFLICT(skill) DO UPDATE SET mode=excluded.mode, plan_json=excluded.plan_json, updated_at=CURRENT_TIMESTAMP`).run(skill, mode, plan.status, JSON.stringify(plan));
  return plan;
}

export function listSkillLearningPlans() {
  const rows = db.prepare("SELECT skill, status, plan_json AS planJson FROM skill_learning_plans ORDER BY updated_at DESC").all() as Array<{ skill: string; status: string; planJson: string }>;
  return rows.flatMap((row) => {
    try {
      const parsed = SkillLearningPlanSchema.parse({ ...JSON.parse(row.planJson), status: row.status });
      return [parsed];
    } catch { return []; }
  });
}

export function setLearningPlanStatus(skill: string, status: string) {
  const result = db.prepare("UPDATE skill_learning_plans SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE skill = ?").run(status, skill);
  return result.changes > 0;
}
