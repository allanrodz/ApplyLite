# ApplyLite M2.1 — CV experience + automatic job discovery

M2.1 upgrades the existing M2 installation in-place. It does **not** replace your `.env`, SQLite database, CV, profile, or answer library.

## What changes

### 1. CV-derived experience
ApplyLite now parses employment date ranges from the structured CV and calculates:

- total dated employment experience;
- technical experience;
- job-specific relevant experience;
- the exact employment entries used as evidence.

Overlapping jobs are counted only once. Job scoring uses CV-derived relevant experience when available and falls back to the manual `yearsExperience` profile field only when dated CV evidence cannot be calculated.

Existing jobs are re-scored when the dashboard loads, so old `profile currently records 0` messages should disappear.

### 2. Discover page
A new **Discover** tab scans public ATS job boards and finds candidate jobs automatically.

M2.1 supports:

- Lever public Postings API;
- Ashby public Job Postings API;
- Greenhouse public Job Board API.

It starts with two small example sources:

- Dun & Bradstreet (Lever)
- ZeroRisk (Ashby)

Every supported job URL you manually import is also learned as a future discovery source.

### 3. Two-stage ranking
Discovery does **not** send hundreds of postings to Qwen.

1. Fast local pre-filter using title, location, skills and seniority.
2. Deep local Qwen extraction/scoring only for the top candidates.

The default deep-analysis cap is 6 jobs per run and can be changed in the UI.

## Upgrade

Stop ApplyLite with `Ctrl+C`.

From PowerShell:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m2-1-upgrade.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"

npm run typecheck
npm run dev
```

No `npm install` is expected because M2.1 adds no npm dependencies.

## First test

1. Open `http://localhost:5173`.
2. Open **Discover**.
3. Confirm CV-derived technical experience appears.
4. Leave the default sources enabled.
5. Set target titles and locations if needed.
6. Keep minimum final fit at `60` and deep analyses at `6` for the first run.
7. Click **Find jobs now**.

The first discovery run can take a while because each shortlisted job is analysed sequentially by the local Qwen model. The UI deliberately limits how many jobs reach that stage.

## Adding more employers

Paste any public job or board URL from a supported ATS into **Discovery sources**. Examples:

```text
https://jobs.lever.co/company-name
https://jobs.ashbyhq.com/company-name
https://job-boards.greenhouse.io/company-name
```

You can also paste an individual job URL from those ATSs. ApplyLite extracts the board identifier automatically.

## Current scope

M2.1 discovers jobs from known public employer boards. It does not yet search the whole web for new employer boards. A later discovery milestone can add web-wide source discovery and scheduled scans after this board-based layer is stable.
