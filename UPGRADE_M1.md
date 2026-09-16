# Upgrade ApplyLite M0 -> M1

Stop `npm run dev`, then copy the M1 files over the existing ApplyLite folder (or replace the folder while preserving `.env` and `data/apply-lite.db`).

From the project root:

```powershell
npm install
npm run typecheck
npm run dev
```

Open `http://localhost:5173`, select **CV intelligence**, and upload the master CV.

M1 adds three dependencies: `@fastify/multipart`, `unpdf`, and `mammoth`. No cloud services are required. The Ollama model remains `qwen3:8b`.
