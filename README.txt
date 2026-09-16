ApplyLite M2 job-import fix

This patch makes Lever imports reliable by using Lever's official public Postings API first,
then falling back to Playwright for other sites. It also returns readable 422 errors instead
of opaque 500s and improves frontend error parsing.

Overlay this ZIP on C:\path\to\apply-lite, then run:

  npm run typecheck
  npx playwright install chromium
  npm run dev

The Playwright install command is intentionally included because browser binaries are tied to
the installed Playwright version and may differ between M0/M1/M2 installs.
