# ApplyLite

**A local-first CV-to-job-discovery application for Windows.**

Import a CV, review factual information, populate your profile, confirm the roles you want, and discover a broad set of opportunities. Quick discovery and profile review work **without AI**. Optional Ollama or user-configured Groq AI can extract additional facts and analyze selected jobs.

**Release candidate: 0.16.0.** This workflow changes how discovery stores results and introduces background tasks. Use the feature branch for testing until its pull request is approved and merged. The normal installer below follows `main`, not this candidate branch.

## Install or update the published version

Close the running ApplyLite window first. In ordinary Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/allanrodz/ApplyLite/main/install.ps1 | iex
```

This downloads and executes repository code. Review `install.ps1` before running it. The installer resolves a fixed GitHub commit, installs/checks Node.js, installs locked npm dependencies and Playwright Chromium, optionally sets up Ollama and the configured model, and opens the local application. Node installation may require Windows administrator approval. Internet access and several GB of free space are required.

Default location: `%LOCALAPPDATA%\ApplyLite`. Open `http://localhost:5173`. The API binds to `127.0.0.1:4310`, not your public network interface. Keep the ApplyLite launcher/backend running while using it.

Use **Start ApplyLite.cmd** to start again and **Update ApplyLite.cmd** for future updates. To update a non-Git custom installation:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/allanrodz/ApplyLite/main/install.ps1))) -InstallDir "C:\Apps\ApplyLite"
```

Options: `-NoRun`, `-SkipModel`, and `-SkipAI`. Skipping AI still permits CV import/review, profile setup and quick discovery. Existing explicit Ollama model choices are preserved; fresh installs default to `qwen3:4b`.

The updater stages and checks code before replacement, preserves standard and legacy API-local data/configuration/secrets, and retains the previous installation as a rollback folder. It refuses to replace a running installation or a Git checkout. Keep the backup until you verify CV, profile, jobs, applications and documents. Git checkouts should use Git and `npm ci` instead.

## First use: CV to opportunities

1. Open **CV intelligence** and upload a selectable-text PDF, DOCX, TXT or Markdown file, or paste the source text. The draft is saved without waiting for a model.
2. Compare **Review and edit facts** with the full extracted source. The missing-field buttons focus the relevant input; dates and optional contact fields do not block browsing.
3. Optionally request **Enhance draft with local AI**. The configured provider mode applies, despite this legacy button name. The task has saved status and section counters. Failed AI never removes the original text or already saved facts.
4. Choose **Save reviewed facts**, then **Merge reviewed facts into Profile**. The interface guides you to each step. Existing reviewed CV snapshots and application history remain available.
5. In **Profile**, accept any suitable role suggestions or enter your own targets. Suggestions are not applied until you use them and save. Confirm locations and other preferences; these are not guessed from a past job.
6. Open **Discover**. The default is **zero AI analyses**: fetch, deduplicate, quick-score and save jobs. Choose a bounded number of deep analyses when useful.
7. Browse all saved discoveries or this run. Filter by score, title alignment, seniority, location, remote arrangement or analysis status without searching again. Inspect the explanations and original posting before applying.

The application remains one person's local workspace. Each friend should use their own installation and data; it is not a hosted multi-user service.

## CV formats and extraction limits

No special ApplyLite template is required. Clear section headings and text in a sensible reading order improve extraction. The local parser supports common title/employer/date blocks, employer/title/date blocks, pipe-separated employment, education, projects, explicit skills, contact links, languages and certifications. Ambiguous layouts may still need editing or optional AI.

Useful information includes job title, employer, start/end dates, duties, explicit technologies, qualification and institution. For example:

```text
Work History
Frontend Developer
Example Company
Oct 2024 - Present
- Built React interfaces and tested TypeScript components.
```

Dates are retained as written. The review diagnostics show normalized month/year, year or present precision where recognized. A missing date stays unknown. Year-only employment is an approximate calendar range and is flagged rather than asserted as proof of exact tenure. Overlapping employment intervals are not double-counted. Graduation dates in the future do not prove a completed qualification.

Limits: 10 MB per upload and 100,000 extracted characters. Scanned/image-only or encrypted PDFs may not yield text. OCR is not included; export a selectable-text PDF/DOCX or paste text instead. Long CVs can exceed the AI task deadline even though their source remains saved.

Optional AI works section by section with smaller output schemas. It validates structured responses and removes unsupported values against source excerpts. This is not a guarantee of correct record grouping, completeness or qualifications: **review every extracted fact**.

Reviewed facts are separate from AI drafts. A manual save publishes a reviewed snapshot and cancels pending enhancement for that draft; late output cannot replace that review. A stale browser revision is rejected rather than overwriting a newer save.

## Local and optional cloud AI

Open **System & Recovery → AI provider and privacy**.

- **Local only** is the default. With loopback Ollama, model content stays on your computer.
- **Local, then cloud fallback** tries local AI and may send the request to Groq if local processing fails, only after you save explicit cloud consent.
- **Cloud preferred, then local** reverses that order and also requires cloud consent.

Enter your **own Groq API key** and choose a supported structured model. The current adapters offer `openai/gpt-oss-20b` and `openai/gpt-oss-120b`, using Groq's strict JSON-schema response format. Availability, terms, quotas and pricing can change; there is no shared developer key or promise of unlimited free API usage. Check [Groq's structured output documentation](https://console.groq.com/docs/structured-outputs), [rate limits](https://console.groq.com/docs/rate-limits) and [data controls](https://console.groq.com/docs/your-data).

Consent covers CV, profile, job and application content sent by AI features. A configured non-loopback Ollama server also requires this consent. Uncheck consent **and save** to stop new remote requests; already-sent requests cannot be recalled. Loopback local-only mode does not call Groq.

Keys are handled on the API side, not returned to the browser or included in public examples. A UI-saved key is in the installation's `.secrets/ai.json`, excluded from normal app backups and Git. A server environment key takes precedence; removing a UI-saved key does not erase an environment variable. Filesystem backups or copying the entire installation may include credentials: keep them private. Windows account permissions, not the UI alone, protect local files.

Provider tests use a synthetic prompt, not your CV. They report model availability, structured output and measured latency. A tiny probe is **not** a guarantee of CV speed. Local model performance depends on CPU/GPU, RAM and context size. Calls are serialized per provider to avoid flooding a small local machine. No feature downloads a replacement model during inference.

Error codes distinguish missing model, unavailable provider, timeout, rate limit, credentials, malformed output, excessive context, cancellation and missing consent. Read the saved task status before retrying. AI-independent editing and quick discovery remain available.

## Background work and navigation

Routes such as `/cv`, `/profile` and `/discover` survive refresh; browser Back/Forward and bookmarks work. Discovery filters are in the URL.

CV enhancement, manual discovery and per-job deep analysis have persistent server-side tasks. The Activity panel and task cards show phase, status, real counters, cancellation and retry. Progress bars represent the **current phase**, not an invented precise end-to-end percentage. Unknown totals use an indeterminate indicator.

You can navigate elsewhere, refresh or close the browser tab while the **ApplyLite backend remains running and the computer stays awake**. This is not a Windows service: closing the launcher, rebooting, sleep or power loss can interrupt work. On restart, interrupted tasks are marked clearly; retry restarts safe work while saved CV sections/jobs remain. It does not resume a half-generated model response. Queued tasks can start when the backend is next running.

Legacy direct calls and some existing package/interview/form features still retain their previous execution paths; they are not all converted to the new task API. Daily discovery and preparation already have their own background workers. Final employer submission always remains manual.

## Discovery, scoring and coverage

Collection is separate from display filtering. Valid deduplicated postings are saved before optional AI analysis. A low score, a different title or failed AI no longer makes a collected job disappear. Known jobs retain their IDs, update their posting evidence and are attached to the new run. Application state/history is preserved.

**Quick score** is provisional: explicit words, job metadata and current CV/profile evidence, without nuanced LLM interpretation. **AI-analyzed fit** adds structured requirements; it still needs review. An analysis failure keeps the quick result. **Deep analyze this job** is an explicit, bounded background action, not an automatic paid request every time a card is opened.

Display bands are Strong (75+), Possible (50–74), and Stretch (below 50). They are presentation labels, not eligibility rules or hiring probabilities. “Not deeply analyzed” overlaps those bands. Filters for strict title, entry level, hiding seniors, location compatibility, remote and minimum score are optional; clearing them reveals saved lower-score options. Scores are recalculated from saved data when the reviewed CV/profile changes without requiring another crawl.

Role preferences are user-confirmed. Job matching distinguishes Java/JavaScript and C/C++, keeps missing/unknown requirements visible, and does not assume unrelated employment is relevant. Mandatory qualifications, work authorisation and professional registrations require manual checking. A remote job is not proof an employer can hire in your country; US-only remote postings are labeled as unverified and can be hidden.

Sources include public Lever, Ashby, Greenhouse, JobsIreland, IrishJobs and Remote OK adapters. Starter boards are mostly Ireland/technology-focused; add sources for other fields. Search planning uses up to 18 queries with bounded per-source and detail-fetch counts. It cannot search the entire internet or promise live coverage for every profession. Source errors remain visible; captchas/login walls are not bypassed. Expired or malformed ads and external site changes may require manual import.

## Other existing features

- Evidence-grounded application CV/cover-letter drafts and screening answers.
- Application tracking, notes, next actions and outcome-aware ranking.
- Daily discovery, bounded preparation and a review queue.
- Interview preparation and follow-up drafting.
- Optional Gmail read-only career-message intelligence using your own OAuth configuration.
- Browser form assistance; ambiguous/sensitive fields and final submission stay under your control.
- Local diagnostics, backups, recovery and exports.

## Configuration and data safety

Configuration precedence remains **process environment → legacy `apps/api/.env` → root `.env`**. Existing legacy database/storage locations stay in use. Do not copy another person's database, CV storage, env or credentials into your workspace.

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b
OLLAMA_TIMEOUT_MS=180000
CV_AI_TIMEOUT_MS=180000
AI_MODE=local_only
CLOUD_AI_CONSENT=false
GROQ_MODEL=openai/gpt-oss-20b
```

Saved AI preferences take precedence over the AI mode defaults. Optional server-only `GROQ_API_KEY` is never needed for local mode. The version is visible in `/health`.

Schema 11 is additive: persistent tasks/settings, discovery run membership and score provenance. Before a non-test migration, a SQLite snapshot is created under the database directory's `migration-backups`. Snapshot failure blocks that migration. No existing CV, profile, application or job table is erased. Retain installer rollback copies and backups; do not downgrade a live database blindly.

## Development and validation

Use Node.js 22.12+ or a supported newer LTS, from a source checkout:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run regression:browser
npm run regression:workflow-browser -w @apply-lite/api
npm run regression:m9
npm run regression:m10
npm run dev
```

CI runs on Windows, including PowerShell syntax, locked installation, TypeScript/build, synthetic API regressions, real Chromium onboarding/navigation/background-discovery journeys and updater preservation tests. Provider contract tests use mocks and **do not demonstrate actual Groq/Ollama quality or speed**. The updater filesystem tests mock external downloads/vendor installers. No private CV, API key or personal database is required for tests.
