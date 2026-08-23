#Requires -Version 5.1
<#
.SYNOPSIS
  Download ShiBass Social Studio + scripts from GitHub to H:\shibass-ai

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File INSTALL-SHIBASS-UPDATES.ps1
#>
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$Branch = "cursor/shibass-social-studio-c044",
  [string]$RepoUrl = "https://github.com/shibass792/claude-code-local.git",
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$foldersToCopy = @(
  "promo-publisher",
  "scripts",
  "docs",
  "tools"
)

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

function Copy-RepoToTarget {
  param([string]$SourceRoot)

  Write-Step "Copying to $TargetRoot ..."
  foreach ($name in $foldersToCopy) {
    $src = Join-Path $SourceRoot $name
    $dst = Join-Path $TargetRoot $name
    if (-not (Test-Path $src)) {
      Write-Host "  SKIP (missing in repo): $name" -ForegroundColor Yellow
      continue
    }
    Ensure-Dir (Split-Path $dst -Parent)
    if (Test-Path $dst) {
      Write-Host "  Updating $name ..." -ForegroundColor DarkGray
      Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force
    } else {
      Write-Host "  Creating $name ..." -ForegroundColor Green
      Copy-Item -Path $src -Destination $dst -Recurse -Force
    }
  }

  Ensure-Dir (Join-Path $TargetRoot "config")
  $portsSrc = Join-Path $SourceRoot "scripts\config"
  if (Test-Path $portsSrc) {
    Copy-Item -Path (Join-Path $portsSrc "*") -Destination (Join-Path $TargetRoot "config") -Force
    Write-Host "  Config copied to config\" -ForegroundColor Green
  }

  Ensure-Dir (Join-Path $TargetRoot "10_OUTPUTS\social")

  $installerFiles = @(
    "INSTALL-SHIBASS-UPDATES.ps1",
    "INSTALL-SHIBASS-UPDATES.cmd",
    "START-SOCIAL-STUDIO.cmd"
  )
  foreach ($file in $installerFiles) {
    $srcFile = Join-Path $SourceRoot $file
    if (Test-Path $srcFile) {
      Copy-Item $srcFile (Join-Path $TargetRoot $file) -Force
    }
  }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " ShiBass - Download updates to PC" -ForegroundColor Green
Write-Host " Target: $TargetRoot" -ForegroundColor Green
Write-Host " Branch: $Branch" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

Ensure-Dir $TargetRoot
$staging = Join-Path $env:TEMP ("shibass-clone-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
$sourceRoot = $null

try {
  $branchSafe = $Branch.Replace("/", "-")
  $zipPath = Join-Path $env:TEMP ("shibass-" + $branchSafe + ".zip")
  $zipUrl = "https://github.com/shibass792/claude-code-local/archive/refs/heads/" + $Branch + ".zip"

  Write-Step "Downloading from GitHub..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

  Write-Step "Extracting..."
  Expand-Archive -Path $zipPath -DestinationPath $staging -Force
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

  $extractedRoot = Get-ChildItem $staging -Directory | Select-Object -First 1
  if (-not $extractedRoot) {
    throw "Could not find extracted folder under $staging"
  }
  $sourceRoot = $extractedRoot.FullName
}
catch {
  Write-Host ("ZIP failed: " + $_.Exception.Message) -ForegroundColor Yellow
  Write-Host "Trying git clone..." -ForegroundColor Yellow
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Need internet + git, or working GitHub ZIP download."
  }
  & git clone --depth 1 --branch $Branch $RepoUrl $staging
  if ($LASTEXITCODE -ne 0) {
    throw "git clone failed"
  }
  $extractedRoot = Get-ChildItem $staging -Directory | Select-Object -First 1
  if (-not $extractedRoot) {
    throw "clone folder empty"
  }
  $sourceRoot = $extractedRoot.FullName
}

Copy-RepoToTarget -SourceRoot $sourceRoot

if (-not $SkipNpmInstall) {
  $pp = Join-Path $TargetRoot "promo-publisher"
  if ((Test-Path $pp) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Step "npm install (promo-publisher)..."
    Push-Location $pp
    & npm install
    Pop-Location
  } else {
    Write-Host "  SKIP npm - run: cd promo-publisher; npm install" -ForegroundColor Yellow
  }
}

Write-Step "Cleanup temp..."
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host ("  1. Doctor: powershell -ExecutionPolicy Bypass -File `"" + $TargetRoot + "\scripts\shibass-doctor.ps1`"")
Write-Host ("  2. Social: double-click " + $TargetRoot + "\START-SOCIAL-STUDIO.cmd")
Write-Host ("  3. Docs:   " + $TargetRoot + "\docs\SHIBASS_LIVE_TOPOLOGY.md")
Write-Host ""
