# M2.1 — Experience-aware automatic discovery

## Goals

- Stop using a default `0` profile value when dated CV employment can provide stronger evidence.
- Discover jobs without requiring the user to paste every individual posting URL.
- Keep the system local-first and inexpensive by avoiding unnecessary LLM calls.

## Experience model

Employment date ranges are converted to month intervals and merged before totals are calculated. This avoids double-counting concurrent jobs.

Three values are derived:

- **totalYears** — all parseable employment;
- **technicalYears** — employment with technical role, bullet or skill evidence;
- **relevantYears** — employment relevant to the specific job being scored.

Job scoring uses `relevantYears` when available. The manual profile experience value is only a fallback.

## Discovery source model

Supported source identifiers:

- Lever site name from `jobs.lever.co/{site}`;
- Ashby board name from `jobs.ashbyhq.com/{board}`;
- Greenhouse board token from `job-boards.greenhouse.io/{board}` or `boards.greenhouse.io/{board}`.

Sources are stored in SQLite. Supported URLs imported through M2 are learned automatically.

## Discovery pipeline

```text
public ATS boards
      ↓
normalize postings
      ↓
deduplicate against saved jobs
      ↓
cheap deterministic pre-score
  title + location + skill mentions + seniority
      ↓
top N only
      ↓
Qwen structured job extraction
      ↓
full CV-aware scoring
      ↓
final-fit threshold
      ↓
save new matches to jobs table
```

## Safety / reliability

- Only public read APIs are used for discovery.
- No application is submitted.
- No CAPTCHA or anti-bot bypass is attempted.
- Full Qwen analysis is bounded per run.
- Candidate experience remains evidence-backed by CV date ranges.
