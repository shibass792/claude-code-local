#Requires -Version 5.1
<#
.SYNOPSIS
  Search H:/F:/D: + profile for media, install hits into SHIBASS scan memory.

.DESCRIPTION
  Finds audio/MIDI on the big drives and writes them into
  %LOCALAPPDATA%\MusicBrain\knowledge.db so the player panel can see them.

.EXAMPLE
  .\find-and-index.ps1
  .\find-and-index.ps1 -Roots @('H:\','F:\')
#>
param(
  [string[]]$Roots = @("H:\", "F:\", "D:\", "$env:USERPROFILE"),
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Find-Repo {
  foreach ($c in @(
      (Join-Path $ScriptDir "..\..")
      "H:\shibass-ai\claude-code-local"
      "H:\claude-code-local"
      "$env:USERPROFILE\claude-code-local"
    )) {
    $cli = Join-Path $c "music-brain\music_brain\cli.py"
    if (Test-Path -LiteralPath $cli) { return (Resolve-Path $c).Path }
  }
  return $null
}

function Find-Python {
  foreach ($name in @("python", "py")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    if ($name -eq "py") { return @{ Exe = $cmd.Source; Prefix = @("-3") } }
    try {
      $v = & $cmd.Source --version 2>&1 | Out-String
      if ($v -match "Python 3") { return @{ Exe = $cmd.Source; Prefix = @() } }
    } catch {}
  }
  return $null
}

Write-Host ""
Write-Host "  SHIBASS - Find media on H/F and install into scan memory" -ForegroundColor Cyan
Write-Host ""

$Repo = Find-Repo
if (-not $Repo) {
  Write-Host "ERROR: claude-code-local not found." -ForegroundColor Red
  if (-not $NoPause) { pause }
  exit 1
}
$Mb = Join-Path $Repo "music-brain"
$Db = $env:MUSIC_BRAIN_DB
if ([string]::IsNullOrWhiteSpace($Db)) {
  $Db = Join-Path $env:LOCALAPPDATA "MusicBrain\knowledge.db"
}
New-Item -ItemType Directory -Force -Path (Split-Path $Db) | Out-Null

$Py = Find-Python
if (-not $Py) {
  Write-Host "ERROR: Python 3 not on PATH." -ForegroundColor Red
  if (-not $NoPause) { pause }
  exit 1
}

$existing = @()
foreach ($r in $Roots) {
  if (Test-Path -LiteralPath $r) {
    Write-Host "SEARCH ROOT: $r" -ForegroundColor Green
    $existing += $r
  } else {
    Write-Host "SKIP missing: $r" -ForegroundColor DarkGray
  }
}
if ($existing.Count -eq 0) {
  Write-Host "ERROR: no roots to search." -ForegroundColor Red
  if (-not $NoPause) { pause }
  exit 1
}

Write-Host ""
Write-Host "Memory DB: $Db" -ForegroundColor Yellow
Write-Host "Searching WAV/MP3/FLAC/MIDI/AIFF/OGG ..." -ForegroundColor Yellow
Write-Host ""

$env:MUSIC_BRAIN_DB = $Db
$env:PYTHONPATH = $Mb
Set-Location $Mb

# 1) Fast filesystem inventory (so you SEE progress even before Python)
$exts = @("*.wav", "*.mp3", "*.flac", "*.mid", "*.midi", "*.aiff", "*.aif", "*.ogg", "*.m4a")
$found = 0
foreach ($root in $existing) {
  foreach ($pat in $exts) {
    try {
      $n = (Get-ChildItem -LiteralPath $root -Filter $pat -File -Recurse -ErrorAction SilentlyContinue |
        Measure-Object).Count
      if ($n -gt 0) {
        Write-Host ("  {0,-8} on {1} -> {2} files" -f $pat, $root, $n)
        $found += $n
      }
    } catch {}
  }
}
Write-Host ""
Write-Host "Quick count (approx): $found media files visible to PowerShell" -ForegroundColor Cyan
Write-Host "Now indexing into Music Brain DB (this is the real install into memory)..." -ForegroundColor Cyan
Write-Host ""

# 2) Install into persistent DB via music-brain pipeline/scan
$rootArgs = @()
foreach ($r in $existing) { $rootArgs += @("--root", $r) }

& $Py.Exe @($Py.Prefix) -m music_brain scan @rootArgs -v
$scanEc = $LASTEXITCODE
if ($scanEc -ne 0) {
  Write-Host "scan failed: $scanEc" -ForegroundColor Red
  if (-not $NoPause) { pause }
  exit $scanEc
}

Write-Host ""
Write-Host "Analyzing samples / project DNA (styles, BPM, key)..." -ForegroundColor Cyan
& $Py.Exe @($Py.Prefix) -m music_brain analyze -v
& $Py.Exe @($Py.Prefix) -m music_brain status

Write-Host ""
Write-Host "DONE. Memory updated:" -ForegroundColor Green
Write-Host "  $Db"
Write-Host "Reload player: http://127.0.0.1:18766/"
Write-Host "If Player is closed, run Desktop shortcut: SHIBASS Player"
Write-Host ""
if (-not $NoPause) { pause }
exit 0
