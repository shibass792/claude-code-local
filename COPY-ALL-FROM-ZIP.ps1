#Requires -Version 5.1
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$ZipPath = ""
)

$ErrorActionPreference = "Stop"

$FreshZipUrl = "https://github.com/shibass792/claude-code-local/archive/refs/heads/cursor/shibass-social-studio-c044.zip"
$RequiredInZip = @(
  "scripts\wire-demucs-for-midi-forge.ps1",
  "scripts\repair-demucs-venv.ps1",
  "scripts\start-demucs-pipeline.ps1",
  "scripts\watch-midi-export-demucs.ps1",
  "config\demucs-requirements.txt",
  "FIX-DEMUCS-TORCHCODEC.ps1",
  "tools\demucs_wav_hook.py",
  "tools\script_fix_paths.ps1",
  "promo-publisher\main.js"
)

function Test-ShibassZipSource {
  param([string]$SourceRoot)
  $missing = @()
  foreach ($rel in $RequiredInZip) {
    if (-not (Test-Path (Join-Path $SourceRoot $rel))) {
      $missing += $rel
    }
  }
  return $missing
}

if (-not $ZipPath) {
  $ZipPath = Join-Path $env:USERPROFILE "Downloads\claude-code-local-cursor-shibass-social-studio-c044.zip"
}

if (-not (Test-Path $ZipPath)) {
  Write-Host "ZIP missing: $ZipPath" -ForegroundColor Red
  Write-Host "Download the branch ZIP to Downloads first:"
  Write-Host $FreshZipUrl
  exit 1
}

$zipInfo = Get-Item $ZipPath
Write-Host "ZIP:    $ZipPath" -ForegroundColor Cyan
Write-Host ("       modified " + $zipInfo.LastWriteTime) -ForegroundColor DarkGray
Write-Host "Target: $TargetRoot" -ForegroundColor Cyan

$staging = Join-Path $env:TEMP ("shibass-copy-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Expand-Archive -Path $ZipPath -DestinationPath $staging -Force

$src = $null
foreach ($dir in (Get-ChildItem $staging -Directory -ErrorAction SilentlyContinue)) {
  $resolveInZip = Join-Path $dir.FullName "scripts\Resolve-ShibassZipSource.ps1"
  if (Test-Path $resolveInZip) {
    $src = & $resolveInZip -StagingDir $staging
    break
  }
}
if (-not $src) {
  $src = (Get-ChildItem $staging -Directory | Select-Object -First 1).FullName
}
if (-not $src) {
  Write-Host "Bad ZIP layout (no folder inside)." -ForegroundColor Red
  exit 1
}

Write-Host ("Source: " + $src) -ForegroundColor DarkGray

$missingInZip = Test-ShibassZipSource -SourceRoot $src
if ($missingInZip.Count -gt 0) {
  Write-Host ""
  Write-Host "STALE or wrong ZIP — required files missing inside archive:" -ForegroundColor Red
  foreach ($m in $missingInZip) {
    Write-Host ("  - " + $m) -ForegroundColor Red
  }
  Write-Host ""
  Write-Host "Re-download (save as Downloads\claude-code-local-cursor-shibass-social-studio-c044.zip):" -ForegroundColor Yellow
  Write-Host $FreshZipUrl
  Write-Host ""
  Write-Host "Then run this script again. Copy was NOT applied." -ForegroundColor Yellow
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  exit 2
}

$fixPathsInZip = Join-Path $src "tools\script_fix_paths.ps1"
if ((Get-Content -LiteralPath $fixPathsInZip -Raw) -match '\$\.PSIsContainer') {
  Write-Host ""
  Write-Host "STALE ZIP — tools\script_fix_paths.ps1 has broken `$.PSIsContainer (use fresh branch ZIP)." -ForegroundColor Red
  Write-Host $FreshZipUrl -ForegroundColor Yellow
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  exit 2
}

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
  (Join-Path $TargetRoot "tools\script_fix_paths.ps1"),
  (Join-Path $TargetRoot "promo-publisher\main.js")
)
$verifyFailed = $false
foreach ($c in $checks) {
  if (Test-Path $c) {
    Write-Host ("  OK   " + $c) -ForegroundColor Green
  } else {
    Write-Host ("  MISS " + $c) -ForegroundColor Red
    $verifyFailed = $true
  }
}

$fixPathsOnDisk = Join-Path $TargetRoot "tools\script_fix_paths.ps1"
if ((Test-Path $fixPathsOnDisk) -and ((Get-Content -LiteralPath $fixPathsOnDisk -Raw) -match '\$\.PSIsContainer')) {
  Write-Host ""
  Write-Host "  BROKEN tools\script_fix_paths.ps1 still has `$.PSIsContainer after copy." -ForegroundColor Red
  Write-Host "  Run: powershell -ExecutionPolicy Bypass -File $TargetRoot\scripts\repair-script-fix-paths.ps1" -ForegroundColor Yellow
  $verifyFailed = $true
}

if ($verifyFailed) {
  Write-Host ""
  Write-Host "Copy finished but verification failed. Re-download the ZIP and run again." -ForegroundColor Red
  exit 3
}

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File $TargetRoot\scripts\start-demucs-pipeline.ps1"
Write-Host "  cd $TargetRoot\promo-publisher; npm start"
Write-Host ""
