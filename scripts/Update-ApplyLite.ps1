$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
try {
    Write-Host "Close ApplyLite before updating. Your local data and settings will be preserved."
    $installer = Invoke-RestMethod "https://raw.githubusercontent.com/allanrodz/ApplyLite/main/install.ps1" -TimeoutSec 60
    & ([scriptblock]::Create([string]$installer)) -InstallDir $Root
} catch {
    Write-Error $_
    exit 1
}
