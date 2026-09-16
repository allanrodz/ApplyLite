# ApplyLite M10.1 - Gmail Noise Filter

This patch tightens M10 Gmail Intelligence after the first real mailbox sync exposed job alerts/newsletters being treated as career application mail.

## Changes

- Rejects known bulk job-alert/newsletter senders before classification (Indeed match alerts, Glassdoor notifications/community, AIApply newsletters, Spocket, NordVPN, AlgoMonster).
- Rejects generic job-alert subject patterns such as `more jobs`, `jobs for you`, `Apply Now`, `job alert`, and `recommended jobs`.
- Uses Gmail category labels to discard promotional/social/forum mail unless it contains a direct application signal.
- Replaces broad `career/role/position` relevance checks with application-specific signals.
- Preserves strong application matches and direct subjects such as `Your Application`, `Interview`, `Assessment`, `Re: ... application`, and offer/rejection language.
- Tightens the first-sync Gmail search query.
- On the next Gmail sync, removes previously stored messages that are now deterministically known to be bulk noise. Their Gmail IDs remain in the seen set, so they are not re-imported.
- Adds regression fixtures proving that Indeed/Glassdoor noise is rejected while a direct application reply remains relevant.

## Install

Stop ApplyLite, then from PowerShell:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m10-1-noise-filter.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"

npm run typecheck
npm run regression:m10
```

If both pass:

```powershell
npm run dev
```

Open **Gmail Intelligence** and keep **Background sync = Off**. Click **Sync now** once. The sync will first prune previously stored known noise and then process new mail with the stricter filter.

Expected regression output includes:

```text
M10 regression PASS
Noise gate: Indeed/Glassdoor alerts rejected; direct application reply preserved.
```
