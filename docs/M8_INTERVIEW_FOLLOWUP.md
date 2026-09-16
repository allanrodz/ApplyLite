# M8 - Interview and Follow-up Copilot

## Goal

Extend ApplyLite beyond application submission into interview preparation and responsible follow-up without turning it into an autonomous communications bot.

## Data flow

```text
M5 application tracker
        |
        +-- WAITING for >= 5 days --> follow-up queue --> local draft --> user sends manually
        |
        +-- INTERVIEW -------------> interview workspace
                                      |
                                      +-- stored job requirements
                                      +-- verified CV facts
                                      +-- local Qwen planning
                                      |
                                      +-- likely questions
                                      +-- evidence anchors
                                      +-- refresh topics
                                      +-- questions to ask
                                      +-- mock-answer feedback
```

## Evidence model

The interview planner receives an evidence catalog generated from the latest extracted CV and the stored job analysis. Candidate evidence has stable IDs such as:

- `cv:skill:0`
- `cv:employment:1:bullet:2`
- `cv:project:0:bullet:1`

Job evidence uses IDs such as:

- `job:meta`
- `job:required-skill:0`
- `job:responsibility:2`

The model selects IDs. The API then hydrates those IDs with exact stored text. This prevents the displayed evidence anchors from being rewritten by the model.

## Interview packs

Stored in `interview_packs` with one current pack per application.

A pack contains:

- role summary
- role focus
- likely questions
- coaching guidance
- verified evidence anchors
- STAR story anchors
- refresh topics
- questions to ask the interviewer

If local Qwen times out during pack planning, M8 falls back to a deterministic pack built from extracted job requirements and verified CV evidence.

## Mock interview turns

Stored in `mock_interview_turns`.

The local model scores:

- structure
- relevance
- evidence
- clarity

It may also flag answer claims that are not supported by the current CV evidence catalog. These are review flags, not an external fact-checking system.

## Follow-up drafts

Stored in `followup_drafts` and generated deterministically from:

- job title
- company
- submission date
- saved candidate name

Supported draft types:

- `follow_up`
- `thank_you`

No sending mechanism is included in M8.

## Follow-up threshold

A waiting application appears in the follow-up queue after 5 full days from submission. Waiting is never treated as a negative outcome.

## New tables

```text
interview_packs
mock_interview_turns
followup_drafts
```

All existing M0-M7 data remains unchanged.
