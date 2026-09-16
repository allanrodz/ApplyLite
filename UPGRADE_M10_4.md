# ApplyLite M10.4 - Application Package Reliability

M10.4 fixes the failure mode where local-AI transport errors could leave a weak fallback CV/cover letter that looked ready to use.

## What changed

- Ollama chat requests now retry transient `fetch failed`, connection-reset/refused, 429, 502, 503 and 504 failures up to three times.
- Core package generation records which stages succeeded or failed: resume, cover letter, screening answers and semantic audit.
- If resume or cover-letter AI generation fails, the package is marked degraded and **will not be auto-uploaded by M4**.
- Old packages are also detected as degraded from their saved M3 warnings, so the existing bad Telnyx package is protected immediately after this upgrade.
- The deterministic cover-letter fallback is now job-specific and evidence-grounded. It uses verified matched skills and actual job responsibilities instead of pasting the CV headline into prose.
- Deterministic CV fallback ranks relevant skills, employment evidence and projects against the posting and uses a job-family headline.
- Skill-specific experience claims such as `3-5 years of Python experience` no longer receive full experience credit merely because the CV has 4+ years of broadly technical employment. If the CV does not explicitly support the skill-specific duration, ApplyLite lowers the experience component and raises a review concern.

## Install

Stop `npm run dev`, then extract this ZIP over the ApplyLite project and run:

```powershell
cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

The app version should be `0.14.4`.

## Retest the Telnyx package

Open the Telnyx Software Engineer (Python) job and click **Regenerate package**.

If Ollama succeeds, the package should show a normal AI/mixed status and the cover letter should be tailored to the Telnyx role.

If Ollama is still unavailable, ApplyLite will show **PACKAGE DEGRADED - DO NOT AUTO-USE**. The fallback preview will still be readable for manual review, but **Open & fill application** remains disabled until a core package is regenerated successfully.

No database migration is required.
