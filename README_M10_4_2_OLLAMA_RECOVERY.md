# ApplyLite M10.4.2 - Local AI recovery + reviewed fallback escape hatch

Version: 0.14.5

This patch addresses repeated degraded application packages when the local Ollama service is unavailable.

## Changes

- Before package generation, ApplyLite checks the configured Ollama endpoint.
- For the default local endpoint, ApplyLite attempts to launch `ollama serve` automatically and waits up to 15 seconds.
- ApplyLite verifies that the configured model (default `qwen3:8b`) is installed.
- If Ollama is still unavailable, generation fails with an actionable error instead of creating another degraded package.
- Existing degraded packages remain reviewable.
- If a degraded fallback has **zero unsupported factual claims**, the user may explicitly click:
  `I reviewed this fallback - allow application assistant`
  This changes only ApplyLite's local package approval state. Final employer submission remains manual.
- The previous M10.4.1 fieldResults type-normalization fix is included.

## Install

```powershell
Ctrl+C

Expand-Archive `
  "$HOME\Downloads\apply-lite-m10-4-2-ollama-recovery.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

## Expected behavior

When you click **Regenerate package**:

1. ApplyLite checks Ollama.
2. If Ollama is stopped, ApplyLite tries to start it automatically.
3. If `qwen3:8b` is missing, ApplyLite tells you to run `ollama pull qwen3:8b`.
4. If AI generation succeeds, the package becomes ready normally.
5. If an existing fallback is factual but AI is unavailable, you can explicitly approve that reviewed fallback for the application assistant.

No database migration is required.
