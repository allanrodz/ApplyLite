# ApplyLite

**A local-first job-search and application assistant for Windows.**

Import and review your CV, search for positions in your chosen career fields, compare
requirements, prepare application documents, and track outcomes. Local AI uses Ollama.
You review the evidence and control final employer submissions.

## Install or update

**Close the running ApplyLite window first.** In ordinary PowerShell:

```powershell
irm https://raw.githubusercontent.com/allanrodz/ApplyLite/main/install.ps1 | iex
```

This runs code from this repository. Read `install.ps1` before executing a remote
installer. It downloads a fixed GitHub commit over HTTPS, installs/checks Node.js,
installs locked npm dependencies and Playwright Chromium, attempts to set up Ollama
and the configured model, then opens ApplyLite. Node installation may request Windows
administrator approval. Internet access and several GB of free disk space are needed.

Default folder: `%LOCALAPPDATA%\ApplyLite`. Open `http://localhost:5173` after startup.
Keep the launcher window open while using the app. The API listens on loopback port 4310.

Starting with **0.15.0**, double-click **Update ApplyLite.cmd** in the installation folder
for future updates. Double-click **Start ApplyLite.cmd** to run it again.

For an existing custom installation folder:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/allanrodz/ApplyLite/main/install.ps1))) -InstallDir "C:\Apps\ApplyLite"
```

Options: `-NoRun` installs without launching; `-SkipModel` skips the model download;
`-SkipAI` skips Ollama setup. CV text import, review/editing and deterministic profile
matching do not require AI. Optional enhancement and AI-generated documents do.

### Updates preserve your local data

The updater prepares and checks a staging copy before replacing the app. It refuses a
running installation and retains the old folder as `ApplyLite.backup-<timestamp>-<id>`.
Standard data, storage, `.env`, Gmail secrets, backups, exports and pending-restore
folders are preserved, including legacy `apps/api` locations. Windows workspace links
are repaired after moving to the final folder. A staging failure leaves the old app in
place; a replacement/relink failure restores the old folder when one existed.

Do not start ApplyLite during an update. Keep the backup until you verify your profile,
CV and application history. To roll back, close ApplyLite, move the new folder aside,
and restore the backup to the original path. Git checkouts should use `git pull` and
`npm ci`, rather than the one-command installer.

## First use: CV to applications

1. **CV intelligence:** upload PDF, DOCX, TXT or Markdown, or paste your CV text. The app
   saves an editable draft without waiting for an AI response.
2. **Review and edit facts:** compare the fields with the full extracted source. Correct
   contact details, skills, employment, education, projects, languages and certifications.
   **Enhance draft with local AI** is optional and runs separately from the upload.
3. **Save reviewed facts**, then **Merge reviewed facts into Profile**. Drafts are separate
   from reviewed CVs. Matching continues to use your last saved reviewed CV until you
   publish a new review; importing an unfinished draft does not erase it.
4. **Profile:** choose your target job titles or career terms, skills and preferred
   locations. These are your choices, not inferred preferences based on an old job.
5. **Discover** opportunities or import an employer job URL. Check match explanations,
   missing requirements, qualifications and location restrictions before applying.
6. Review the generated package and employer form, submit manually, then track outcomes.

### Reliable import does not mean perfect automated extraction

The offline parser makes a conservative draft from recognizable headings and explicit
source values. Uncertain fields are left blank rather than invented. Other layouts can
use optional AI enhancement or the editable form. The entire extracted source remains
available, including when AI is offline, slow, interrupted or returns invalid output.

AI enhancement uses short source chunks and a bounded runtime. It checks proposed values
against source excerpts; grouping and completeness still require human review. Saving
manual edits prevents late AI results from overwriting the reviewed data. Version checks
reject stale saves from another browser view.

Upload limits: **10 MB** per file and **100,000 source characters**. Optional AI enhancement
supports **30,000 characters**. Scanned/image-only PDFs and encrypted files may not provide
usable text. **OCR is not included**: export a selectable-text PDF/DOCX or paste the text.

### Matching for different career fields

Your target titles take precedence over your current job. Discovery can expand chosen
terms across supported career families, including accounting/finance, healthcare,
hospitality, administration, marketing, sales, HR, customer service, logistics, education,
design, construction, legal and technology. Unknown/niche titles still use explicit words.
Query planning supports up to 18 queries rather than only the first three saved titles.

Entry-level-only, broad entry-level IT, and US-scoped remote searches are **opt-in**.
Scheduled discovery respects saved targets and locations without silently enabling broad
IT searches. Starter employer boards are still largely Ireland/technology-focused; add
relevant public employer sources for your own field. Coverage and source availability
are not guaranteed.

Skill matching distinguishes Java from JavaScript, C from C++, and partial skills from
compound requirements. Missing end dates are not assumed to mean current employment;
unrelated work is not credited as relevant years. Scores are heuristic fit estimates,
not proof of eligibility or verified qualifications. Existing jobs are rescored when
the job workspace is loaded using your saved profile/CV.

A US remote posting is not proof that an Ireland-based applicant can be hired. Check
residence, work authorisation, working hours and employer hiring-country restrictions.

### Form-field assistance

The browser assistant understands standard autocomplete tokens and saved answers.
Uncertain learned mappings are no longer boosted to high confidence automatically.
Referee/employer contact fields, citizenship, sponsorship and consent are not filled
from loosely related personal data. Fill ambiguous or sensitive fields manually and
review every answer. Complex widgets and unusual employer forms may need manual work.

## Other features

- Tailored CVs, cover letters and screening-answer drafts with evidence checks.
- Application tracking, notes, next actions and outcome-aware ranking.
- Optional daily discovery and a preparation review queue.
- Interview preparation and follow-up drafting.
- Optional Gmail read-only career-message intelligence; proposed outcome changes need
  confirmation, and Gmail requires your own OAuth setup.
- Local diagnostics, backups and recovery tools.

## Local AI and configuration

Fresh installations default to `qwen3:4b`; updates retain an existing explicit model
selection. Larger models can be slow on CPU-only or memory-limited machines. There is
no guaranteed AI response time. Start with the offline import/review path when needed.

```powershell
ollama list
ollama ps
Invoke-RestMethod http://127.0.0.1:4310/ai/health
```

AI health distinguishes a reachable Ollama service from the configured model actually
being installed. The API `/health` response includes the application version.

Configuration precedence is **process environment > legacy `apps/api/.env` > root `.env`**.
Existing legacy data locations remain in use; new installs can use one root env file.
Do not copy someone else's env, database, CV storage or credentials into your app.

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b
OLLAMA_TIMEOUT_MS=180000
CV_AI_TIMEOUT_MS=180000
```

