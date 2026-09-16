# M1 - CV intelligence

## Goal
Create a local factual memory from the user's master CV before any tailoring or automation is allowed.

## Supported inputs
- PDF via `unpdf`
- DOCX via `mammoth`
- TXT / Markdown
- pasted raw CV text

## Flow
1. User imports a CV.
2. ApplyLite extracts plain text locally.
3. Raw text is kept in SQLite and the original uploaded file is copied to `storage/cv/`.
4. Ollama receives the extracted text plus a strict JSON schema.
5. The model must extract source-backed facts only.
6. The Zod schema validates the structured output.
7. The user reviews the facts.
8. A separate action may merge only safe fields into the candidate profile.

## Non-fabrication contract
The extractor may not infer missing employers, dates, technologies, qualifications, years, achievements, metrics or responsibilities. Unknown data is represented by empty strings/arrays and ambiguity should be recorded under `evidenceNotes`.

## M1 is not tailoring
M1 does not rewrite the CV for a job. It only establishes the evidence base that future milestones may select and rephrase.
