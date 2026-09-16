# ApplyLite Architecture

## Product loop

```text
Profile + Resume Facts + Answer Library
                  |
                  v
        Job Import / Discovery
                  |
                  v
      Hard Filters + Fit Score
                  |
                  v
       User Review / Approve
                  |
                  v
  Tailored CV + Cover Letter + Q&A
                  |
                  v
       Playwright ATS Adapter
                  |
                  v
        STOP BEFORE SUBMIT
                  |
                  v
       Manual Review + Submit
                  |
                  v
       Application Event Log
```

## Principles

1. Local-first and single-user.
2. Deterministic logic before LLM calls.
3. Candidate facts are immutable source-of-truth; AI may select/rephrase them, not invent them.
4. Unknown screening answers become `NEEDS_INPUT`.
5. Browser automation is adapter-based and resumable.
6. Submission remains manual until later milestones prove reliability.

## Components

### Web
React dashboard for jobs, profile, answer library and application queue.

### API
Fastify service exposing local endpoints and owning orchestration.

### SQLite
Stores profile, preferences, answer library, jobs, generated artifacts, applications and events.

### Ollama
Optional local model for structured requirement extraction, CV tailoring and draft answers.

### Playwright
Browser control layer. M0 provides the adapter contract and a conservative generic adapter.

## Future milestones

- M1: CV importer + structured resume facts
- M2: job URL extraction + ATS detection
- M3: tailored CV/cover letter generation
- M4: Greenhouse/Lever/Ashby form adapters
- M5: browser extension for one-click job capture
- M6: feedback-driven ranking and interview pipeline
