# M10.6 — Live Employer-Form Answer Assistant

Version: 0.14.7

M10.6 lets ApplyLite draft evidence-grounded answers for open-ended questions that are discovered only after the real employer application form is opened.

## What changes

- Adds **Draft answers for unknown questions** to the live M4.1 browser assistant.
- Reads the exact unknown questions currently visible in Chromium.
- Uses local Qwen3 with verified profile/CV/job/Answer Library evidence to draft only supportable open-ended answers.
- Re-fills the current form step after drafting so exact question matches can be inserted automatically.
- Displays every live-form draft in ApplyLite for review before final submission.
- Derives `How did you hear about us?` as `Company website` when the posting came from the employer's public ATS board.
- Does **not** invent answers for visa/sponsorship, work eligibility, compensation, demographics, prior-employer history, or personal/social URLs.
- Adds optional Google Scholar and X/Twitter URLs to Profile so those fields can be filled from explicit saved data.
- Removes the unsafe generic `autocomplete=url -> portfolio` shortcut so LinkedIn/GitHub/social fields cannot accidentally receive the portfolio URL.
- Treats native-language legal-name fields as manual rather than copying the Latin-script name automatically.

No database migration is required. Live-form drafts remain scoped to the active browser session. Saved profile and Answer Library values continue to be persistent.

## Install

```powershell
Ctrl+C

Expand-Archive `
  "$HOME\Downloads\apply-lite-m10-6-live-form-answers.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

Expected version: `apply-lite@0.14.7`.

## Using it

1. Open a job and start **Open & fill application**.
2. When the current employer form contains unknown questions, click **Draft answers for unknown questions**.
3. ApplyLite sends only safe open-ended questions to local Qwen3.
4. Review the displayed **Answers drafted from the live employer form** and the corresponding fields in Chromium.
5. Legal, sensitive, compensation, prior-employer, and unsupported factual questions remain for you to answer manually or save explicitly in Answer Library/Profile.
6. You still click the employer's final Submit button yourself.
