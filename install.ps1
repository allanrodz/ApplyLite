[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "ApplyLite"),
    [switch]$NoRun,
    [switch]$SkipModel,
    [switch]$SkipAI
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Repo = "allanrodz/ApplyLite"
$Model = "qwen3:4b"
$OriginalLocation = Get-Location
function Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Refresh-Path {
    $env:Path = "$env:Path;" + [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:ProgramFiles\nodejs;$env:LOCALAPPDATA\Programs\Ollama"
}
function Supported-Node {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { return $false }
    try { $v = [version]((& node.exe --version).Trim().TrimStart("v").Split("-")[0]); return ($v.Major -gt 22 -or ($v.Major -eq 22 -and $v.Minor -ge 12)) } catch { return $false }
}
function Install-Node {
    if (Supported-Node) { return }
    Step "Installing Node.js LTS; Windows may request administrator approval"
    if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
        & winget.exe install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements --silent
        Refresh-Path
    }
    if (Supported-Node) { return }
    $releases = Invoke-RestMethod "https://nodejs.org/dist/index.json" -TimeoutSec 30
    $release = $releases | Where-Object { $_.lts -and ([int]$_.version.TrimStart("v").Split(".")[0] -ge 22) } | Select-Object -First 1
    if (-not $release) { throw "Could not find a supported Node.js LTS release." }
    $arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "arm64" } else { "x64" }
    $name = "node-$($release.version)-$arch.msi"
    $msi = Join-Path $env:TEMP $name
    $base = "https://nodejs.org/dist/$($release.version)"
    Invoke-WebRequest "$base/$name" -OutFile $msi -UseBasicParsing -TimeoutSec 300
    $sums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing -TimeoutSec 30).Content
    $line = $sums -split "`n" | Where-Object { $_.Trim().EndsWith("  $name") } | Select-Object -First 1
    if (-not $line -or (Get-FileHash $msi -Algorithm SHA256).Hash -ne ($line -split '\s+')[0]) { throw "Node.js checksum mismatch. Installation stopped." }
    $p = Start-Process msiexec.exe -Verb RunAs -Wait -PassThru -ArgumentList @("/i", "`"$msi`"", "/qn", "/norestart")
    if ($p.ExitCode -notin @(0, 3010)) { throw "Node.js installation failed: $($p.ExitCode)" }
    Refresh-Path
    if (-not (Supported-Node)) { throw "Open a new PowerShell window after installing Node.js 22.12+ and retry." }
}
function Ensure-Ollama {
    Refresh-Path
    if (-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)) {
        $script = Invoke-RestMethod "https://ollama.com/install.ps1" -TimeoutSec 60
        & ([scriptblock]::Create([string]$script))
        Refresh-Path
    }
    if (-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)) { throw "Ollama executable is unavailable." }
    try { $null = Invoke-RestMethod "http://127.0.0.1:11434/api/tags" -TimeoutSec 3; return } catch { }
    Start-Process -FilePath (Get-Command ollama.exe).Source -ArgumentList "serve" -WindowStyle Minimized
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        try { $null = Invoke-RestMethod "http://127.0.0.1:11434/api/tags" -TimeoutSec 2; return } catch { }
    }
    throw "Ollama service did not become reachable. Manual CV import remains available."
}
function Preserve([string]$Name, [string]$From, [string]$To) {
    $source = Join-Path $From $Name
    if (Test-Path -LiteralPath $source) {
        $target = Join-Path $To $Name
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
    }
}
if ($env:OS -ne "Windows_NT") { throw "This installer supports Windows only." }
$InstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
if ($InstallDir -eq [IO.Path]::GetPathRoot($InstallDir).TrimEnd('\') -or $InstallDir -eq $env:USERPROFILE -or $InstallDir -eq $env:LOCALAPPDATA) { throw "Choose an application subfolder, not a drive or user folder." }
if (Test-Path -LiteralPath $InstallDir) {
    $manifest = Join-Path $InstallDir "package.json"
    if (-not (Test-Path $manifest) -or (Get-Content $manifest -Raw | ConvertFrom-Json).name -ne "apply-lite") { throw "Destination is not an ApplyLite installation. Refusing to replace it." }
    if (Test-Path (Join-Path $InstallDir '.git')) { throw "This is a Git checkout. Update it with git pull and npm ci, or install to a separate folder." }
}
$listeners = Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue
$processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\').IndexOf($InstallDir, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
if ($listeners -or $processes) { throw "Close ApplyLite with Ctrl+C before updating. Port 4310 or a process in the installation is still active." }
Write-Host "ApplyLite installer / data-preserving updater" -ForegroundColor Green
Write-Host "Destination: $InstallDir"
Install-Node
$parent = Split-Path -Parent $InstallDir
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$stage = Join-Path $parent ("ApplyLite-staging-" + [guid]::NewGuid().ToString("N"))
$temp = Join-Path $env:TEMP ("applylite-download-" + [guid]::NewGuid().ToString("N"))
$backup = $null
New-Item -ItemType Directory -Path $stage, $temp -Force | Out-Null
try {
    Step "Downloading a fixed GitHub commit"
    $head = Invoke-RestMethod "https://api.github.com/repos/$Repo/commits/main" -Headers @{ "User-Agent" = "ApplyLite-Installer" } -TimeoutSec 30
    $sha = [string]$head.sha
    if ($sha -notmatch '^[0-9a-f]{40}$') { throw "GitHub returned an invalid commit identifier." }
    $archive = Join-Path $temp 'source.zip'
    Invoke-WebRequest "https://github.com/$Repo/archive/$sha.zip" -OutFile $archive -UseBasicParsing -TimeoutSec 300
    Expand-Archive $archive -DestinationPath (Join-Path $temp 'source')
    $source = Get-ChildItem (Join-Path $temp 'source') -Directory | Select-Object -First 1
    if (-not $source -or -not (Test-Path (Join-Path $source.FullName 'package-lock.json'))) { throw "Incomplete source archive." }
    Get-ChildItem -LiteralPath $source.FullName -Force | Copy-Item -Destination $stage -Recurse -Force
    Set-Location $stage
    Step "Installing locked Windows dependencies in staging"
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed. Existing installation is untouched." }
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw "Typecheck failed. Existing installation is untouched." }
    & npm.cmd run regression:reliability
    if ($LASTEXITCODE -ne 0) { throw "Reliability checks failed. Existing installation is untouched." }
    Step "Installing Playwright Chromium"
    & npx.cmd playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw "Browser installation failed. Existing installation is untouched." }
    if (Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue) { throw "ApplyLite was started during the update. Close it and retry; the old installation is untouched." }
    if (Test-Path -LiteralPath $InstallDir) {
        Step "Preserving local data and settings"
        foreach ($name in @('.env','data','storage','backups','exports','.secrets','.maintenance','apps\api\.env','apps\api\.secrets','apps\api\.maintenance','apps\api\data','apps\api\storage','apps\api\backups','apps\api\exports')) { Preserve $name $InstallDir $stage }
    }
    if (-not (Test-Path (Join-Path $stage '.env'))) { Copy-Item (Join-Path $stage '.env.example') (Join-Path $stage '.env') }
    foreach ($file in @('.env','apps\api\.env')) {
        $envPath = Join-Path $stage $file
        if (Test-Path $envPath) {
            $line = Get-Content $envPath | Where-Object { $_ -match '^\s*OLLAMA_MODEL\s*=' } | Select-Object -Last 1
            if ($line) { $Model = (($line -split '=', 2)[1] -split '\s+#', 2)[0].Trim().Trim('"').Trim("'") }
        }
    }
    if (-not $SkipAI) {
        try {
            Ensure-Ollama
            if (-not $SkipModel) { Step "Ensuring $Model is available (may download several GB)"; & ollama.exe pull $Model; if ($LASTEXITCODE -ne 0) { throw "Model download failed." } }
        } catch { Write-Warning "AI setup incomplete: $($_.Exception.Message) CV import/editing and profile matching remain available without AI." }
    }
    Set-Content (Join-Path $stage '.installed-commit') $sha -Encoding ascii
    $InstalledVersion = ((Get-Content (Join-Path $stage 'package.json') -Raw | ConvertFrom-Json).version)
    Set-Location $parent
    if (Test-Path -LiteralPath $InstallDir) {
        $backup = "$InstallDir.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N').Substring(0,6))"
        Move-Item -LiteralPath $InstallDir -Destination $backup
    }
    try {
        Move-Item -LiteralPath $stage -Destination $InstallDir
        # npm workspace junctions may still point at staging on Windows. Relink at the final path.
        & node.exe (Join-Path $InstallDir 'scripts\relink-workspaces.cjs') $InstallDir
        if ($LASTEXITCODE -ne 0) { throw "Workspace relinking failed." }
    } catch {
        if (Test-Path -LiteralPath $InstallDir) { Move-Item -LiteralPath $InstallDir -Destination "$InstallDir.failed-$([guid]::NewGuid().ToString('N'))" }
        if ($backup -and (Test-Path -LiteralPath $backup)) { Move-Item -LiteralPath $backup -Destination $InstallDir }
        throw
    }
    Write-Host "`nApplyLite $InstalledVersion installed." -ForegroundColor Green
    if ($backup) { Write-Host "Rollback copy: $backup" }
    Write-Host "Start: $InstallDir\Start ApplyLite.cmd"
    Write-Host "Future updates: Update ApplyLite.cmd (close ApplyLite first)."
    if (-not $NoRun) { Start-Process powershell.exe -ArgumentList @('-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$(Join-Path $InstallDir 'scripts\Start-ApplyLite.ps1')`"") }
} finally {
    Set-Location $OriginalLocation
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
