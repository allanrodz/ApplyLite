# ApplyLite M2.2 - Discovery performance upgrade

This overlay upgrades an existing working M2.1 installation in place. It does not replace your `.env`, SQLite database, CV, profile, answer library, or previously discovered jobs.

## What changes

- Fetch enabled Lever/Ashby/Greenhouse boards concurrently.
- Avoid repeated `jobs` table scans during deduplication.
- Use a smaller requirements-only Qwen task for discovery scoring.
- Cache requirement extraction for unchanged postings, including jobs that did not meet your final score.
- Run a bounded number of Qwen analyses concurrently (default 2, configurable 1-4).
- Persist discovery progress and timing/caching metrics.
- Show cache hits, actual Qwen calls, and total discovery duration in the Discover UI.

## Install

Stop ApplyLite, extract this ZIP over your current ApplyLite folder, then run:

```powershell
cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

No new npm packages are required.

## Recommended first test

Open **Discover** and leave:

- Deep analyses per run: `6`
- AI concurrency: `2`
- Minimum final fit: your current setting

Run discovery once. The first M2.2 run may still call Qwen for previously unseen/uncached postings. Run it a second time with the same sources: unchanged rejected postings should now appear as cache hits and should not call Qwen again.

If your PC becomes memory constrained while Ollama handles two requests, change **AI concurrency** to `1`. If Ollama and your hardware comfortably support parallel requests, `2` is the recommended default; `3-4` is intentionally available but not recommended unless you have enough RAM/VRAM.
