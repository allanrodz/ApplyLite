# ApplyLite M8 upgrade - Interview and Follow-up Copilot

M8 adds a post-application response loop while keeping all external communication under user control.

## Install

Stop ApplyLite, then extract this archive over the existing project root and run:

```powershell
cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

Expected version: `0.12.0`.

## New navigation

`Interview & Follow-up`

## What M8 adds

- Applications marked `INTERVIEW` in M5 appear automatically in the interview workspace.
- Generate a job-specific interview preparation pack with local Qwen/Ollama.
- Candidate examples are anchored to exact verified CV evidence stored by ApplyLite.
- Likely interview questions, role focus, refresh topics, STAR story anchors, and questions to ask.
- Type a mock answer and receive local structured feedback on structure, relevance, evidence, and clarity.
- Claims not supported by stored CV evidence are surfaced as review flags.
- Waiting applications become eligible for a follow-up reminder after 5 days.
- Generate conservative follow-up and post-interview thank-you drafts.
- M8 never sends email or messages automatically.

## First test

If you do not yet have an application marked `INTERVIEW`, M8 should show an empty interview queue. That is expected.

For a functional test:

1. Open `Applications`.
2. Choose a submitted test/real application.
3. Mark the outcome `Interview` only if that is true for the real application. If testing, use a non-real test record rather than falsifying a real outcome.
4. Open `Interview & Follow-up`.
5. Click `Generate prep pack`.
6. Review the questions and exact evidence anchors.
7. Enter one practice answer and click `Score my answer`.

For follow-up testing, an application must be in `Waiting` for at least 5 days. M8 deliberately does not pretend a follow-up is due earlier just to populate the UI.

## Safety boundaries

- No invented candidate facts.
- STAR stories are evidence anchors, not fabricated finished stories.
- Mock-feedback unsupported-claim flags are coaching signals and should be reviewed by the user.
- No email integration or automatic sending.
- No employer contact.
- No automatic outcome changes.
- M4 final submission remains user-controlled.

See `docs/M8_INTERVIEW_FOLLOWUP.md` for architecture details.
