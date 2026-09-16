# ApplyLite M4.1 Profile CORS fix

This patch fixes browser preflight failures when saving Profile data with `PUT /profile`.

It explicitly permits the local API methods used by ApplyLite:

- GET
- HEAD
- POST
- PUT
- PATCH
- DELETE
- OPTIONS

The existing localhost / 127.0.0.1 origin policy remains unchanged.

## Install

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m4-1-cors-fix.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

Then open Profile and save again.
