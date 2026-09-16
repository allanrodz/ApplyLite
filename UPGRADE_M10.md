# ApplyLite M10 — Gmail Intelligence

M10 connects one Gmail account to ApplyLite using Google OAuth and the **Gmail read-only scope**. It is intentionally human-controlled: messages can propose tracker updates, but ApplyLite does not silently change employer outcomes and cannot send, delete, label or modify email.

## What M10 adds

- Google OAuth Desktop-app connection flow using a loopback callback on `127.0.0.1:4310`.
- Read-only Gmail sync with a focused first scan and incremental future scans.
- Local-only retention of career-related messages; unrelated mail is discarded after transient filtering.
- Deterministic classification first, with local Ollama/Qwen used only for ambiguous career messages.
- Message classes: interview, assessment, offer, rejection, recruiter reply, application acknowledgement and other.
- Automatic matching to ApplyLite applications using company/title/sender evidence, plus manual correction.
- Human-confirmed tracker updates for interview/rejection/offer signals.
- Gmail messages shown inside each application timeline.
- M8 follow-up suppression after a meaningful employer email response.
- Interview date/time/link and assessment details when explicitly present.
- “Draft reply in Gmail” opens a prefilled Gmail compose window; ApplyLite still cannot press Send.
- Background sync (opt-in, default interval 15 minutes while ApplyLite is running), with manual Sync now.
- M9 System Doctor and diagnostics include Gmail connection/sync health.
- OAuth client credentials and refresh/access tokens live in `.secrets/`, are git-ignored, and are **not** included in ApplyLite backups.

## Version

M10 upgrades root/API/web to `0.14.0` and database schema to version `10`.

## Google setup — once

1. Open Google Cloud Console and create or select a project.
2. Enable **Gmail API**.
3. Configure the OAuth consent screen. For a personal Gmail account use External. Add your own Gmail address as a test user if the app is still in Testing.
4. Create OAuth Client ID → **Desktop app**.
5. Download the client JSON.
6. In ApplyLite open **Gmail Intelligence** → **Choose OAuth JSON** and select that file.
7. Click **Connect Gmail** and approve the read-only Gmail permission in the browser.
8. Return to ApplyLite and click **Sync now** for the first scan. After checking the results, enable **Background sync** if you want automatic polling.

Google’s loopback desktop flow returns to:

`http://127.0.0.1:4310/gmail/oauth/callback`

No redirect URI needs to be typed into ApplyLite.

### Important Google testing-mode note

Google documents that OAuth apps with publishing status **Testing** generally receive refresh tokens that expire after 7 days when scopes beyond basic profile identity are requested. Gmail read-only is beyond those basic scopes. For long-lived personal use, move the OAuth consent screen to **In production** when you are comfortable doing so. An unverified-app warning can still appear for a private personal project.

## Install

Stop ApplyLite, then overlay the M10 ZIP into your existing project:

```powershell
Expand-Archive `
  "$HOME\Downloads\apply-lite-m10-upgrade.zip" `
  -DestinationPath "C:\path\to\apply-lite" `
  -Force

cd "C:\path\to\apply-lite"
npm run typecheck
```

M10 adds no npm dependency, so the existing install is sufficient.

If typecheck passes:

```powershell
npm run dev
```

Then open `http://localhost:5173` → **Gmail Intelligence**.

## Privacy boundary

The first sync uses a career-oriented Gmail search over the configured lookback window. Later syncs use a small time overlap after the previous sync so generic recruiter replies are not missed. ApplyLite may transiently fetch those new messages from Gmail to decide relevance, but it stores only messages considered career/application-related. No attachments are downloaded. The stored body text is capped locally and is used only for matching/classification.

Ambiguous classification uses your existing local Ollama model. Gmail message content is **not** sent to a cloud LLM by M10.

## Outcome safety

Email classification never directly changes M5 outcomes. A message can suggest:

- `INTERVIEW` → Interview
- `OFFER` → Offer
- `REJECTION` → Rejected
- `ASSESSMENT` → timeline event only
- `RECRUITER_REPLY` → timeline event only

You press the confirmation button before the application tracker changes.

## Recommended first validation

After connecting Gmail:

1. Click **Sync now**.
2. Confirm that only career/recruiter messages appear.
3. Check automatic application matches and manually correct any uncertain one.
4. Confirm one harmless recruiter/assessment event if available.
5. Open that application under **Applications** and verify the Gmail entry appears in its timeline.
6. Open **System & Recovery** and verify Gmail Intelligence appears in Doctor/diagnostics.

Do not confirm an outcome until the email classification and application match are correct.
