$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "ApplyLite launcher" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found in PATH. Install Node.js 22.12+ before starting ApplyLite."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found in PATH."
}

$ollamaReady = $false
try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2
    $ollamaReady = $true
} catch {
    $ollama = Get-Command ollama -ErrorAction SilentlyContinue
    if ($ollama) {
        Write-Host "Starting Ollama..." -ForegroundColor Yellow
        Start-Process -FilePath $ollama.Source -ArgumentList "serve" -WindowStyle Minimized
        for ($i = 0; $i -lt 15; $i++) {
            Start-Sleep -Seconds 1
            try {
                $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2
                $ollamaReady = $true
                break
            } catch { }
        }
    }
}

if (-not $ollamaReady) {
    Write-Warning "Ollama is not reachable. ApplyLite can start, but optional AI features are unavailable; manual CV import/editing still works."
}

# Open the UI after Vite has had a moment to start.
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 4
    Start-Process "http://localhost:5173"
} | Out-Null

Write-Host "Starting ApplyLite. Keep this window open while you use the app." -ForegroundColor Green
& npm.cmd run dev
if ($LASTEXITCODE -ne 0) { throw "ApplyLite stopped with an error. Review the output above." }
