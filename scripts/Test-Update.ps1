# Isolated Windows filesystem/rollback tests; downloads and dependency installers are mocked.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$TestRoot = Join-Path $env:TEMP ("applylite-update-test-" + [guid]::NewGuid().ToString("N"))
$global:ApplyLiteTestNpmFailure = $false
$global:ApplyLiteTestBusy = $false
$global:ApplyLiteTestArchive = Join-Path $TestRoot "source.zip"
New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
$Fixture = Join-Path $TestRoot "archive\ApplyLite-fixture"
New-Item -ItemType Directory -Path (Join-Path $Fixture "scripts") -Force | Out-Null
Set-Content (Join-Path $Fixture "package.json") '{"name":"apply-lite","version":"0.15.0"}' -Encoding ascii
Set-Content (Join-Path $Fixture "package-lock.json") '{}' -Encoding ascii
Set-Content (Join-Path $Fixture ".env.example") 'OLLAMA_MODEL=qwen3:4b' -Encoding ascii
Copy-Item (Join-Path $Root 'scripts\relink-workspaces.cjs') (Join-Path $Fixture 'scripts\relink-workspaces.cjs')
foreach ($entry in @(@('apps\api','@apply-lite/api'),@('apps\web','@apply-lite/web'),@('packages\shared','@apply-lite/shared'))) {
    $dir = Join-Path $Fixture $entry[0]
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Set-Content (Join-Path $dir 'package.json') ('{"name":"' + $entry[1] + '"}') -Encoding ascii
}
Compress-Archive -Path $Fixture -DestinationPath $global:ApplyLiteTestArchive
function global:Invoke-RestMethod { param($Uri,$Headers,$TimeoutSec) return @{ sha = ('a' * 40) } }
function global:Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec) Copy-Item $global:ApplyLiteTestArchive $OutFile }
function global:Get-NetTCPConnection { [CmdletBinding()] param($LocalPort,$State) if ($global:ApplyLiteTestBusy) { [pscustomobject]@{ LocalPort = 4310 } } }
function global:Get-CimInstance { [CmdletBinding()] param($ClassName,$Filter) return @() }
function global:npm.cmd { $global:LASTEXITCODE = if ($global:ApplyLiteTestNpmFailure) { 1 } else { 0 } }
function global:npx.cmd { $global:LASTEXITCODE = 0 }
function Assert([bool]$Value,[string]$Message) { if (-not $Value) { throw $Message }; Write-Host "PASS $Message" }
$Install = Join-Path $TestRoot 'App With Spaces'
try {
    New-Item -ItemType Directory -Path (Join-Path $Install 'apps\api\data'),(Join-Path $Install 'apps\api\.secrets'),(Join-Path $Install 'storage') -Force | Out-Null
    Set-Content (Join-Path $Install 'package.json') '{"name":"apply-lite","version":"0.14.7"}' -Encoding ascii
    Set-Content (Join-Path $Install 'apps\api\data\apply-lite.db') 'synthetic database marker' -Encoding ascii
    Set-Content (Join-Path $Install 'apps\api\.env') 'OLLAMA_MODEL=qwen3:8b' -Encoding ascii
    Set-Content (Join-Path $Install 'apps\api\.secrets\fixture.txt') 'synthetic secret marker' -Encoding ascii
    Set-Content (Join-Path $Install 'storage\fixture.txt') 'synthetic source document marker' -Encoding ascii
    $dbHash = (Get-FileHash (Join-Path $Install 'apps\api\data\apply-lite.db')).Hash
    & (Join-Path $Root 'install.ps1') -InstallDir $Install -NoRun -SkipAI
    Assert ((Get-FileHash (Join-Path $Install 'apps\api\data\apply-lite.db')).Hash -eq $dbHash) 'legacy data survives update'
    Assert ((Get-Content (Join-Path $Install 'apps\api\.env') -Raw) -match 'qwen3:8b') 'existing model choice is preserved'
    Assert (Test-Path (Join-Path $Install 'apps\api\.secrets\fixture.txt')) 'nested local secrets survive'
    Assert (Test-Path (Join-Path $Install 'storage\fixture.txt')) 'storage survives'
    Assert (@(Get-ChildItem $TestRoot -Directory -Filter 'App With Spaces.backup-*').Count -eq 1) 'rollback folder retained'
    Assert (Test-Path (Join-Path $Install 'node_modules\@apply-lite\shared\package.json')) 'Windows workspace junction points to final install path'
    $global:ApplyLiteTestNpmFailure = $true
    $failed = $false
    try { & (Join-Path $Root 'install.ps1') -InstallDir $Install -NoRun -SkipAI } catch { $failed = $true }
    Assert $failed 'dependency failure stops the update'
    Assert ((Get-FileHash (Join-Path $Install 'apps\api\data\apply-lite.db')).Hash -eq $dbHash) 'failed staging preserves original data'
    $global:ApplyLiteTestNpmFailure = $false
    $global:ApplyLiteTestBusy = $true
    $blocked = $false
    try { & (Join-Path $Root 'install.ps1') -InstallDir $Install -NoRun -SkipAI } catch { $blocked = $true }
    Assert $blocked 'running app is protected from replacement'
    Write-Host 'Updater regression PASS (isolated filesystem; external installs mocked).'
} finally {
    Set-Location $Root
    foreach ($name in @('Invoke-RestMethod','Invoke-WebRequest','Get-NetTCPConnection','Get-CimInstance','npm.cmd','npx.cmd')) { Remove-Item "function:global:$name" -ErrorAction SilentlyContinue }
    # Remove junctions before recursive cleanup so no target directories are traversed accidentally.
    Get-ChildItem $TestRoot -Directory -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | ForEach-Object { [IO.Directory]::Delete($_.FullName) }
    Remove-Item $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
}
