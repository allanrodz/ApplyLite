# M3 — Application Packages

## Goal

Turn a scored job plus verified candidate facts into a reviewable local application package without fabricating resume content.

## Flow

```text
Saved job + requirements
        +
Structured CV facts
        +
Answer Library
        ↓
Evidence catalog with stable IDs
        ↓
Qwen selects resume evidence + drafts prose
        ↓
Server hydrates exact CV bullets/skills/dates
        ↓
Second Qwen factual-support audit
        ↓
PDF/TXT/JSON artifacts
        ↓
REVIEW_REQUIRED
```

## Evidence model

Candidate facts, job facts, and saved Answer Library values receive stable evidence IDs. Resume employment/project bullets are never accepted as free-form model output. The model can select their IDs and the server inserts the exact stored source text.

## Audit scope

The semantic audit checks newly generated prose:

- Resume professional summary
- Cover-letter paragraphs
- Generated screening answers

Exact-source resume bullets do not need semantic rewriting validation because they are hydrated directly from the stored CV facts.

## Artifact storage

Artifacts are stored under `storage/generated/` and downloaded through a path-confined API endpoint. The database stores package metadata and artifact references; prior package versions remain available on disk.

## Non-goals

M3 does not:

- submit applications
- answer sensitive demographic questions
- bypass CAPTCHAs or anti-bot controls
- invent missing skills or experience
- create employer accounts

Those remain outside M3.
