# ApplyLite M3.2 — Candidate identity fix

This patch fixes generated CVs and cover letters that showed `Candidate` or `[Your Name]` when the saved Profile name was blank.

## What changed

- Candidate facts now include `fullName` for future CV imports.
- CV extraction is instructed to capture the candidate's explicit full name only.
- Merge-to-profile now fills first/last name from extracted CV facts only when those profile fields are blank.
- Existing CV imports do **not** need to be re-uploaded: M3 can resolve the candidate name from, in order:
  1. saved Profile name,
  2. structured CV `fullName`,
  3. the first name-like line in the stored raw CV text,
  4. the CV filename.
- Cover-letter closings strip placeholders such as `[Your Name]`, `{{name}}`, and `<Your Name>`.
- Qwen is explicitly told that the `closing` field must contain only a sign-off phrase, never a candidate name.

## Install

Stop ApplyLite, then overlay the ZIP into the existing project and run:

```powershell
cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

Then regenerate the application package. Previously generated PDFs are not modified in place; a new package will be created.
