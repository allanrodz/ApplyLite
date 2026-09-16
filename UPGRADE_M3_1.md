# M3.1 - Local generation timeout fix

This patch fixes application-package generation timing out on local `qwen3:8b` during one oversized structured request.

## What changed

- Splits the original all-in-one M3 generation into three smaller structured tasks:
  1. resume evidence selection
  2. cover-letter drafting
  3. screening-answer drafting
- Reduces prompt/context/output sizes for each task.
- Adds per-call Ollama timeouts.
- Adds safe fallbacks so a slow AI sub-step does **not** abort the entire package.
- If a fallback is used, the package is generated with status `REVIEW` and the audit records a warning.
- The semantic evidence audit also has a bounded timeout; if it cannot finish, the existing deterministic evidence checks remain and the package is marked for review.

## Install

Stop ApplyLite, then extract this ZIP over the existing project:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m3-1-timeout-fix.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

No `npm install` is required.

## Expected behavior

Generate the package again. The previous single request could run for 180 seconds and fail the whole operation. After this patch, individual AI stages are bounded and any stage that still times out falls back gracefully.

If Qwen completes all stages, you receive the normal AI-tailored package. If one stage times out, you still receive a usable package marked `REVIEW`, with the exact fallback warning shown in the evidence audit.
