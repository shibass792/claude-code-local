#Requires -Version 5.1
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$ZipPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $ZipPath) {
  $ZipPath = Join-Path $env:USERPROFILE "Downloads\claude-code-local-cursor-shibass-social-studio-c044.zip"
}

if (-not (Test-Path $ZipPath)) {
  Write-Host "ZIP missing: $ZipPath" -ForegroundColor Red
  Write-Host "Download the branch ZIP to Downloads first."
  exit 1
}

Write-Host "ZIP:    $ZipPath" -ForegroundColor Cyan
Write-Host "Target: $TargetRoot" -ForegroundColor Cyan

$staging = Join-Path $env:TEMP ("shibass-copy-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Expand-Archive -Path $ZipPath -DestinationPath $staging -Force

$src = (Get-ChildItem $staging -Directory | Select-Object -First 1).FullName
if (-not $src) {
  Write-Host "Bad ZIP layout" -ForegroundColor Red
  exit 1
}

Write-Host ("Source: " + $src) -ForegroundColor DarkGray

foreach ($name in @("scripts", "tools", "docs", "promo-publisher")) {
  $from = Join-Path $src $name
  $to = Join-Path $TargetRoot $name
  if (-not (Test-Path $from)) {
    Write-Host ("SKIP missing in ZIP: " + $name) -ForegroundColor Yellow
    continue
  }
  if (-not (Test-Path $to)) {
    New-Item -ItemType Directory -Path $to -Force | Out-Null
  }
  Copy-Item -Path (Join-Path $from "*") -Destination $to -Recurse -Force
  Write-Host ("OK  " + $name) -ForegroundColor Green
}

$cfgFrom = Join-Path $src "scripts\config"
$cfgTo = Join-Path $TargetRoot "config"
if (Test-Path $cfgFrom) {
  if (-not (Test-Path $cfgTo)) {
    New-Item -ItemType Directory -Path $cfgTo -Force | Out-Null
  }
  Copy-Item -Path (Join-Path $cfgFrom "*") -Destination $cfgTo -Force
  Write-Host "OK  config" -ForegroundColor Green
}

foreach ($f in @(
    "COPY-ALL-FROM-ZIP.ps1",
    "INSTALL-FROM-DOWNLOADS.ps1",
    "INSTALL-SHIBASS-UPDATES.ps1",
    "INSTALL-SHIBASS-UPDATES.cmd",
    "START-SOCIAL-STUDIO.cmd",
    "START-MIDI-FORGE-DEMUCS.cmd"
  )) {
  $sf = Join-Path $src $f
  if (Test-Path $sf) {
    Copy-Item $sf (Join-Path $TargetRoot $f) -Force
    Write-Host ("OK  " + $f) -ForegroundColor Green
  }
}

Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Verify:" -ForegroundColor White
$checks = @(
  (Join-Path $TargetRoot "scripts\wire-demucs-for-midi-forge.ps1"),
  (Join-Path $TargetRoot "tools\demucs_wav_hook.py"),
  (Join-Path $TargetRoot "promo-publisher\main.js")
)
foreach ($c in $checks) {
  if (Test-Path $c) {
    Write-Host ("  OK   " + $c) -ForegroundColor Green
  } else {
    Write-Host ("  MISS " + $c) -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File $TargetRoot\scripts\start-demucs-pipeline.ps1"
Write-Host "  cd $TargetRoot\promo-publisher; npm start"
Write-Host ""
