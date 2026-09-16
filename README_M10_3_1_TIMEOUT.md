# ApplyLite M10.3.1 — Discovery request timeout fix

The generic browser API timeout is 5 minutes. M10.3 discovery can legitimately exceed that when Irish-market sources are slow and up to 12 uncached Qwen analyses are requested.

This patch changes only the manual Discover page request to allow up to 15 minutes. Other API calls keep the normal 5-minute timeout.

Install over the existing ApplyLite folder, then run:

```powershell
npm run typecheck
npm run dev
```

Do not start a second discovery run if the first one may still be executing. Refresh the page first and inspect the match queue / latest run.
