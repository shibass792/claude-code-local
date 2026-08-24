#Requires -Version 5.1
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$ZipPath = "",
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
$folders = @("promo-publisher", "scripts", "docs", "tools")

$FreshZipUrl = "https://github.com/shibass792/claude-code-local/archive/refs/heads/cursor/shibass-social-studio-c044.zip"
$RequiredInZip = @(
  "scripts\wire-demucs-for-midi-forge.ps1",
  "scripts\start-demucs-pipeline.ps1",
  "scripts\watch-midi-export-demucs.ps1",
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
$zipInfo = Get-Item $ZipPath
Write-Host ("      modified " + $zipInfo.LastWriteTime) -ForegroundColor DarkGray
Write-Host "Target: $TargetRoot" -ForegroundColor Cyan

$staging = Join-Path $env:TEMP ("shibass-zip-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
Ensure-Dir $staging
Ensure-Dir $TargetRoot

Write-Host "Extracting..." -ForegroundColor Yellow
Expand-Archive -Path $ZipPath -DestinationPath $staging -Force

$repoRootFull = $null
foreach ($dir in (Get-ChildItem $staging -Directory -ErrorAction SilentlyContinue)) {
  $resolveInZip = Join-Path $dir.FullName "scripts\Resolve-ShibassZipSource.ps1"
  if (Test-Path $resolveInZip) {
    $repoRootFull = & $resolveInZip -StagingDir $staging
    break
  }
}
if (-not $repoRootFull) {
  $first = Get-ChildItem $staging -Directory | Select-Object -First 1
  if (-not $first) {
    Write-Host "Bad ZIP - no folder inside." -ForegroundColor Red
    exit 1
  }
  $repoRootFull = $first.FullName
}

Write-Host ("Source: " + $repoRootFull) -ForegroundColor DarkGray

$missingInZip = Test-ShibassZipSource -SourceRoot $repoRootFull
if ($missingInZip.Count -gt 0) {
  Write-Host ""
  Write-Host "STALE or wrong ZIP — required files missing:" -ForegroundColor Red
  foreach ($m in $missingInZip) {
    Write-Host ("  - " + $m) -ForegroundColor Red
  }
  Write-Host ""
  Write-Host "Re-download:" -ForegroundColor Yellow
  Write-Host $FreshZipUrl
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  exit 2
}

$fixPathsInZip = Join-Path $repoRootFull "tools\script_fix_paths.ps1"
if ((Get-Content -LiteralPath $fixPathsInZip -Raw) -match '\$\.PSIsContainer') {
  Write-Host ""
  Write-Host "STALE ZIP — tools\script_fix_paths.ps1 has broken `$.PSIsContainer (use fresh branch ZIP)." -ForegroundColor Red
  Write-Host $FreshZipUrl -ForegroundColor Yellow
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  exit 2
}

$repoRoot = Get-Item $repoRootFull

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
    "COPY-ALL-FROM-ZIP.ps1",
    "COPY-ALL-FROM-ZIP.cmd",
    "INSTALL-SHIBASS-UPDATES.ps1",
    "INSTALL-SHIBASS-UPDATES.cmd",
    "INSTALL-FROM-DOWNLOADS.ps1",
    "START-SOCIAL-STUDIO.cmd",
    "START-MIDI-FORGE-DEMUCS.cmd",
    "Scan.ps1"
  )) {
  $sf = Join-Path $repoRoot.FullName $f
  if (Test-Path $sf) {
    Copy-Item $sf (Join-Path $TargetRoot $f) -Force
  }
}

Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue

$verify = @(
  (Join-Path $TargetRoot "scripts\wire-demucs-for-midi-forge.ps1"),
  (Join-Path $TargetRoot "scripts\start-demucs-pipeline.ps1"),
  (Join-Path $TargetRoot "tools\demucs_wav_hook.py")
)
$verifyFailed = $false
Write-Host ""
Write-Host "Verify:" -ForegroundColor White
foreach ($c in $verify) {
  if (Test-Path $c) {
    Write-Host ("  OK   " + $c) -ForegroundColor Green
  } else {
    Write-Host ("  MISS " + $c) -ForegroundColor Red
    $verifyFailed = $true
  }
}
if ($verifyFailed) {
  Write-Host "Verification failed after copy." -ForegroundColor Red
  exit 3
}

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
