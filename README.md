# ApplyLite

**ApplyLite is a local-first job search and application copilot for Windows.** It helps you discover relevant roles, compare them against your real CV evidence, prepare application material, assist with ATS forms, and track outcomes — while keeping the final application submission under your control.

Your CV, profile, answers, application history, generated documents, and local AI workflow stay on your computer by default.

## One-command Windows install

Open **PowerShell** and run:

```powershell
irm https://raw.githubusercontent.com/allanrodz/ApplyLite/main/install.ps1 | iex
```

The installer will:

1. Install **Node.js 20+** if needed.
2. Install **Ollama** if needed.
3. Download ApplyLite into `%LOCALAPPDATA%\ApplyLite`.
4. Install npm dependencies.
5. Install Playwright Chromium.
6. Download the local `qwen3:8b` AI model.
7. Start ApplyLite.

The first install can take a while because the Ollama model is several GB. Re-running the same command updates the application while preserving local `.env`, database, uploaded/generated files, secrets, backups, and exports.

After startup:

- App: http://localhost:5173
- API health: http://localhost:4310/health

## What ApplyLite does

### CV intelligence

Import a master CV from PDF, DOCX, TXT/Markdown, or pasted text. ApplyLite extracts a factual candidate memory and uses source-backed facts as the evidence base for later matching and writing.

### Job import and evidence-backed fit scoring

Paste an employer job URL or import a posting. ApplyLite separates required and preferred criteria, compares them with your profile/CV evidence, and produces a deterministic fit score before optional local-AI analysis.

### Broad entry-level job discovery

Discover mode searches multiple role families instead of spending the entire search budget on a few nearly identical keywords. It can cover areas such as:

- junior software / frontend / full-stack development
- technical support and application support
- QA and software testing
- general IT and service desk roles
- technology / business analysis
- project and PMO coordination
- data / BI / junior analytics
- cloud and infrastructure support
- entry-level cybersecurity
- AI-adjacent junior technical roles

Discovery supports employer ATS feeds and public job sources, deduplicates results, filters obviously senior roles, and can include Ireland, Europe/worldwide remote, and optional US-scoped remote opportunities.

### Application packages

For approved opportunities, ApplyLite can build reviewable application packages from verified evidence, including tailored CV/resume material, cover letters, and screening-answer drafts. Generated prose is audited against saved candidate evidence before it is treated as ready.

### Browser application assistant

A visible Playwright browser can help fill high-confidence ATS fields from your Profile, Answer Library, and approved package. Passwords, CAPTCHA, sensitive demographic/legal questions, unknown fields, and the final Submit action remain manual.

### Application tracker and outcome learning

Track applications separately from employer outcomes such as waiting, interview, rejection, offer, withdrawal, and follow-up. ApplyLite can use your own submitted-application history to make a small bounded adjustment to future job ranking without replacing factual fit scoring.

### Daily discovery and prep queue

ApplyLite can run a local daily discovery routine, build a shortlist, and queue high-fit jobs for application-package preparation while preserving the human review boundary.

### Interview and follow-up copilot

For applications that reach interview or need follow-up, ApplyLite can create interview preparation, evidence anchors, likely questions, refresh topics, and follow-up drafts grounded in the saved job and CV evidence.

### Optional Gmail intelligence

ApplyLite includes a read-only Gmail workflow for detecting recruiting/application messages and proposing tracker updates. Messages can suggest an outcome, but changes still require user confirmation. OAuth secrets stay local and are excluded from backups and Git.

## Privacy and safety

ApplyLite is designed as a single-user, local-first application:

- SQLite stores profile, jobs, answers, and application history locally.
- Ollama provides local AI inference.
- `.env`, `.secrets`, databases, uploaded CVs, generated documents, backups, and exports are excluded from Git, including the runtime copies under `apps/api/`.
- Candidate facts are treated as the source of truth; AI is not supposed to invent experience or qualifications.
- Unknown answers are surfaced for manual input.
- Final employer submission remains a human action.

Job discovery and employer pages are, by nature, network operations. Optional Gmail integration also connects to Google when configured.

## Requirements

For the one-command installer:

- Windows 10 or later
- PowerShell
- Internet access for installation, model download, and job discovery
- Enough free disk space for Node dependencies, Playwright Chromium, and the Ollama model

For local AI performance, more RAM and GPU acceleration will improve speed. CPU-only Ollama works but can be considerably slower.

## Manual developer setup

If you prefer to clone and run the source yourself:

```powershell
git clone https://github.com/allanrodz/ApplyLite.git
cd ApplyLite
Copy-Item .env.example .env
npm install
npx playwright install chromium
ollama pull qwen3:8b
npm run dev
```

The repository requires Node.js 20+.

## Useful commands

```powershell
npm run dev                  # API + React web app
npm run build                # production build
npm run typecheck            # TypeScript checks
npm run regression:discovery # discovery regression coverage
npm run regression:m9        # production-hardening regression
npm run regression:m10       # Gmail / M10 regression coverage
```

## Architecture

```text
Profile + CV facts + Answer Library
                |
                v
      Job import / discovery
                |
                v
      filters + fit scoring
                |
                v
         human approval
                |
                v
 CV + cover letter + Q&A package
                |
                v
 visible Playwright ATS assistant
                |
                v
       HUMAN FINAL SUBMIT
                |
                v
 tracker + outcomes + learning
```

Core stack:

- React + Vite
- Fastify + TypeScript
- SQLite / `better-sqlite3`
- Ollama
- Playwright
- Zod

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the milestone documents under [`docs/`](docs/) for implementation details.

## Updating

If installed with the one-command installer, simply run the same command again:

```powershell
irm https://raw.githubusercontent.com/allanrodz/ApplyLite/main/install.ps1 | iex
```

The installer replaces application code and dependencies while preserving your local career data and configuration.

## Data location

The one-command installer uses:

```text
%LOCALAPPDATA%\ApplyLite
```

With the normal npm-workspace launch, runtime state is primarily under `apps\api\`: `data\`, `storage\`, `.secrets\`, and `.env`. The installer preserves these paths during updates. Root-level legacy data/config paths are preserved too when present.

## Uninstalling

Stop ApplyLite first. If you want to permanently remove the app **and all local ApplyLite data**, delete:

```powershell
Remove-Item "$env:LOCALAPPDATA\ApplyLite" -Recurse -Force
```

Back up the directory first if you want to retain your application history or generated documents.

## Current scope

ApplyLite is built for personal/local use. It is not a hosted multi-user service, does not bypass CAPTCHA, and does not autonomously click an employer's final application submission button.
