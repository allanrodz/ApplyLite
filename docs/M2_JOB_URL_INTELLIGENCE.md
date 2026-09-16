# M2 - Job URL Intelligence

## Goal
Turn an employer/ATS job URL into a locally stored, evidence-backed opportunity with a transparent fit score against the candidate profile and latest CV facts.

## Flow
1. User pastes an `http` or `https` job URL.
2. ApplyLite rejects localhost/private-network destinations.
3. Playwright opens the page in a headless Chromium session.
4. ApplyLite captures visible page text, page metadata, and JobPosting JSON-LD where available.
5. Local Qwen3 extracts only explicit job facts into a strict JSON schema.
6. Required and preferred skills remain separate.
7. ApplyLite scores explicit job requirements against profile + CV skills/project technologies.
8. Source text and structured requirements are stored locally in SQLite.

## Scoring
M2 uses a 100 point score:
- Skills: 40
- Title: 20
- Location: 10
- Experience: 15
- Preferences: 15

Required-skill gaps are displayed as missing/unverified rather than treating unrelated candidate skills as missing.

## Boundaries
- M2 does not submit an application.
- M2 does not bypass CAPTCHA, login walls, or anti-bot checks.
- If a page cannot be read, the user is directed to manual import.
- Extraction must not infer missing salary, employer, skills, experience, or workplace arrangement.
