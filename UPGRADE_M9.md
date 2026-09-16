# ApplyLite M9 — Production Hardening

M9 does not add another job-search workflow. It hardens the M0–M8 system so real usage can accumulate safely.

## What M9 adds

- **System & Recovery** page with a local doctor for SQLite, storage, disk space, Ollama/model, Playwright Chromium, CV availability, discovery sources, M6 scheduler, M7 worker and backups.
- **One-click backups** of the live SQLite database plus `storage/` generated files. `.env`, secrets, node modules and prior backups are excluded.
- **Staged restore**: select an ApplyLite backup, stage it, then restart ApplyLite. Before replacement, the current database/storage is copied into a recovery folder.
- **Schema version 9 + migration ledger**, with a pre-migration SQLite snapshot and transactional M9 migration.
- **Crash recovery** for interrupted M6 briefs, M7 generation, and browser/application states.
- **CSV and JSON application-history exports**. JSON includes tracker timeline events.
- **Protected local reset** requiring the exact phrase `RESET APPLYLITE`; a backup is created before deletion.
- **Run diagnostics** for recent M6 discovery and M7 preparation activity.
- **Offline M9 regression harness** using a local mock employer form. It checks first name/email/location autofill, manual legal consent, SQLite integrity, and the invariant that final Submit is detected but never clicked.
- **Windows launcher** (`Start ApplyLite.cmd`) that checks Node/npm, tries to start Ollama when needed, opens the UI, and runs ApplyLite.

## Upgrade

Stop the running app with `Ctrl+C`, then from PowerShell:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m9-upgrade.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"

npm run typecheck
```

If clean:

```powershell
npm run dev
```

The app version should be `0.13.0`.

## First M9 validation

1. Open **System & Recovery**.
2. Confirm SQLite, storage and Chromium are green. Ollama should also be green while it is running.
3. Click **Create backup now**.
4. Confirm the new archive appears in the backup list and can be downloaded.
5. Export application history as CSV or JSON.
6. Run the regression harness after stopping the dev server (or in a second terminal):

```powershell
npm run regression:m9
```

Expected final lines include:

```text
M9 regression PASS
Safety invariant: final submit was detected but not clicked.
```

## Restore behavior

Restore is intentionally two-step:

1. Click **Restore** beside a backup. M9 extracts and validates it into a pending-restore area.
2. Stop ApplyLite with `Ctrl+C` and start it again.

On startup M9:

- copies your current database/storage into `backups/recovery/...`;
- applies the selected backup;
- removes the pending restore marker;
- runs normal schema migrations if the restored backup is older.

This avoids replacing a SQLite database while the API is actively using it.

## Migration safety

M9 introduces `PRAGMA user_version = 9` and a `schema_migrations` ledger. The first M9 startup creates a pre-migration database snapshot before applying the M9 schema transaction.

Future schema changes can extend this migration framework instead of relying only on ad-hoc `ALTER TABLE` checks.

## Data reset

The reset control is intentionally hard to trigger. It requires:

```text
RESET APPLYLITE
```

M9 creates a `pre-reset` backup first, then deletes candidate/profile/CV/jobs/applications/packages/learning/mapping/interview data. Discovery source definitions remain installed, while autonomous scheduling/preparation are disabled.

## No autonomy boundary changes

M9 does **not** enable final application submission. The existing boundary remains:

- autonomous discovery: allowed;
- autonomous package preparation: opt-in;
- browser form filling: review-assisted;
- final Submit: user only.
