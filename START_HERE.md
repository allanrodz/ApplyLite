# Start ApplyLite on Windows

Open PowerShell in the repository folder.

```powershell
Copy-Item .env.example .env
npm install
npx playwright install chromium
ollama pull qwen3:8b
npm run dev
```

Open http://localhost:5173.

## First-use order

1. Open **Profile** and enter your candidate facts, target titles, skills and preferences.
2. Open **Answer library** and add recurring answers such as work authorization, notice period and salary expectations.
3. Go to **Dashboard -> Import job** and paste a real job posting.
4. Review the fit score and breakdown.
5. Click **Approve** for opportunities you want in the application queue.

M0 deliberately stops before automatic submission.
