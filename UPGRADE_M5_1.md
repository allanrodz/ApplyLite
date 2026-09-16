# ApplyLite M5.1 — Outcome-aware ranking

M5.1 turns real application outcomes into conservative, explainable ranking adjustments.

## What changed

- New **Outcome Learning** page.
- Dashboard can switch between deterministic base fit and learned ranking.
- Discovery can optionally use outcome learning.
- Only submitted applications can contribute training evidence.
- Waiting applications are never treated as negative.
- Outcome learning activates only after at least **3 labelled outcomes** (interview, offer, or rejection).
- A title/skill pattern needs at least **2 labelled examples** before it can affect a job score.
- Learned adjustments are confidence-weighted and capped at **±8 points**.
- Every adjusted score exposes its base score, learned adjustment, sample count, confidence, and reasons.

## Install

Stop ApplyLite, then overlay the zip into your existing repository:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m5-1-upgrade.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

No new npm dependencies are required.

## Expected behavior right now

If you currently have submitted applications but none has reached interview, offer, or rejection, the Outcome Learning page will correctly show that the model is **collecting evidence** and will apply a `0` point adjustment.

As outcomes accumulate, the model begins learning repeated title and skill patterns. One rejection cannot make ApplyLite avoid a technology or job family.
