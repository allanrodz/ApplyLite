$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
& npx.cmd playwright install chromium
if ($LASTEXITCODE -ne 0) { throw "Playwright installation failed." }
# Read the effective runtime configuration without printing secrets.
& npm.cmd run build -w @apply-lite/shared
if ($LASTEXITCODE -ne 0) { throw "Shared package build failed." }
& npm.cmd run build -w @apply-lite/api
if ($LASTEXITCODE -ne 0) { throw "API build failed." }
$Model = (& node.exe (Join-Path $PSScriptRoot "configured-model.mjs")).Trim()
if ($LASTEXITCODE -ne 0 -or -not $Model) { throw "Could not determine the configured Ollama model." }
Write-Host "Optional local AI model: ollama pull $Model"
Write-Host "Without AI you can still import, review and edit your CV."
Write-Host "Start ApplyLite with: npm run dev"
