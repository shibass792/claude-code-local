#Requires -Version 5.1
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$Branch = "cursor/real-studio-apis-0b72",
  [string]$RepoUrl = "https://github.com/shibass792/claude-code-local.git",
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$foldersToCopy = @("promo-publisher", "scripts", "docs", "tools")

function Write-Step {
  param([string]$Msg)
  Write-Host ""
  Write-Host ">> $Msg" -ForegroundColor Cyan
}

function Ensure-Dir {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Get-RepoSourceRoot {
  param(
    [string]$Staging,
    [string]$BranchName,
    [string]$GitUrl
  )

  $branchSafe = $BranchName.Replace("/", "-")
  $zipPath = Join-Path $env:TEMP ("shibass-" + $branchSafe + ".zip")
  $zipUrl = "https://github.com/shibass792/claude-code-local/archive/refs/heads/" + $BranchName + ".zip"
  $zipOk = $false

  Write-Step "Downloading from GitHub..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $prevErr = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
  if ($LASTEXITCODE -eq 0 -or (Test-Path $zipPath)) {
    if ((Test-Path $zipPath) -and ((Get-Item $zipPath).Length -gt 1000)) {
      $zipOk = $true
    }
  }
  $ErrorActionPreference = $prevErr

  if ($zipOk) {
    Write-Step "Extracting ZIP..."
    Expand-Archive -Path $zipPath -DestinationPath $Staging -Force
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    $folder = Get-ChildItem $Staging -Directory | Select-Object -First 1
    if ($folder) {
      return $folder.FullName
    }
  }

  Write-Host "ZIP download failed - trying git clone..." -ForegroundColor Yellow
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Cannot download ZIP and git is not installed."
  }

  & git clone --depth 1 --branch $BranchName $GitUrl $Staging
  if ($LASTEXITCODE -ne 0) {
    throw "git clone failed."
  }

  $folder = Get-ChildItem $Staging -Directory | Select-Object -First 1
  if (-not $folder) {
    throw "Clone folder is empty."
  }
  return $folder.FullName
}

function Copy-RepoToTarget {
  param([string]$SourceRoot)

  Write-Step ("Copying to " + $TargetRoot + " ...")
  foreach ($name in $foldersToCopy) {
    $src = Join-Path $SourceRoot $name
    $dst = Join-Path $TargetRoot $name
    if (-not (Test-Path $src)) {
      Write-Host ("  SKIP: " + $name) -ForegroundColor Yellow
      continue
    }
    if (Test-Path $dst) {
      Write-Host ("  Update: " + $name) -ForegroundColor DarkGray
      Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force
    } else {
      Write-Host ("  Create: " + $name) -ForegroundColor Green
      Copy-Item -Path $src -Destination $dst -Recurse -Force
    }
  }

  Ensure-Dir (Join-Path $TargetRoot "config")
  $portsSrc = Join-Path $SourceRoot "scripts\config"
  if (Test-Path $portsSrc) {
    Copy-Item -Path (Join-Path $portsSrc "*") -Destination (Join-Path $TargetRoot "config") -Force
  }

  Ensure-Dir (Join-Path $TargetRoot "10_OUTPUTS\social")

  $files = @(
    "INSTALL-SHIBASS-UPDATES.ps1",
    "INSTALL-SHIBASS-UPDATES.cmd",
    "INSTALL-CLAUDE-MCP.ps1",
    "INSTALL-CLAUDE-MCP.cmd",
    "INSTALL-SB-DAW-JOBS.ps1",
    "INSTALL-SB-DAW-JOBS.cmd",
    "INSTALL-OS-BRIDGE.ps1",
    "Scan-ShiBassApis.ps1",
    "UPDATE-LOCAL-PC.ps1",
    "UPDATE-LOCAL-PC.cmd",
    "INSTALL-KIRO-CREW.ps1",
    "START-KIRO-CREW.ps1",
    "START-KIRO-CREW.cmd",
    "START-SOCIAL-STUDIO.cmd",
    "START-STUDIO-API.cmd",
    "START-CLAUDE-MCP-SETUP.cmd"
  )
  foreach ($f in $files) {
    $srcFile = Join-Path $SourceRoot $f
    if (Test-Path $srcFile) {
      Copy-Item $srcFile (Join-Path $TargetRoot $f) -Force
    }
  }
}

