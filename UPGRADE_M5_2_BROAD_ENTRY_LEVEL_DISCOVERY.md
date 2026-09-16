# M5.2 — Broad Entry-Level IT Discovery

This patch expands Discover mode beyond the first few saved target-title keywords while keeping the expensive Qwen analysis bounded.

## What changed

- Public-board search now generates up to 18 **diversified role-family queries** instead of slicing the first handful of target titles.
- The query budget round-robins across software, support, QA, project/PMO, general IT, AI, data, cloud/infrastructure, and security roles.
- A new **Broaden beyond my exact titles across entry-level IT** option is enabled by default. Exact CV target titles remain important, but adjacent early-career IT roles are allowed into the local ranking stage.
- Entry-level mode rejects senior/staff/principal/lead/director/head/architect roles, manager titles, common level-II/III titles, and postings with explicit 4+ year experience minimums.
- JobsIreland searches Ireland-wide by default when the profile contains both Dublin and Ireland, rather than spending the whole query budget on Dublin-only URLs.
- Remote OK is added as a global remote source. Its original Remote OK job URL is preserved as the source link.
- **US-scoped remote** roles can be included with a toggle. They receive a smaller location score than Ireland/Europe-compatible roles so local/European jobs remain preferred.
- Public search requests run with bounded concurrency and de-duplicate URLs before deep analysis.
- Qwen remains capped by `maxDeepAnalysis`; broader discovery does not mean every scraped job is sent to the model.

## Defaults

- Entry-level focus: ON
- Broad entry-level IT families: ON
- Include US-scoped remote roles: ON
- Public-board query budget: 18 distinct queries

## Expected effect

Profiles containing many near-duplicate software titles no longer consume the whole public-board search budget before support, QA, IT operations, project coordination, AI/data, cloud, or security roles are searched.
