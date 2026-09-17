# CV-to-discovery workflow plan

Baseline: main `9f367e26345899c503b6fb8c2ead6cbe5f905669` (0.15.0).

## Existing architecture and failure boundaries

React/Vite selects pages with component state; refresh resets Dashboard. Fastify uses a local SQLite database and existing background workers for preparation/daily discovery. CV drafts are separate from reviewed snapshots, but enhancement is an in-process action with a generic catch-all error. Local extraction recognizes only limited employment layouts. Manual discovery holds an HTTP request open and retains only shortlisted high-score jobs. Existing synthetic, browser and Windows updater regressions must continue to pass.

## Delivery slices

1. URL navigation, readiness endpoint, reusable setup guidance and user-initiated focus/scroll; route tests.
2. Deterministic CV sections/records, raw and normalized dates, explicit contact links, completeness findings, evidence-backed role suggestions and opt-in acceptance; fixture tests.
3. Provider-neutral text/structured requests, local Ollama plus opt-in Groq, protected server-side credentials, explicit consent and diagnostics, task-appropriate extraction schemas; mocked provider tests.
4. Persistent task execution for CV/discovery/deep analysis: 202 responses, resumable observation, counters, cancellation and interrupted-state recovery; API lifecycle tests.
5. Broad collection before optional display filtering; preserve quick/failed candidates, bounded AI, current-run membership, existing-job updates and score provenance; fixture and browser tests.
6. Integration, documentation, privacy and migration/update validation on Windows; PR with evidence and limitations, no automatic merge.

## Data and migration design

Add a versioned, additive schema migration for tasks, discovery-run membership, onboarding and AI preferences, and job score provenance. Preserve existing IDs, tables, reviewed CVs, applications, profile choices, env files and artifact paths. Make migrations idempotent, transactional and protected by a verified pre-migration SQLite snapshot. Never copy a live main DB without its WAL; never touch user databases for tests. Capture profile/CV input revisions and sources in job/task metadata.

Backend task state is authoritative; the UI polls and can reconnect after navigation or refresh. Browser closure does not stop server tasks. Backend stop, PC sleep and power-off are different: work is marked interrupted after restart and retried only through documented safe/idempotent handlers. Cancellation propagates to outbound fetches and stops new writes. No unbounded retry loops or fabricated progress percentages.

Collection stores valid deduplicated jobs before expensive analysis. Score thresholds are display filters, not ingestion gates. Quick scores are provisional; unknown requirements do not imply eligibility. No provider failure discards a collected job. Per-provider bounded concurrency prevents CV/discovery/preparation from overloading local AI.

## Privacy and correctness

CV/job-page contents are untrusted data, never instructions. Extracted factual fields require source evidence; preferences are separately confirmed. Raw dates are retained; unknown dates remain unknown, and overlapping intervals must not inflate experience. No inferred citizenship, protected attributes, sponsorship or salary preferences. Groq calls require explicit cloud consent; server secrets are not returned to the UI, logged, committed or included in ordinary exports. Remote configuration also requires explicit consent if a nominal Ollama URL is not loopback. All final employer submissions remain manual.

## Validation and limits

Run existing typechecks, build, reliability/discovery/edge-case tests, Gmail and browser-form regressions, browser CV/Profile tests and Windows updater tests. Add synthetic CV layouts, task/cancellation/restart, provider/consent, route/refresh, broad-discovery/filters, and a complete onboarding browser journey. Tests never require a paid key or a user's CV. Live LLM quality and speed must be reported separately from mocked API/contract tests. OCR, global job coverage and guaranteed eligibility are not promised. Read and cite current provider documentation; do not hard-code unverified free-tier guarantees.
