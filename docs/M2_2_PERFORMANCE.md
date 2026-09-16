# M2.2 - Discovery performance

M2.2 optimizes automatic discovery without changing the evidence-first scoring model.

## Pipeline

1. Enabled ATS boards are fetched concurrently.
2. Jobs already stored in ApplyLite are excluded using one in-memory canonical URL set.
3. Remaining postings are cheap-scored locally.
4. The top `maxDeepAnalysis` jobs are evaluated.
5. If the posting content hash matches the local analysis cache, its requirements are reused immediately.
6. Otherwise Qwen receives a compact requirements-only extraction task rather than the full job-record generation task.
7. Qwen work is bounded by `analysisConcurrency` (1-4, default 2).
8. Every successful requirements extraction is cached immediately, even when the job later fails the final fit threshold.
9. Candidate scoring is always recalculated from the current CV/profile, so cached job requirements do not freeze an old candidate score.

## Cache correctness

The cache key is the canonical job URL plus a SHA-256 hash of title, company, location, salary text, and job description. If the employer changes the posting content, the hash changes and ApplyLite asks Qwen to analyse it again.

## Metrics

Each run now records/returns:

- source fetch time
- analysis time
- total duration
- jobs evaluated
- cache hits
- actual Qwen requests
- imported matches

This makes performance regressions observable instead of relying on perceived wait time.
