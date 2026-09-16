# ApplyLite M10.3 - Irish-market discovery

M10.3 fixes the two issues exposed by the first 16-board live run: generic `remote` could admit US-scoped roles, and six deep-analysis slots were too small for a 50+ candidate prefilter queue.

## Changes

- Version `0.14.3`.
- Adds JobsIreland as a first-party Irish vacancy source.
- Adds IrishJobs as a low-volume public search source.
- Adds BearingPoint Ireland and Ridgeline direct Greenhouse boards.
- Disables the stale built-in Whatnot Ashby source that currently returns 404. Manually learned sources are never disabled by this rule.
- Strict remote geography: `US - Remote`, `United States`, etc. no longer pass an Ireland/Dublin search just because they contain the word `remote`.
- Ireland, Dublin, Europe/EMEA and genuinely unscoped remote roles remain eligible.
- New default deep-analysis budget is 12 instead of 6 for new/manual discovery settings.
- Employer diversity remains capped at two first-pass Qwen slots per employer.

## Important existing-setting note

Your M6 Daily Brief settings are persisted in SQLite. If they currently say `Deep analyses/day = 6`, M10.3 does not silently overwrite your choice. Change that setting to `12` before tomorrow's scheduled run.

## Install

Stop ApplyLite first, then:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m10-3-irish-discovery.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"

npm run typecheck
npm run regression:discovery
```

Expected regression ending:

```text
Discovery coverage regression PASS
Starter sources: 20
Relevance gate: software/project matches preserved; unrelated engineering/management titles rejected.
Location gate: US-scoped remote rejected; Ireland/Europe/generic remote preserved.
Diversity: runtime discovery caps the first pass at two deep-analysis slots per employer.
```

Then:

```powershell
npm run dev
```

The app should report `apply-lite@0.14.3`.

## Before tomorrow

1. Open **Daily Brief**.
2. Set **Deep analyses/day** to **12** and save.
3. Keep the minimum final fit at **60%** for now.
4. Open **Discover** and confirm JobsIreland, IrishJobs, BearingPoint Ireland and Ridgeline appear in the source list.
5. Run one manual discovery.

## Why not scrape Indeed directly?

Indeed's current developer APIs are partner/employer integration APIs rather than a general public job-search feed. M10.3 therefore does not make the daily autonomous workflow depend on an unofficial Indeed scraper that may be blocked or change without notice. Gmail job alerts can remain a separate lead source later if we decide they add useful coverage.

## Validation done in the build environment

- TypeScript/TSX syntax transpile: clean for all changed source files.
- Regression harness now checks 20 seeded sources and the strict remote-location behavior.
- No schema migration and no existing application/job/Gmail data is deleted.
