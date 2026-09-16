# M9 — Production Hardening Architecture

## Goal

Protect ApplyLite's accumulated career data and make autonomous M6/M7 operation diagnosable and recoverable before further feature expansion.

## System doctor

`GET /system/doctor` performs lightweight local checks:

- SQLite `quick_check`;
- write access to configured storage;
- free disk space;
- Ollama reachability and configured model presence;
- Playwright Chromium executable presence;
- CV availability;
- enabled/failing discovery sources;
- M6 scheduler state;
- M7 worker queue/failures;
- backup availability.

The doctor does not call external employer sites.

## Backups

`POST /system/backups`:

1. checkpoints SQLite WAL;
2. uses `better-sqlite3` online backup into a staging directory;
3. copies generated `storage/` files;
4. writes `manifest.json` with app/schema version and row counts;
5. archives the staging directory;
6. deletes staging files.

Windows uses PowerShell `Compress-Archive`; non-Windows development environments use `tar.gz`.

Secrets are not included.

## Restore

Live in-place database replacement is deliberately avoided.

`POST /system/backups/:name/restore` extracts and validates an archive into `.maintenance/restore-pending-data` and writes a restore marker. Before SQLite is opened on the next process start, `database.ts`:

1. saves the current DB/storage to `backups/recovery/<timestamp>`;
2. replaces the database with the staged snapshot;
3. replaces generated storage;
4. removes pending restore files;
5. lets the normal initialization/migration path continue.

## Migration framework

M9 establishes schema version **9** with:

- SQLite `user_version`;
- `schema_migrations` ledger;
- pre-migration snapshot;
- transactional M9 migration.

Existing M0–M8 creation/compatibility logic remains intact so older databases can still open.

## Restart recovery

At database initialization M9 recovers interrupted local state:

- M7 `GENERATING` queue items → `QUEUED`;
- M6 `RUNNING` briefs → `INTERRUPTED`;
- `FILLING`/`SUBMITTING` applications → `REVIEW_REQUIRED` because browser state cannot survive process exit;
- orphaned `TAILORING` applications without an M7 queue item → `FAILED` with a retry message.

Recovery is recorded in `maintenance_events`.

## Diagnostics

`GET /system/diagnostics` exposes bounded recent operational history from:

- `discovery_runs`;
- `daily_discovery_briefs`;
- `application_prep_queue`;
- `maintenance_events`.

The UI intentionally shows enough detail to diagnose cache usage, AI request count, run duration and preparation failure messages without becoming a full log viewer.

## Exports

M9 provides portable application history:

- CSV: flat application/job/outcome rows;
- JSON: application rows plus tracker timeline events.

These exports are separate from full backups and are meant for user-readable portability/analysis.

## Regression harness

`npm run regression:m9` launches a local headless Chromium page containing a mock employer form and verifies:

- first name autofill;
- email autofill;
- location autofill;
- legal consent checkbox remains untouched;
- final submit control is detected but not clicked;
- SQLite `quick_check` passes.

It uses an isolated temporary database/storage location and deletes them on completion.

## New persistent table

M9 adds:

```text
schema_migrations
maintenance_events
```

All M0–M8 domain tables remain unchanged.
