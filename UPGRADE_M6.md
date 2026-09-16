# ApplyLite M6 — Daily Autonomous Discovery

M6 turns discovery into a repeatable daily workflow. It does not auto-apply. The local API scheduler scans enabled public ATS boards once per day, reuses the existing M2/M5.1 discovery engine, and creates a small Daily Brief for manual review.

## What is new

- Daily Brief page in the sidebar.
- Local daily scheduler with enable/disable and local run time.
- Catch-up on startup: if ApplyLite was closed at the scheduled time, it runs after the next API start once the scheduled time has passed.
- Uses existing Lever, Ashby and Greenhouse discovery sources.
- Uses M5.1 outcome-aware ranking when enough outcome history exists.
- Daily settings for titles, locations, prefilter threshold, final fit threshold, deep-analysis budget, AI concurrency and shortlist size.
- Persists every daily run and its shortlist.
- Jobs with existing application records are excluded from Daily Briefs.
- A job appears in a Daily Brief at most once; reviewed/dismissed jobs are not recycled into future briefs.
- Daily Brief cards show base fit, outcome adjustment, ranked fit, matched required skills, unverified required skills and deterministic reasons.
- Manual `Run today's discovery now` button.
- Review / dismiss state for each Daily Brief item.
- No automatic package generation or final application submission.

## Install

Stop the current dev server, then extract the M6 ZIP over the existing ApplyLite folder.

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m6-upgrade.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"

npm run typecheck
```

If typecheck is clean:

```powershell
npm run dev
```

Expected version:

```text
apply-lite@0.10.0
```

## First setup

Open **Daily Brief** from the sidebar.

Recommended starting values:

- Automation: off until you review the settings.
- Local run time: 08:00.
- Minimum final fit: 60.
- Deep analyses: 6.
- AI concurrency: 2.
- Daily shortlist: 5.
- Outcome learning: enabled.

Target titles and locations are initially resolved from your saved Profile.

After saving, enable automation when you are happy with the configuration.

## Local scheduling behavior

The scheduler lives inside the ApplyLite API process. It therefore cannot run while the API/computer is completely off.

M6 handles this with catch-up behavior:

- API running at scheduled time -> discovery runs then.
- API starts after scheduled time and no run happened today -> discovery runs shortly after startup.
- API starts before scheduled time -> waits until the configured local time.
- Manual Run now -> counts as today's run, preventing a duplicate scheduled scan later that day.

If a scheduled run fails, the error is shown in Daily Brief. Use **Run today's discovery now** to retry manually.

## Database additions

M6 adds three local SQLite tables:

- `daily_discovery_settings`
- `daily_discovery_briefs`
- `daily_discovery_items`

Existing jobs, applications, packages, CV facts, field mappings, skill-growth plans and outcome-learning history remain unchanged.

## Safety boundary

M6 performs discovery and ranking only. It does not:

- generate application packages automatically,
- open employer application forms automatically,
- fill application forms automatically,
- click final submit.

Those remain deliberate review actions in the existing M3/M4 workflow.
