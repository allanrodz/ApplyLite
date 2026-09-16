# M5.1 Outcome Learning

## Goal

Improve job ranking using the user's own application outcomes without replacing the factual M2/M2.1 scoring model or overfitting to a tiny history.

## Base fit vs learned fit

The deterministic base score remains the source of truth for:

- skills,
- title alignment,
- location,
- experience,
- saved preferences.

M5.1 adds a small outcome adjustment on top:

`learned fit = base fit + outcome adjustment`

The outcome adjustment is capped to ±8 points.

## Training evidence

Only applications that were actually submitted are considered.

Waiting is unlabelled.

Labels are derived as follows:

- offer: strong positive signal,
- interview: positive signal,
- rejected after interview: weaker positive signal because the job family still produced an interview,
- rejected without interview: negative signal,
- withdrawn: ignored.

Historical tracker events are used so an application that reached interview and was later rejected still retains the interview signal.

## Anti-overfitting rules

1. At least 3 labelled applications are required before outcome learning activates.
2. A specific skill/title pattern needs at least 2 labelled examples before it can affect ranking.
3. Feature confidence grows gradually with repeated examples.
4. Global confidence grows gradually with the size of the labelled history.
5. The final adjustment is capped at ±8 points.
6. The base fit can always be viewed by turning outcome learning off.

## Features

The model learns from:

- explicit required/preferred skills extracted from job postings,
- meaningful title tokens after removing generic terms such as engineer, developer, manager, senior and junior.

The model does not learn from protected/sensitive candidate attributes.

## Explainability

Each adjusted job exposes:

- base fit,
- outcome adjustment,
- final ranked fit,
- labelled history count,
- matched historical patterns and their individual signals.
