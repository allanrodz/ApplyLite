# ApplyLite M7 — Autonomous Application Preparation

M7 upgrades ApplyLite from autonomous discovery to autonomous **preparation**. It can take the strongest M6 Daily Brief matches and, in the background, generate the existing M3 evidence-grounded application package for a bounded number of jobs.

## What M7 adds

- `Review Queue` page in the sidebar.
- Optional automatic preparation after each completed M6 Daily Brief.
- Configurable minimum ranked-fit threshold.
- Configurable cap of 1–5 packages per Daily Brief.
- Persistent SQLite preparation queue.
- Sequential local worker so multiple expensive package generations do not compete for Ollama.
- Recovery of interrupted queue jobs after restart.
- PASS packages become `READY`; REVIEW-audit packages become `NEEDS_REVIEW`.
- Manual `Prepare application` from each Daily Brief item.
- Manual `Queue background prep` from a job's Dashboard details.
- Review Queue previews the tailored CV, cover-letter opening, evidence-audit summary, warnings and generated downloads.
- After review, M4 can be launched from the Review Queue with `Review & open application`.
- When the user confirms a real submission, the M7 queue item becomes `SUBMITTED`.

## Safety boundary

M7 does **not**:

- open employer websites automatically;
- click Next/Continue on an employer form;
- answer sensitive/legal/demographic questions automatically;
- click final Submit;
- mark an application submitted without the user's existing M4 confirmation action.

Automatic preparation is disabled by default.

## Install

Stop ApplyLite, then overlay the archive onto the existing project:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m7-upgrade.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"

npm run typecheck
npm run dev
```

Expected app/API/web version: `0.11.0`.

No new npm dependencies are required.

## First test

1. Open **Review Queue**.
2. Leave `Automatic preparation` off for the first test.
3. Pick an unsubmitted job with no package and either:
   - use **Dashboard → job details → Queue background prep**, or
   - use **Daily Brief → Prepare application**.
4. Open **Review Queue**.
5. The item should move through `QUEUED → GENERATING → READY` or `NEEDS REVIEW`.
6. Review the generated CV, cover letter, audit and downloads.
7. Click **Review & open application** only when satisfied.
8. M4 opens visible Chromium and still stops before final submission.

After this works, enable M7 and choose a conservative daily cap (recommended: 1–2 packages) and a high fit threshold.

## Database additions

M7 adds:

- `application_prep_settings`
- `application_prep_queue`

Existing jobs, CV facts, application packages, Daily Briefs, form mappings, tracker outcomes and skill plans are unchanged.
