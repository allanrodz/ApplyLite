# ApplyLite M5 — Application Tracker + Outcomes

M5 closes the loop after submission. ApplyLite now tracks what happened to each application instead of stopping once the employer form was sent.

## What M5 adds

- New **Applications** page in the sidebar.
- Five-stage board: Preparing, Applied, Interview, Offer, Closed.
- Employer outcomes kept separate from ApplyLite workflow state:
  - WAITING
  - INTERVIEW
  - REJECTED
  - OFFER
  - WITHDRAWN
- Per-application timeline combining existing ApplyLite workflow events with M5 outcome events and notes.
- Next action + due date for recruiter follow-up, interview preparation, document requests, etc.
- Private application notes.
- Manual timeline notes.
- Funnel metrics: submitted, responses, interviews, offers and conversion rates.
- Outcome signal panel comparing fit score at submission with interview/rejection/offer outcomes.
- Fit score snapshot is frozen when an application is submitted.

M5 records outcome evidence only. It does **not** change job ranking yet; that is deliberately left for a later milestone once enough real outcomes exist.

## Existing applications

On first M5 startup, existing applications already in `SUBMITTED` state are migrated automatically:

- outcome -> WAITING
- submitted time -> existing application update time when no older submission timestamp exists
- submitted score -> current stored job score

No existing application data is deleted.

## Install

Stop ApplyLite, then extract this upgrade over your current ApplyLite folder:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m5-upgrade.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

No new npm dependencies are required.

## First test

1. Open **Applications**.
2. Your previously submitted ZeroRisk application should appear under **Applied** with outcome **Waiting**.
3. Open the card.
4. Add a next action, for example `Check for recruiter response`, with a date.
5. Add a timeline note.
6. When a real outcome arrives, switch it to Interview, Rejected, Offer or Withdrawn.

The board, metrics and timeline should refresh immediately.
