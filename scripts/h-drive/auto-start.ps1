#Requires -Version 5.1
<#
.SYNOPSIS
  One-shot Windows helper: find the repo, run setup-drives, start H-Drive API.

.DESCRIPTION
  Safe to run from any directory (including C:\Users\shibass).
  Resolves the claude-code-local repo from this script path, then:
    1) setup-drives (H:\ + F:\ MCP + CLI wrappers)
    2) serve API on http://127.0.0.1:18765

.PARAMETER SkipSetup
  Only start the API server (skip MCP/drive registration).

.PARAMETER Port
  API port. Default 18765.

.PARAMETER InstallShortcut
  Also copy HDrive-Start.cmd to Desktop and %USERPROFILE%\.claude\
#>
param(
  [switch]$SkipSetup,
  [int]$Port = 18765,
  [switch]$InstallShortcut
)

$ErrorActionPreference = "Stop"

function Test-RepoRoot([string]$Path) {
  if (-not $Path) { return $false }
  $ctl = Join-Path $Path "scripts\h-drive\h_drive_ctl.py"
  return (Test-Path -LiteralPath $ctl)
}

function Find-RepoRoot {
  $candidates = New-Object System.Collections.Generic.List[string]

  if ($PSScriptRoot) {
    # scripts\h-drive -> repo root
    $candidates.Add((Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
    $candidates.Add((Split-Path -Parent $PSScriptRoot))
  }

  $known = @(
    (Get-Location).Path,
    (Join-Path (Get-Location).Path "claude-code-local"),
    "$env:USERPROFILE\claude-code-local",
    "$env:USERPROFILE\Desktop\claude-code-local",
    "$env:USERPROFILE\Desktop\Local AI Setup",
    "$env:USERPROFILE\Documents\claude-code-local",
    "H:\shibass-ai\claude-code-local",
    "H:\claude-code-local",
    "H:\shibass-ai"
  )
  foreach ($k in $known) { if ($k) { $candidates.Add($k) } }

  foreach ($c in ($candidates | Select-Object -Unique)) {
    if (Test-RepoRoot $c) { return (Resolve-Path -LiteralPath $c).Path }
  }

  # Shallow search only (depth-ish via known parent folders) — avoid full H:\ crawl.
  $shallowParents = @(
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\Documents",
    "$env:USERPROFILE",
    "H:\shibass-ai",
    "H:\"
  ) | Where-Object { Test-Path -LiteralPath $_ }

  foreach ($parent in $shallowParents) {
    $hit = Get-ChildItem -Path $parent -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-RepoRoot $_.FullName } |
      Select-Object -First 1
    if ($hit) { return $hit.FullName }

    $nested = Get-ChildItem -Path $parent -Directory -ErrorAction SilentlyContinue |
      ForEach-Object {
        Get-ChildItem -Path $_.FullName -Directory -ErrorAction SilentlyContinue
      } |
      Where-Object { Test-RepoRoot $_.FullName } |
      Select-Object -First 1
    if ($nested) { return $nested.FullName }
  }

  throw @"
Could not find claude-code-local (scripts\h-drive\h_drive_ctl.py).

Fix:
  1) Clone/pull the repo to a known path, e.g. H:\shibass-ai\claude-code-local
  2) Double-click launchers\HDrive-Start.cmd inside that repo
"@
}

$RepoRoot = Find-RepoRoot
$Ctl = Join-Path $RepoRoot "scripts\h-drive\h_drive_ctl.py"
$SetupDrives = Join-Path $RepoRoot "scripts\h-drive\setup-drives.ps1"
$StartCmd = Join-Path $RepoRoot "launchers\HDrive-Start.cmd"

Write-Host ""
Write-Host "=== ShiBass H-Drive Auto Start ==="
Write-Host "Repo: $RepoRoot"
Write-Host ""

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "python not found on PATH. Install Python 3 and retry."
}

# Always install no-space shortcuts so next time is:  HDrive-Start.cmd
$doShortcuts = $true
if ($doShortcuts -and (Test-Path -LiteralPath $StartCmd)) {
  $claudeDir = Join-Path $env:USERPROFILE ".claude"
  New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
  $targets = @(
    (Join-Path $claudeDir "HDrive-Start.cmd"),
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "HDrive-Start.cmd")
  )
  foreach ($t in $targets) {
    try {
      Copy-Item -LiteralPath $StartCmd -Destination $t -Force
      Write-Host "Shortcut: $t"
    } catch {
      Write-Warning "Could not write shortcut $t : $_"
    }
  }
}

if (-not $SkipSetup) {
  if (-not (Test-Path -LiteralPath $SetupDrives)) {
    throw "Missing setup-drives.ps1 at $SetupDrives"
  }
  Write-Host "Running setup-drives..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File $SetupDrives
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    Write-Warning "setup-drives exited with code $LASTEXITCODE (continuing to serve)"
  }
}

if ([string]::IsNullOrWhiteSpace($env:H_DRIVE_ROOT)) {
  $env:H_DRIVE_ROOT = "H:\"
}

Write-Host ""
Write-Host "Starting H-Drive API on http://127.0.0.1:$Port"
Write-Host "Root: $($env:H_DRIVE_ROOT)"
Write-Host "Leave this window open while Claude/Cursor needs H:\ access."
Write-Host "Next time you can just double-click Desktop\HDrive-Start.cmd"
Write-Host ""

& python $Ctl serve --host 127.0.0.1 --port $Port
exit $LASTEXITCODE
