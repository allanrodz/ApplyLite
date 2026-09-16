# ApplyLite M10.2 — Discovery Coverage & Relevance

Version: **0.14.2**

This is a focused pre-M6 discovery patch. It does not change Gmail, application packages, tracker data, or the database schema.

## Why

The original discovery starter catalogue had only two boards: Dun & Bradstreet and ZeroRisk. With only six deep-analysis slots per run, the cheap prefilter could also spend slots on location-mismatched, very senior, or weakly related titles.

## What changes

### Broader starter catalogue

ApplyLite now seeds 16 public employer ATS boards with Dublin/Ireland technology presence across Lever, Ashby, and Greenhouse, including:

- Dun & Bradstreet
- CarTrawler
- ZeroRisk
- Kota
- OpenAI
- Whatnot
- Omni
- Fin / Intercom
- Telnyx
- PlayStation
- New Relic
- InterSystems
- Sonatus
- Anthropic
- 2K
- xAI

Existing manually learned boards are preserved. New starter boards are inserted idempotently when the API starts.

### Harder local relevance gate

Before a job can consume a Qwen deep-analysis slot, ApplyLite now rejects obvious mismatches using local rules:

- title family must align with at least one requested target title;
- explicit locations outside the requested area are rejected;
- `Ireland` also recognises Dublin/Cork/Galway/Limerick/Waterford and `IE` locations;
- staff/principal/director/head/VP roles are rejected for early-career profiles;
- senior/lead and large experience gaps receive stronger penalties;
- junior/graduate/associate/Engineer I titles receive a small shortlist boost.

This is only the cheap prefilter. Final fit is still produced by the existing evidence-based requirements extraction and scoring pipeline.

### Employer diversity

The first deep-analysis pass is capped at **two jobs per employer**. If there are still unused slots, ApplyLite fills them from the global ranking. This prevents one large board from consuming all six Qwen analyses.

## Install

Stop ApplyLite, then from PowerShell:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m10-2-discovery-fix.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"

npm run typecheck
npm run regression:discovery
```

Expected regression ending:

```text
Discovery coverage regression PASS
Starter boards: 16
Relevance gate: software/project matches preserved; unrelated engineering/management titles rejected.
Diversity: runtime discovery caps the first pass at two deep-analysis slots per employer.
```

Then:

```powershell
npm run dev
```

The root/API/web version should be **0.14.2**.

## Before tomorrow's scheduled M6 run

Open **Discover** once. You should see at least **16 enabled boards** (possibly more if ApplyLite already learned boards from imported jobs).

Run **Find jobs now** once manually. Keep your current target titles and locations. The run is useful as a dry run because it will populate caches before the scheduled M6 scan.

Do not lower the final-fit threshold just to force results. It is better to return fewer strong jobs than to reintroduce irrelevant ones.
