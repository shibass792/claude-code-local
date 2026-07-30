#Requires -Version 5.1
<#
.SYNOPSIS
  Music Brain - one-click setup + SHIBASS player (+ optional scan).

.DESCRIPTION
  Starts the player IMMEDIATELY so the browser can connect, then optionally
  scans H:\ D:\ F:\ in the background / after.

.EXAMPLE
  .\auto-start.ps1
  .\auto-start.ps1 -ServeOnly
  .\auto-start.ps1 -ScanOnly
  .\auto-start.ps1 -Roots @('H:\','D:\')
#>
param(
  [string[]]$Roots = @("H:\", "D:\", "F:\", "$env:USERPROFILE"),
  [string]$HostAddress = "127.0.0.1",
  [string]$BindHost = "0.0.0.0",
  [int]$Port = 18766,
  [switch]$SkipServe,
  [switch]$ServeOnly,
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
Write-Host "  MUSIC BRAIN  -  ShiBass production intelligence" -ForegroundColor Yellow
Write-Host "  Serve first -> then scan (so browser connects)" -ForegroundColor DarkYellow
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
  Pop-Location
  if (-not $NoPause) { pause }
  exit $LASTEXITCODE
}

# --- SERVE FIRST so browser does not get CONNECTION_REFUSED ---
if (-not $SkipServe) {
  Write-Step "Starting SHIBASS S1 NOW"
  Write-Host "Panel : http://$HostAddress`:$Port/" -ForegroundColor Green
  Write-Host "Remote: http://$HostAddress`:$Port/remote" -ForegroundColor Green
  Write-Host "Keep this window OPEN. Press Ctrl+C to stop." -ForegroundColor Yellow
  Write-Host ""

  # Open browser after a short delay in background
  Start-Job -ScriptBlock {
    param($url)
    Start-Sleep -Seconds 2
    Start-Process $url
  } -ArgumentList "http://$HostAddress`:$Port/" | Out-Null

  if (-not $ServeOnly -and $ExistingRoots.Count -gt 0) {
    Write-Host "Tip: library scan can run in another window:" -ForegroundColor DarkGray
    Write-Host "  .\launchers\MusicBrain-Start.cmd -ScanOnly" -ForegroundColor DarkGray
    Write-Host ""
  }

  try {
    # No --index here: indexing huge drives blocks the port. Serve first.
    & $Py.Exe @($Py.Args) -m music_brain serve --host $BindHost --port $Port
    $ec = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if (-not $NoPause -and $ec -ne 0) { pause }
  exit $ec
}

# SkipServe path: run pipeline only
if ($ExistingRoots.Count -eq 0) {
  Write-Host "ERROR: none of the scan roots exist." -ForegroundColor Red
  Pop-Location
  if (-not $NoPause) { pause }
  exit 1
}

Write-Step "Pipeline (scan + analyze + brain)"
& $Py.Exe @($Py.Args) -m music_brain pipeline @rootArgs @forceArgs -v
Write-Step "Brain summary"
& $Py.Exe @($Py.Args) -m music_brain learn --narrative-only
Pop-Location
if (-not $NoPause) { pause }
exit 0
