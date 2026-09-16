[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "ApplyLite"),
    [switch]$NoRun,
    [switch]$SkipModel
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "allanrodz/ApplyLite"
$ArchiveUrl = "https://github.com/$Repo/archive/refs/heads/main.zip"
$RequiredNodeMajor = 20
$Model = "qwen3:8b"

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Refresh-ProcessPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $extra = @(
        "$env:ProgramFiles\nodejs",
        "$env:LOCALAPPDATA\Programs\Ollama"
    ) -join ";"
    $env:Path = "$machine;$user;$extra"
}

function Get-NodeMajor {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { return 0 }
    try {
        return [int]((& node --version).Trim().TrimStart("v").Split(".")[0])
    } catch {
        return 0
    }
}

function Install-Node {
    if ((Get-NodeMajor) -ge $RequiredNodeMajor) {
        Write-Host "Node.js $(& node --version) is already installed." -ForegroundColor Green
        return
    }

    Write-Step "Installing Node.js LTS"
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        & winget install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements --silent
        Refresh-ProcessPath
    }

    if ((Get-NodeMajor) -ge $RequiredNodeMajor) { return }

    Write-Host "winget was unavailable or Node.js is still missing; using the official Node.js MSI." -ForegroundColor Yellow
    $releases = Invoke-RestMethod "https://nodejs.org/dist/index.json"
    $release = $releases |
        Where-Object {
            $_.lts -and ([int]$_.version.TrimStart("v").Split(".")[0] -ge $RequiredNodeMajor)
        } |
        Select-Object -First 1

    if (-not $release) { throw "Could not resolve a current Node.js LTS release." }

    $arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "arm64" } else { "x64" }
    $version = $release.version
    $msi = Join-Path $env:TEMP "node-$version-$arch.msi"
    $url = "https://nodejs.org/dist/$version/node-$version-$arch.msi"
    Invoke-WebRequest $url -OutFile $msi -UseBasicParsing
    Start-Process msiexec.exe -Verb RunAs -Wait -ArgumentList @("/i", "`"$msi`"", "/qn", "/norestart")
    Remove-Item $msi -Force -ErrorAction SilentlyContinue
    Refresh-ProcessPath

    if ((Get-NodeMajor) -lt $RequiredNodeMajor) {
        throw "Node.js installation completed but Node.js $RequiredNodeMajor+ is not available in this PowerShell session. Open a new PowerShell window and run the installer again."
    }
}

function Ensure-Ollama {
    Refresh-ProcessPath
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        Write-Step "Installing Ollama"
        $ollamaInstall = Invoke-RestMethod "https://ollama.com/install.ps1"
        & ([scriptblock]::Create([string]$ollamaInstall))
        Refresh-ProcessPath
    }

    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        throw "Ollama installation completed but ollama.exe was not found. Open a new PowerShell window and run the installer again."
    }

    $ready = $false
    try {
        $null = Invoke-RestMethod "http://127.0.0.1:11434/api/tags" -TimeoutSec 2
        $ready = $true
    } catch { }

    if (-not $ready) {
        Write-Host "Starting Ollama..." -ForegroundColor Yellow
        Start-Process -FilePath (Get-Command ollama).Source -ArgumentList "serve" -WindowStyle Minimized
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 1
            try {
                $null = Invoke-RestMethod "http://127.0.0.1:11434/api/tags" -TimeoutSec 2
                $ready = $true
                break
            } catch { }
        }
    }

    if (-not $ready) { throw "Ollama was installed but its local API did not become ready." }
}

function Copy-PersistentItem([string]$Name, [string]$BackupDir) {
    $source = Join-Path $InstallDir $Name
    if (Test-Path $source) {
        Copy-Item $source (Join-Path $BackupDir $Name) -Recurse -Force
    }
}

function Restore-PersistentItem([string]$Name, [string]$BackupDir) {
    $source = Join-Path $BackupDir $Name
    if (Test-Path $source) {
        $destination = Join-Path $InstallDir $Name
        if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }
        Copy-Item $source $destination -Recurse -Force
    }
}

if ($env:OS -ne "Windows_NT") {
    throw "This installer currently supports Windows only."
}

Write-Host "ApplyLite installer" -ForegroundColor Green
Write-Host "Repository: https://github.com/$Repo"
Write-Host "Install directory: $InstallDir"

Install-Node
Ensure-Ollama

Write-Step "Downloading ApplyLite"
$tempRoot = Join-Path $env:TEMP ("applylite-install-" + [guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $tempRoot "ApplyLite.zip"
$extractPath = Join-Path $tempRoot "source"
$persistPath = Join-Path $tempRoot "persist"
New-Item -ItemType Directory -Path $extractPath, $persistPath -Force | Out-Null

try {
    Invoke-WebRequest $ArchiveUrl -OutFile $zipPath -UseBasicParsing
    Expand-Archive $zipPath -DestinationPath $extractPath -Force
    $sourceRoot = Get-ChildItem $extractPath -Directory | Select-Object -First 1
    if (-not $sourceRoot) { throw "Downloaded archive did not contain the ApplyLite source directory." }

    if (Test-Path $InstallDir) {
        Write-Step "Preserving existing ApplyLite data"
        foreach ($name in @(
            ".env",
            "data",
            "storage",
            "backups",
            "exports",
            "apps\api\.env",
            "apps\api\.secrets",
            "apps\api\data",
            "apps\api\storage",
            "apps\api\backups",
            "apps\api\exports"
        )) {
            Copy-PersistentItem $name $persistPath
        }

        try {
            Remove-Item $InstallDir -Recurse -Force
        } catch {
            throw "Could not replace $InstallDir. If ApplyLite is running, stop it and run this installer again. $($_.Exception.Message)"
        }
    }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item (Join-Path $sourceRoot.FullName "*") $InstallDir -Recurse -Force
    Copy-Item (Join-Path $sourceRoot.FullName ".gitignore") $InstallDir -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $sourceRoot.FullName ".env.example") $InstallDir -Force

    foreach ($name in @(
        ".env",
        "data",
        "storage",
        "backups",
        "exports",
        "apps\api\.env",
        "apps\api\.secrets",
        "apps\api\data",
        "apps\api\storage",
        "apps\api\backups",
        "apps\api\exports"
    )) {
        Restore-PersistentItem $name $persistPath
    }
} finally {
    Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Set-Location $InstallDir

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
}

# npm workspaces launch the API with apps/api as its current working directory,
# so keep an API-local env file as well. Existing user config is preserved on update.
$apiEnv = Join-Path $InstallDir "apps\api\.env"
if (-not (Test-Path $apiEnv)) {
    Copy-Item (Join-Path $InstallDir ".env") $apiEnv
}

New-Item -ItemType Directory -Path `
    (Join-Path $InstallDir "apps\api\data"), `
    (Join-Path $InstallDir "apps\api\storage") -Force | Out-Null

Write-Step "Installing Node dependencies"
& npm ci
if ($LASTEXITCODE -ne 0) {
    Write-Host "npm ci failed; retrying with npm install..." -ForegroundColor Yellow
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm dependency installation failed." }
}

Write-Step "Installing Playwright Chromium"
& npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw "Playwright Chromium installation failed." }

if (-not $SkipModel) {
    Write-Step "Downloading local AI model $Model"
    Write-Host "This model is several GB and the first installation can take a while." -ForegroundColor Yellow
    & ollama pull $Model
    if ($LASTEXITCODE -ne 0) { throw "Ollama model download failed." }
}

Write-Host "`nApplyLite installation complete." -ForegroundColor Green
Write-Host "Installed at: $InstallDir"
Write-Host "Web app: http://localhost:5173"
Write-Host "API health: http://localhost:4310/health"
Write-Host "Re-run the same installer command later to update ApplyLite while preserving your local data."

if (-not $NoRun) {
    Write-Step "Starting ApplyLite"
    $startScript = Join-Path $InstallDir "scripts\Start-ApplyLite.ps1"
    Start-Process powershell.exe -ArgumentList @(
        "-NoExit",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$startScript`""
    )
}
