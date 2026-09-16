# M4 — Application Assistant Architecture

## Goal

Bridge the evidence-grounded M3 package to a real employer application while preserving a human final-submit boundary.

## Session model

The API keeps an in-memory Playwright session per application:

```text
Application record
      ↓
M3 package + profile + Answer Library
      ↓
visible Chromium
      ↓
current form step
      ↓
fill high-confidence fields
      ↓
user reviews / clicks Next
      ↓
Fill current step again
```

The browser stays open until the user closes it, closes ApplyLite, or marks the application as submitted.

## Evidence sources

Priority is:

1. Explicit Answer Library matches.
2. Standard profile facts (name, email, phone, URLs, city/country, current title).
3. M3 screening drafts only when the package audit status is `PASS`.
4. Unknown/manual when confidence is below the threshold.

Candidate identity can fall back to the structured CV `fullName` if first/last name have not yet been merged into Profile.

## Document upload

M4 resolves the latest M3 package and uses:

- `tailored_cv_pdf`
- `cover_letter_pdf` when available

Paths are resolved only inside ApplyLite's configured storage directory.

## Human-only controls

The generic adapter never clicks buttons. In particular it never clicks:

- Submit
- Apply
- Send Application
- Next / Continue

The only automatic navigation is from a job-posting page to an obvious application link/button when no application form is present. A button with `type=submit` is never used for that navigation.

Terms, certifications, signatures, sensitive demographic fields, passwords and checkboxes are left manual.

## Multi-step forms

M4 uses an iterative pattern instead of automatically advancing:

1. fill current step;
2. user reviews and clicks Next/Continue;
3. user clicks **Fill current step again** in ApplyLite;
4. repeat until final submission control is visible;
5. user submits manually.

This is slower than unattended auto-apply but substantially safer for the first production-quality milestone.
