# M4 — Interactive Application Assistant

M4 connects a reviewed M3 application package to the real employer application form in a **visible Playwright Chromium window**.

## Install

Stop ApplyLite, then overlay this ZIP onto your existing `C:\path\to\apply-lite` folder.

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m4-upgrade.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"

npm run typecheck
npx playwright install chromium
npm run dev
```

No new npm dependency was added.

## First test

Use a job that already has an M3 package, such as the ZeroRisk application you tested.

1. Dashboard → job → Details.
2. Confirm the M3 package is present and reviewed.
3. Scroll to **M4 Application Assistant**.
4. Click **Open & fill application**.
5. A separate Chromium window opens.
6. Review every value and uploaded document in the employer form.
7. On multi-step forms, click **Next/Continue yourself**, then return to ApplyLite and click **Fill current step again**.
8. ApplyLite never clicks final Submit. Submit manually in Chromium only after review.
9. After the employer confirms success, click **I submitted it** in ApplyLite to update the local tracker.

## Safety invariants

M4 does not:

- click final Submit/Send Application;
- automatically accept terms, privacy notices, certifications, signatures, or consent checkboxes;
- automatically answer demographic/sensitive questions;
- fill passwords;
- bypass CAPTCHA or human verification;
- use generated screening answers from an M3 package whose evidence audit status is `REVIEW`.

M4 does:

- open the employer application in visible Chromium;
- use profile facts, Answer Library entries and PASS-audited M3 screening drafts;
- upload the latest tailored CV PDF and cover-letter PDF when the form exposes compatible file fields;
- leave unknown or low-confidence questions for manual completion;
- keep the browser open so the user can review and move through multi-step forms.

## Current limitations

The first M4 release is intentionally conservative. Standard HTML inputs, selects, radios, textareas and file uploads work best. Highly customized Workday-style widgets, account creation, email verification and unusual multi-page flows may require manual interaction. Click through those steps in Chromium and use **Fill current step again** after reaching the next form page.
