# ApplyLite M3 — Evidence-grounded application packages

M3 adds one-click application package generation for any saved job.

## What it generates

- Tailored ATS-friendly CV PDF + TXT
- Tailored cover letter PDF + TXT
- Screening-answer draft pack TXT
- Evidence audit JSON
- Full package JSON

The resume is intentionally safer than a normal AI rewrite: Qwen selects evidence IDs, while the server inserts exact stored CV employment/project bullets, skills, employers, dates, and education. Generated prose (summary, cover letter, generated screening answers) receives a second evidence-audit pass.

## Install

Stop ApplyLite, then extract this ZIP over your existing project folder:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m3-upgrade.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

No new npm packages are required. Playwright Chromium and Ollama are reused from earlier milestones.

## Use

1. Open Dashboard.
2. Open a job's **Details** drawer.
3. Scroll to **M3 Application Package**.
4. Click **Generate application package**.
5. Review the evidence audit and previews.
6. Download the PDF/TXT/JSON artifacts.

Generated files live locally under:

```text
storage/generated/job-<jobId>/package-<packageId>/
```

## Safety behavior

- Exact CV employment/project bullets are reused from stored CV evidence; the model does not author replacement bullets.
- Skill selections must point to stored candidate skill evidence.
- Summary, cover-letter paragraphs, and generated screening answers carry evidence IDs.
- A second local Qwen pass checks factual support.
- Unsupported or unaudited claims are shown as **REVIEW** flags.
- Application state moves to `REVIEW_REQUIRED`; M3 never submits a form.

## If generation times out

M3 performs a generation pass plus an evidence-audit pass. If your local model needs more time, increase in `.env`:

```text
OLLAMA_TIMEOUT_MS=300000
```

Then restart `npm run dev`.