Write-Host ""
Write-Host "ShiBass - Download updates to PC" -ForegroundColor Green
Write-Host ("Target: " + $TargetRoot)
Write-Host ("Branch: " + $Branch)
Write-Host ""

Ensure-Dir $TargetRoot
$staging = Join-Path $env:TEMP ("shibass-clone-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
Ensure-Dir $staging

$sourceRoot = Get-RepoSourceRoot -Staging $staging -BranchName $Branch -GitUrl $RepoUrl
Copy-RepoToTarget -SourceRoot $sourceRoot

if (-not $SkipNpmInstall) {
  $pp = Join-Path $TargetRoot "promo-publisher"
  if ((Test-Path $pp) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Step "npm install..."
    Push-Location $pp
    & npm install
    Pop-Location
  }
}

$mcpInstaller = Join-Path $TargetRoot "INSTALL-CLAUDE-MCP.ps1"
if (Test-Path $mcpInstaller) {
  Write-Step "Installing Claude MCP on this PC..."
  $mcpOk = $true
  $prevErr = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $mcpInstaller
  if ($LASTEXITCODE -ne 0) { $mcpOk = $false }
  $ErrorActionPreference = $prevErr
  if (-not $mcpOk) {
    Write-Host "Claude MCP install reported an error - .claude folder + settings may still have been written." -ForegroundColor Yellow
  }
}

$sbDaw = Join-Path $TargetRoot "tools\sb-daw\Patch-SbDawJobs.ps1"
if (Test-Path -LiteralPath $sbDaw) {
  Write-Step "Mounting /api/sb-daw/jobs/ on server.js..."
  $prevDaw = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $sbDaw -TargetRoot $TargetRoot
  if ($LASTEXITCODE -ne 0) {
    Write-Host "sb-daw jobs patch reported an error. Run INSTALL-SB-DAW-JOBS.cmd after Node is on PATH." -ForegroundColor Yellow
  }
  $ErrorActionPreference = $prevDaw
}

$osBridge = Join-Path $TargetRoot "tools\os-bridge\Patch-OsBridge.ps1"
if (Test-Path -LiteralPath $osBridge) {
  Write-Step "Mounting OS bridge on server.js (4000 -> 4052)..."
  $prevOs = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $osBridge -TargetRoot $TargetRoot -Branch $Branch
  if ($LASTEXITCODE -ne 0) {
    Write-Host "OS bridge patch reported an error. Run UPDATE-LOCAL-PC.ps1 after Node is on PATH." -ForegroundColor Yellow
  }
  $ErrorActionPreference = $prevOs
}

Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
Write-Host ("Doctor: " + $TargetRoot + "\scripts\shibass-doctor.ps1")
Write-Host ("Social: " + $TargetRoot + "\START-SOCIAL-STUDIO.cmd")
Write-Host ("Studio API: " + $TargetRoot + "\START-STUDIO-API.cmd")
Write-Host ("Claude MCP: " + $TargetRoot + "\INSTALL-CLAUDE-MCP.cmd")
Write-Host ("sb-daw jobs: " + $TargetRoot + "\INSTALL-SB-DAW-JOBS.cmd")
Write-Host ("OS bridge: " + $TargetRoot + "\UPDATE-LOCAL-PC.ps1")
Write-Host ("API scan: " + $TargetRoot + "\Scan-ShiBassApis.ps1")
Write-Host ("Demucs: " + $TargetRoot + "\scripts\wire-demucs-for-midi-forge.ps1")
Write-Host ""
