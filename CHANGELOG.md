# 0.16.5 - Document variants, full previews and skill AI

- Regenerate the tailored CV or cover letter independently without rebuilding the whole application package.
- Add CV style controls (balanced, technical, impact-focused, concise) and evidence emphasis controls (auto, skills, experience, projects).
- Add cover-letter tone controls (professional, warm, confident, direct) and short/standard length options.
- Require regenerated variants to remain evidence-grounded and re-run the factual audit before they become the latest package.
- Keep previous package versions/artifacts instead of overwriting them.
- Add full rendered PDF previews for CV and cover letter inside the Dashboard, plus preview links from Review Queue.
- Add AI explanation buttons to matched and missing skill chips in focused job details.
- Add a compact skill Q&A panel that can use the selected job context while avoiding claims that the candidate possesses the skill.
- Route skill explanations through the configured AI provider/privacy mode.
- Bump ApplyLite to 0.16.5.

# 0.16.4 - Update banner and reversible matched skills

- Add a red, dismissible top-of-window banner when the installed commit differs from the latest public `main` commit.
- Key dismissal to the specific remote commit/version so a later merge automatically shows a fresh notice.
- Include a copyable PowerShell update command and remind users to close ApplyLite before updating.
- Cache public GitHub update checks for ten minutes and recheck on focus/visibility without sending CV, profile, job or application content.
- Fix stale hard-coded API/installer version strings and make the installer print the staged package version.
- Add a − action beside matched required/preferred skills in focused Dashboard details.
- Confirm before removing a skill, suppress it from matching even when older CV evidence mentions it, and refresh the focused job score immediately.
- Re-adding a skill clears the suppression.
- Add regression coverage for skill add/remove/re-add scoring and commit/version update comparison.

# 0.16.3 - Dashboard skill actions and deep analysis\n\n- Add a + action beside missing required/preferred skills in focused job details.\n- Require explicit confirmation before a missing skill is saved as a factual Profile skill.\n- Refresh focused job scoring immediately after a confirmed skill is added.\n- Add Deep analyze / Re-run deep analysis directly to the Dashboard details drawer with task progress and score refresh.
- Color-code Dashboard score confidence: provisional quick scores in red and AI-analyzed scores in green, including the details drawer.\n- Keep discovery-result cache coherent when Profile skills or deep analysis change scoring.\n- Add regression coverage for idempotent skill additions and score improvement.\n\n# 0.16.2 - Fast saved views and background package alerts

- Stop synchronous rescoring of every saved discovery job whenever Discover opens.
- SQL-page common discovery views and preserve the last Discovery URL/results for instant cache-first navigation.
- Make Dashboard request only focused/actioned jobs instead of loading the entire discovery inbox.
- Run the main Generate application package action through the existing background preparation queue.
- Add persistent cross-page package activity alerts with ready/failed actions and optional OS notification when already permitted.
- Add a regression proving discovery reads are bounded/side-effect-free and Dashboard loads only focused jobs.

# 0.16.1 - Discovery inbox and focused application workspace

- Keep broad, potentially low-score discovery results on Discover instead of flooding Dashboard.
- Add an explicit Move to Dashboard action for jobs the user may actually pursue.
- Keep direct/manual imports and jobs with existing applications visible in Dashboard.
- Add Discover → Dashboard → package → assisted-apply guidance in both screens.
- Preserve existing CV/cover-letter generation, application preparation and manual final-submit safety.

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
