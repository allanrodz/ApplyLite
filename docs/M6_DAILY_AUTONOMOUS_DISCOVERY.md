# M6 — Daily Autonomous Discovery

## Goal

Convert the existing manual Discovery action into a daily, local-first job-search routine without turning ApplyLite into an uncontrolled auto-apply bot.

## Pipeline

```text
Local scheduler
    ↓
Enabled ATS sources
    ↓
M2.2 cached discovery
    ↓
CV / job fit
    ↓
M5.1 outcome adjustment (when active)
    ↓
Minimum final fit threshold
    ↓
Fresh un-applied / never-briefed jobs
    ↓
Daily shortlist
    ↓
Manual review
```

## Scheduling

The API polls the schedule once per minute. A startup check runs shortly after the API starts.

A scheduled run is due when:

1. daily automation is enabled,
2. today's local time is at or after `run_time`, and
3. `last_run_date` is not today.

`last_run_date` is set when a daily run starts. This prevents multiple automatic runs caused by restarts during the same day.

## Discovery reuse

M6 calls the existing `runDiscovery()` service. It therefore inherits:

- concurrent source fetching,
- requirements cache,
- local prefiltering,
- bounded Qwen deep-analysis count,
- configurable Qwen concurrency,
- CV-derived experience,
- M5.1 outcome-aware ranking.

A process-level discovery lock prevents a manual Discovery run and a Daily Brief run from executing simultaneously.

## Freshness and deduplication

Daily Brief candidate selection excludes any job that:

- already has an application record, or
- has appeared in any previous `daily_discovery_items` row.

This means reviewed and dismissed Daily Brief jobs do not reappear on later days.

The first M6 brief may include strong jobs that were discovered before M6 but have never had an application and have never appeared in a Daily Brief. This prevents the first autonomous run from being artificially empty just because the database already contains useful jobs.

## Historical snapshots

Each Daily Brief item stores:

- ranked score snapshot,
- base score snapshot,
- outcome adjustment snapshot,
- deterministic reason list,
- rank within that day's brief.

This keeps the historical brief understandable even if the user's profile or outcome-learning model changes later.

## Tables

### daily_discovery_settings

Singleton scheduler configuration and last-run metadata.

### daily_discovery_briefs

One row per manual or scheduled Daily Brief execution.

### daily_discovery_items

Ranked jobs contained in a brief plus review/dismiss status.

## Review model

Daily Brief item status is one of:

- `NEW`
- `REVIEWED`
- `DISMISSED`

These statuses do not alter the application tracker. An application record is created only through the normal application workflow.

## Non-goals

M6 deliberately does not auto-generate CVs, auto-open applications, or auto-submit forms. Those can be considered as separate opt-in milestones after daily discovery reliability and resource usage are proven.
