# Upgrade ApplyLite M1 -> M2

M2 adds job URL extraction and evidence-backed matching. It uses the Playwright Chromium and Qwen3 model already installed for ApplyLite, so there are no new npm dependencies.

## Apply the overlay
Stop ApplyLite with Ctrl+C, then extract `apply-lite-m2-upgrade.zip` over your existing `C:\path\to\apply-lite` folder with `-Force`.

Then run:

```powershell
cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

Open http://localhost:5173 and choose **Import job**.

## First test
Use an employer career page or a public ATS posting (Greenhouse, Lever, Ashby, Workable, or Workday are good first tests). Paste only the URL and choose **Import & score**.

The terminal should show:

- `Job URL import started`
- `Job page extracted; scoring against candidate facts`
- `Job URL import completed`

If a page requires login/CAPTCHA or blocks automated reading, ApplyLite returns a clear error and you can use **Manual import**.

## Database migration
M2 automatically adds these columns to the existing `jobs` table without deleting M1 data:

- `analysis_json`
- `source_text`
- `ats`
