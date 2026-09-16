# ApplyLite M4.1 — Adaptive Forms + Skill Growth

M4.1 is an overlay for the existing M4 workspace. It does not replace or reset `.env`, SQLite data, CVs, jobs, application packages, or generated documents.

## What changed

### Profile network/save reliability
- The browser API client continues to use `127.0.0.1:4310`, matching the Fastify bind address.
- Fastify now accepts local web origins from both `localhost` and `127.0.0.1`, even if Vite changes to another local port.
- Network errors now explain which local API endpoint could not be reached.
- Profile shows API address, core identity completeness, and learned autofill mapping count.

### Adaptive form intelligence
M4.1 no longer relies mostly on the visible field label. It considers:
- `autocomplete`
- `type`
- `name`
- `id`
- `placeholder`
- `aria-label` / `aria-labelledby`
- associated `<label>` / nearby question text
- ATS-specific mappings learned from previous forms

Mappings receive a confidence score. High-confidence mappings fill automatically; low-confidence or sensitive/legal fields remain manual.

If you manually fill an unknown employer field, press **Fill current step again**. ApplyLite observes the existing value, matches it to the saved Profile/Answer Library when possible, and stores the field mapping locally. Future occurrences can then autofill.

### Skill Growth
A new **Skill Growth** sidebar page aggregates skills from the jobs ApplyLite has actually analysed.

It separates:
- **Skills worth learning next** — recurring required/preferred skills not verified in your profile/CV.
- **Skills to deepen** — skills you already have evidence for that employers continue to demand.

Required skills carry more priority weight than preferred skills.

For any skill, **Build learning plan / Deepen this skill** creates:
- learning objectives
- prerequisites
- a practical portfolio project
- milestones and deliverables
- stretch goals
- suggested portfolio proof
- free official documentation/tutorial links where ApplyLite has a curated source

The local Qwen model is used for the project/learning-plan design. If it times out, ApplyLite returns a deterministic fallback plan rather than failing the whole feature.

## Install

Stop the existing server with `Ctrl+C`, then extract this ZIP over the current workspace:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m4-1-upgrade.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

No new npm dependencies are required.

## First checks

1. Open **Profile** and save name, email, phone, city and country.
2. Confirm the page reports `5/5 core fields` once populated.
3. Open a real application with M4.1.
4. If a field is missed, fill it manually in Chromium and click **Fill current step again**.
5. Expand **Field intelligence** to see field key, confidence, and whether a learned mapping was used.
6. Open **Skill Growth** and generate one plan for a missing skill and one for an existing skill.

## Safety boundary

M4.1 does not change the M4 safety invariant. It never clicks final Submit, accepts legal terms, fills passwords/CAPTCHAs, or answers sensitive demographic/legal questions automatically.
