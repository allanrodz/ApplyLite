# M5 — Application Tracker + Outcomes

## Goal

Turn ApplyLite from an application-preparation tool into a measurable job-search system by retaining post-submission outcomes.

## Separation of concerns

ApplyLite workflow state and employer outcome are intentionally independent.

Workflow examples:

- APPROVED
- TAILORING
- REVIEW_REQUIRED
- FILLING
- SUBMITTED

Employer outcome examples:

- ACTIVE
- WAITING
- INTERVIEW
- REJECTED
- OFFER
- WITHDRAWN

This avoids using one state machine for two different meanings.

## Persistence

M5 extends `applications` with:

- `outcome`
- `submitted_at`
- `outcome_at`
- `next_action_at`
- `next_action`
- `notes`
- `submitted_score`

It also creates `application_tracker_events` for outcome history and manual notes.

Existing `application_events` remain unchanged and are merged into the displayed timeline at read time.

## Submission snapshot

At manual submission confirmation, M5 stores the current job fit score in `submitted_score`. Later job rescoring therefore cannot distort historical outcome analysis.

## Metrics

The tracker computes:

- total applications
- submitted applications
- current waiting applications
- applications that reached interview
- applications that reached offer
- current rejected / withdrawn counts
- response rate
- interview rate
- offer rate
- average fit score for submitted / interview / rejected / offer cohorts

Interview and offer counts use outcome history, so moving from Interview to Offer does not erase the fact that the application reached interview.

## Safety

M5 does not submit applications, contact employers, send follow-ups, or infer outcomes automatically. Outcomes are user-confirmed local records.

## Future use

M5 creates the data required for a future outcome-aware ranking milestone. That ranking should not be enabled until there are enough real applications to avoid learning from a tiny or noisy sample.
