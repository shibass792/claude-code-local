#Requires -Version 5.1
<#
.SYNOPSIS
  Music Brain — one-click setup + multi-drive scan/analyze + Cubase Bridge.

.DESCRIPTION
  1) Finds the repo / music-brain package
  2) Ensures Python deps
  3) Scans H:\ D:\ F:\ and your user profile (incremental)
  4) Analyzes new/changed samples + project DNA
  5) Prints Brain summary
  6) Starts Cubase Bridge on http://127.0.0.1:18766

.EXAMPLE
  .\auto-start.ps1
  .\auto-start.ps1 -SkipServe
  .\auto-start.ps1 -ScanOnly
  .\auto-start.ps1 -Roots @('H:\','D:\')
#>
param(
  [string[]]$Roots = @("H:\", "D:\", "F:\", "$env:USERPROFILE"),
  [string]$HostAddress = "127.0.0.1",
  [int]$Port = 18766,
  [switch]$SkipServe,
  [switch]$ScanOnly,
  [switch]$Force,
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "=== $msg ===" -ForegroundColor Cyan
}

function Find-MusicBrainRoot {
  $candidates = @(
    (Resolve-Path (Join-Path $ScriptDir "..\..\music-brain") -ErrorAction SilentlyContinue).Path
    (Join-Path $ScriptDir "..\..\music-brain")
    (Join-Path $env:USERPROFILE "claude-code-local\music-brain")
    (Join-Path $env:USERPROFILE "Desktop\claude-code-local\music-brain")
    (Join-Path $env:USERPROFILE "Desktop\Local AI Setup\music-brain")
    "H:\shibass-ai\claude-code-local\music-brain"
    "H:\claude-code-local\music-brain"
    "H:\shibass-ai\music-brain"
    "D:\claude-code-local\music-brain"
  ) | Where-Object { $_ }

  foreach ($c in $candidates) {
    $cli = Join-Path $c "music_brain\cli.py"
    if (Test-Path -LiteralPath $cli) {
      return (Resolve-Path -LiteralPath $c).Path
    }
  }
  return $null
}

function Find-Python {
  foreach ($name in @("python", "py")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) {
      if ($name -eq "py") {
        return @{ Exe = $cmd.Source; Args = @("-3") }
      }
      # Reject Windows Store stub
      try {
        $ver = & $cmd.Source --version 2>&1 | Out-String
        if ($ver -match "Python 3") {
          return @{ Exe = $cmd.Source; Args = @() }
        }
      } catch { }
    }
  }
  return $null
}

Write-Host ""
Write-Host "  MUSIC BRAIN  —  ShiBass production intelligence" -ForegroundColor Yellow
Write-Host "  Scan → Analyze → Learn → Cubase Bridge" -ForegroundColor DarkYellow
Write-Host ""

$MbRoot = Find-MusicBrainRoot
if (-not $MbRoot) {
  Write-Host "ERROR: music-brain package not found." -ForegroundColor Red
  Write-Host "Clone/pull claude-code-local so music-brain\music_brain\cli.py exists."
  if (-not $NoPause) { pause }
  exit 1
}
Write-Host "Package: $MbRoot"

$Py = Find-Python
if (-not $Py) {
  Write-Host "ERROR: Python 3 not found on PATH." -ForegroundColor Red
  Write-Host "Install from https://www.python.org/downloads/  (check 'Add to PATH')."
  if (-not $NoPause) { pause }
  exit 1
}
Write-Host "Python:  $($Py.Exe) $($Py.Args -join ' ')"

# Existing roots only
$ExistingRoots = @()
foreach ($r in $Roots) {
  if ([string]::IsNullOrWhiteSpace($r)) { continue }
  if (Test-Path -LiteralPath $r) {
    $ExistingRoots += $r
    Write-Host "Root OK: $r" -ForegroundColor Green
  } else {
    Write-Host "Root SKIP (missing): $r" -ForegroundColor DarkGray
  }
}
if ($ExistingRoots.Count -eq 0) {
  Write-Host "ERROR: none of the scan roots exist." -ForegroundColor Red
  if (-not $NoPause) { pause }
  exit 1
}

Write-Step "Install / upgrade package"
Push-Location $MbRoot
try {
  & $Py.Exe @($Py.Args) -m pip install -e . -q
  if ($LASTEXITCODE -ne 0) {
    throw "pip install failed (exit $LASTEXITCODE)"
  }
} catch {
  Write-Host "WARN: pip install -e . failed: $_" -ForegroundColor Yellow
  Write-Host "Continuing with PYTHONPATH fallback..."
}
$env:PYTHONPATH = $MbRoot

$rootArgs = @()
foreach ($r in $ExistingRoots) {
  $rootArgs += @("--root", $r)
}
$forceArgs = @()
if ($Force) { $forceArgs = @("--force") }

if ($ScanOnly) {
  Write-Step "Scan only"
  & $Py.Exe @($Py.Args) -m music_brain scan @rootArgs @forceArgs -v
} else {
  Write-Step "Pipeline (scan + analyze + brain)"
  & $Py.Exe @($Py.Args) -m music_brain pipeline @rootArgs @forceArgs -v
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Pipeline failed with exit $LASTEXITCODE" -ForegroundColor Red
    if (-not $NoPause) { pause }
    exit $LASTEXITCODE
  }

  Write-Step "Brain summary"
  & $Py.Exe @($Py.Args) -m music_brain learn --narrative-only
}

Write-Host ""
Write-Host "Quick commands after this:" -ForegroundColor Cyan
Write-Host '  music-brain search "באס כמו Astrix"'
Write-Host "  music-brain match --family bass --bpm 142 --limit 26"
Write-Host "  music-brain match --melodies --key F# --limit 9"
Write-Host "  GET http://$HostAddress`:$Port/match/bass?bpm=142"
Write-Host "  GET http://$HostAddress`:$Port/search?q=bass+like+Astrix"
Write-Host "  POST http://$HostAddress`:$Port/project/open  {""path"":""H:\\Projects\\track.cpr""}"

if ($SkipServe) {
  Write-Host ""
  Write-Host "Done (-SkipServe). Cubase Bridge not started." -ForegroundColor Green
  Pop-Location
  if (-not $NoPause) { pause }
  exit 0
}

Write-Step "Cubase Bridge  http://$HostAddress`:$Port"
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""
try {
  & $Py.Exe @($Py.Args) -m music_brain serve --host $HostAddress --port $Port
  $ec = $LASTEXITCODE
} finally {
  Pop-Location
}
if (-not $NoPause -and $ec -ne 0) { pause }
exit $ec
