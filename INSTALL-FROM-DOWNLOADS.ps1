#Requires -Version 5.1
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$ZipPath = "",
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
$folders = @("promo-publisher", "scripts", "docs", "tools")

function Ensure-Dir {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

if (-not $ZipPath) {
  $downloads = Join-Path $env:USERPROFILE "Downloads"
  $candidates = Get-ChildItem $downloads -Filter "*.zip" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "claude-code-local|shibass-social" } |
    Sort-Object LastWriteTime -Descending
  if ($candidates) {
    $ZipPath = $candidates[0].FullName
  }
}

if (-not $ZipPath -or -not (Test-Path $ZipPath)) {
  Write-Host "ZIP not found. Put the file in Downloads or pass -ZipPath" -ForegroundColor Red
  Write-Host 'Example: -ZipPath "$env:USERPROFILE\Downloads\claude-code-local-cursor-shibass-social-studio-c044.zip"'
  exit 1
}

Write-Host "ZIP: $ZipPath" -ForegroundColor Cyan
Write-Host "Target: $TargetRoot" -ForegroundColor Cyan

$staging = Join-Path $env:TEMP ("shibass-zip-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
Ensure-Dir $staging
Ensure-Dir $TargetRoot

Write-Host "Extracting..." -ForegroundColor Yellow
Expand-Archive -Path $ZipPath -DestinationPath $staging -Force

$repoRoot = Get-ChildItem $staging -Directory | Select-Object -First 1
if (-not $repoRoot) {
  Write-Host "Bad ZIP - no folder inside." -ForegroundColor Red
  exit 1
}

Write-Host ("Source: " + $repoRoot.FullName) -ForegroundColor DarkGray

foreach ($name in $folders) {
  $src = Join-Path $repoRoot.FullName $name
  $dst = Join-Path $TargetRoot $name
  if (-not (Test-Path $src)) {
    Write-Host ("SKIP: " + $name) -ForegroundColor Yellow
    continue
  }
  if (Test-Path $dst) {
    Write-Host ("Update: " + $name) -ForegroundColor Green
    Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force
  } else {
    Write-Host ("Create: " + $name) -ForegroundColor Green
    Copy-Item -Path $src -Destination $dst -Recurse -Force
  }
}

Ensure-Dir (Join-Path $TargetRoot "config")
$cfgSrc = Join-Path $repoRoot.FullName "scripts\config"
if (Test-Path $cfgSrc) {
  Copy-Item -Path (Join-Path $cfgSrc "*") -Destination (Join-Path $TargetRoot "config") -Force
  Write-Host "Config copied" -ForegroundColor Green
}

Ensure-Dir (Join-Path $TargetRoot "10_OUTPUTS\social")

foreach ($f in @(
    "INSTALL-SHIBASS-UPDATES.ps1",
    "INSTALL-SHIBASS-UPDATES.cmd",
    "INSTALL-FROM-DOWNLOADS.ps1",
    "START-SOCIAL-STUDIO.cmd",
    "START-MIDI-FORGE-DEMUCS.cmd"
  )) {
  $sf = Join-Path $repoRoot.FullName $f
  if (Test-Path $sf) {
    Copy-Item $sf (Join-Path $TargetRoot $f) -Force
  }
}

Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue

if (-not $SkipNpmInstall) {
  $pp = Join-Path $TargetRoot "promo-publisher"
  if ((Test-Path $pp) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "npm install..." -ForegroundColor Yellow
    Push-Location $pp
    & npm install
    Pop-Location
  }
}

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
Write-Host ("Social: cd " + $TargetRoot + "\promo-publisher; npm start")
Write-Host ("Demucs: powershell -ExecutionPolicy Bypass -File " + $TargetRoot + "\scripts\start-demucs-pipeline.ps1")
Write-Host ("Guide:  " + $TargetRoot + "\docs\DEMUCS_QUICKSTART_HE.md")
Write-Host ""
