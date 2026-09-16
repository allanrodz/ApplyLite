# M0 - Local Foundation

## In scope

- Monorepo scaffold
- Local Fastify API
- SQLite initialization
- Candidate profile storage
- Reusable answer library
- Manual job import
- Deterministic fit scoring
- Optional Ollama helper
- Application state machine data model
- Playwright adapter interface
- Generic review-mode automation skeleton
- React dashboard showing imported jobs and scores

## Explicitly out of scope

- Job-board scraping at scale
- CAPTCHA bypass
- Proxy rotation
- Account creation automation
- Final-submit automation
- Cloud hosting
- Payments/auth/multi-user support
- Automatic LinkedIn application actions

## Acceptance criteria

1. `npm run dev` starts API and web app.
2. `GET /health` returns ok.
3. User can create/update a local profile.
4. User can add reusable answers.
5. User can paste a job and receive a fit score.
6. Job appears on dashboard sorted by score.
7. Application can be moved to `REVIEW_REQUIRED` but not automatically submitted.
8. All persistent state survives restart in SQLite.
