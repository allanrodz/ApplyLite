$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
}

npm install
npx playwright install chromium

Write-Host "\nOptional local model download:" -ForegroundColor Cyan
Write-Host "  ollama pull qwen3:8b"
Write-Host "\nStart ApplyLite:" -ForegroundColor Green
Write-Host "  npm run dev"
