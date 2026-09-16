# M7 — Autonomous Application Preparation + Review Queue

## Goal

Close the gap between M6 discovery and M4 browser assistance without crossing the user's final-review boundary.

M7 converts selected Daily Brief recommendations into reviewable application packages before the user sits down to apply.

## Flow

```text
M6 Daily Brief
    ↓
M7 eligibility gate
  - M7 enabled
  - score >= configured minimum
  - within daily package cap
  - not already terminal/submitted
    ↓
Persistent prep queue
    ↓
Sequential local worker
    ↓
M3 package workflow
  - evidence selection
  - tailored CV
  - cover letter
  - screening drafts
  - factual audit
    ↓
PASS   → READY
REVIEW → NEEDS_REVIEW
    ↓
Human review
    ↓
M4 visible browser assistant
    ↓
Human final Submit
```

## Why package generation is sequential

Application-package generation is one of ApplyLite's most expensive local-Qwen operations. M7 serializes both background and manual package generation through the same workflow queue. This avoids two package-generation jobs competing for Ollama RAM/CPU/GPU and reduces timeout risk.

M6 discovery completes before M7 queues background package work. The HTTP Daily Brief result does not wait for every M7 package to finish.

## Persistence and recovery

`application_prep_queue` stores every queued job and its current status. If ApplyLite shuts down while a package is `GENERATING`, database initialization returns that queue item to `QUEUED`. The worker continues after the API restarts.

If a package was already fully completed and the corresponding application reached `REVIEW_REQUIRED`, M7 reuses it instead of spending another Ollama generation cycle.

## Queue states

- `QUEUED` — waiting for the local worker.
- `GENERATING` — package generation/audit is running.
- `READY` — evidence audit PASS.
- `NEEDS_REVIEW` — package exists, but audit/warnings require attention.
- `FAILED` — generation failed and can be retried.
- `DISMISSED` — removed from active review without deleting the job/files.
- `SKIPPED` — reserved for non-eligible queue work.
- `SUBMITTED` — user later confirmed real employer submission through the existing M4 flow.

## Automatic eligibility

M7 settings are intentionally small:

- `enabled`
- `maxPackagesPerBrief` (1–5)
- `minScore` (0–100)

The M6 Daily Brief already handles target titles, locations, discovery limits and outcome-aware ranking. M7 does not duplicate those controls.

## Review Queue

Each prepared item exposes:

- frozen fit score;
- job/company/location;
- queue state;
- evidence-audit result and counts;
- tailored CV headline/summary;
- cover-letter opening;
- audit warnings;
- generated artifacts;
- original posting;
- M4 `Review & open application` action.

The employer browser is never launched by the background worker.

## Autonomy boundary

M7 is deliberately "prepare, don't submit" automation. User control remains mandatory for employer-site interaction and final submission.