`CV_AI_TIMEOUT_MS` bounds optional enhancement; uploads do not wait for it.

## Development and tests

Use Node.js **22.12+** or a supported newer LTS. From the project root:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run regression:browser
npm run dev
```

Create `.env` from `.env.example` only when one does not already exist. The application
is an npm workspace: `apps/web` (React/Vite), `apps/api` (Fastify/SQLite/Ollama/Playwright),
`packages/shared` (Zod schemas/types), and `scripts` (Windows launch/update helpers).

Tests use synthetic candidate data and isolated temporary databases. They cover CV
parsing, offline import, optional AI failures, stale-save protection, career/skill/field
matching, discovery breadth and the browser review-to-profile workflow. Do not point
tests at a live database. Windows CI checks builds and PowerShell syntax as well.

## Privacy and limitations

Each installation is a **single-person local workspace**, not a hosted multi-tenant
service. Friends use independent databases on their own machines. Do not expose the API
to a public network. By default CV/AI processing is local; a custom remote Ollama URL
receives the text sent to AI. Discovery contacts public job websites, form assistance
interacts with employers, and configured Gmail integration contacts Google.

CVs, generated applications, browser sessions, `.env`, databases, secrets and backups are
private runtime data excluded from Git. Do not attach them to public issues. Share the
version, operation and a redacted error instead. No software can guarantee complete job
coverage, correct legal eligibility, perfect extraction or compatibility with every form.
Keep your original CV and review generated content before submission.
