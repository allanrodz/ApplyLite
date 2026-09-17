# 0.16.0 - CV-to-discovery workflow candidate

- URL-backed navigation, readiness guidance, missing-field focus and explicit role suggestions.
- Expanded deterministic CV layouts, preserved date precision, optional section-based AI extraction.
- Consent-aware Ollama/Groq adapters, safe credentials and actionable provider diagnostics.
- Persistent CV/discovery/deep-analysis tasks with cancellation, retry and restart states.
- Collect/save quick-score jobs before bounded AI; optional view filters and stable run membership.
- Additive schema 11 snapshot migration and synthetic API/browser regression coverage.
- No automatic employer submission, OCR or guaranteed cloud free quota. Live provider performance requires a real user-selected model/key.

# Changelog

## 0.15.0 - CV, matching and update reliability

- Save an offline CV draft immediately; AI enhancement no longer blocks the upload.
- Add complete source preview, editable employment/education/projects and contact fields.
- Optional bounded AI enhancement with source checks and failure/interrupt recovery.
- Publish reviewed snapshots separately from drafts; preserve previous reviewed CVs.
- Reject stale edits and prevent late AI work from overwriting manual reviews.
- Fix separators disappearing while typing comma-separated Profile fields.
- Use desired roles ahead of current titles; expand selected non-IT career families.
- Make broad IT, entry-level-only and US-remote searches opt-in for new users.
- Tighten skill boundaries, relevant-experience calculations and remote eligibility warnings.
- Correct autocomplete token handling and conservative learned form-field matching.
- Distinguish Ollama service availability from configured-model availability.
- Fix root/legacy env resolution without silently moving existing local data.
- Add staged, checked updates, retained rollback folders and Update ApplyLite.cmd.
- Add synthetic API, document, matching and browser regression tests.

Existing saved CVs are retained. Review them if they contain errors; this update does not
claim to retroactively verify every previously extracted fact or employer requirement.
