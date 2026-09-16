# M10 — Gmail Intelligence Architecture

## Goal

Close the post-submission loop without granting ApplyLite authority to send email or silently mutate application outcomes.

## OAuth and secrets

ApplyLite requests only `https://www.googleapis.com/auth/gmail.readonly` through Google’s Desktop OAuth loopback flow. The OAuth client and token are stored under `.secrets/` rather than SQLite. M9 backups contain the application database and generated storage, but not Gmail credentials/tokens.

## Sync model

`gmail_settings` controls local polling. The first run searches a configurable recent window for application/hiring language and known application company names. Subsequent runs query messages arriving after the previous sync with a ten-minute overlap and deduplicate on Gmail message ID. This allows generic recruiter replies to be noticed without repeatedly crawling the mailbox.

Only relevant messages are retained. Attachments are never downloaded. Plain text is preferred; HTML is reduced to text when needed. Stored body text is capped.

## Classification

Classification has two layers:

1. deterministic high-confidence patterns for offers, rejections, interviews, assessments and acknowledgements;
2. local Qwen structured extraction for ambiguous career messages, capped per sync.

The model extracts only explicit scheduling/assessment details and is instructed not to invent employer intent.

## Application matching

Messages are scored against current applications using:

- company tokens,
- job-title tokens,
- sender domain,
- employer/ATS source hints,
- exact title/company evidence in subject/body.

Low-confidence matches remain unmatched. The user can override any match; manual matches become confidence `1.0` for that message.

## Human confirmation boundary

A Gmail message can propose an outcome, but only `confirmGmailMessageAction()` invokes M5’s existing `setApplicationOutcome()` service. This keeps the tracker’s validation/event semantics centralized.

Assessment and recruiter-response confirmations add timeline events without changing the outcome. All matched Gmail messages also appear dynamically in the application timeline as email history.

## M8 integration

A meaningful Gmail response received after submission suppresses M8’s “waiting follow-up due” recommendation. Interview outcomes confirmed from Gmail make the existing M8 interview workspace available naturally through the M5 outcome state.

## Sending boundary

M10 does not request Gmail send/modify scopes. Reply assistance builds a deterministic response and opens Gmail’s compose UI. The user reviews and presses Send.

## Tables

Schema v10 adds:

- `gmail_settings`
- `gmail_messages`
- `gmail_seen_messages` (message IDs only, so irrelevant mail is not re-read repeatedly)
- `gmail_sync_runs`

OAuth client data and tokens are intentionally outside the database in `.secrets/`.
