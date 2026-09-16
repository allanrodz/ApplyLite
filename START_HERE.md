# Start ApplyLite on Windows

For a one-command installation or data-preserving update, see the top-level README.md.
For a manual checkout, open PowerShell in the project root and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

Setup preserves existing `.env` files, installs locked dependencies and Playwright,
and prints the exact `ollama pull <model>` command for your effective configuration.
Fresh configurations use `qwen3:4b`; an existing explicit model setting is respected.
Ollama is optional for importing, reviewing and editing a CV.

Then start the app:

```powershell
npm run dev
```

Open `http://localhost:5173`. In CV intelligence, import a draft, review/edit its facts,
save reviewed facts, then merge into Profile. Choose your own target roles and locations
before using Discover. Review all generated content and submit employer forms manually.
