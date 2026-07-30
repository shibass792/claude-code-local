#Requires -Version 5.1
<#
.SYNOPSIS
  Import session memory pack into ShiBass Brain + seed confirmed facts.
#>
param(
  [string]$BrainRoot = "H:\shibass-ai\SHIBASS_BRAIN",
  [string]$MemorySrc = "",
  [string]$Branch = "cursor/shibass-ai-panel-f785",
  [switch]$AlsoIndex
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding $true

if (-not $MemorySrc) {
  $MemorySrc = Join-Path $PSScriptRoot "memory"
}

# If local memory folder missing, download from GitHub
$need = @(
  "WORKING_STACK.md",
  "AGENT_SESSIONS.md",
  "FIXES_THAT_WORKED.md",
  "seed-facts.jsonl"
)
$missing = $false
foreach ($n in $need) {
  if (-not (Test-Path (Join-Path $MemorySrc $n))) { $missing = $true; break }
}
if ($missing) {
  New-Item -ItemType Directory -Force -Path $MemorySrc | Out-Null
  $base = "https://raw.githubusercontent.com/shibass792/claude-code-local/$Branch/scripts/shibass-brain/memory"
  $wc = New-Object Net.WebClient
  $wc.Encoding = [Text.Encoding]::UTF8
  foreach ($n in $need) {
    $url = "$base/$n"
    $out = Join-Path $MemorySrc $n
    Write-Host "GET $url" -ForegroundColor Cyan
    [IO.File]::WriteAllText($out, $wc.DownloadString($url), $utf8)
  }
}

if (-not (Test-Path $BrainRoot)) {
  $init = Join-Path (Split-Path $PSScriptRoot -Parent) "init-brain.ps1"
  if (Test-Path "H:\models\shibass-brain\init-brain.ps1") {
    & "H:\models\shibass-brain\init-brain.ps1" -BrainRoot $BrainRoot
  } elseif (Test-Path $init) {
    & $init -BrainRoot $BrainRoot
  } else {
    throw "Brain missing and init-brain.ps1 not found"
  }
}

$destDir = Join-Path $BrainRoot "system\session_memory"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

foreach ($n in $need) {
  Copy-Item (Join-Path $MemorySrc $n) (Join-Path $destDir $n) -Force
  Write-Host "[ok] $($n) -> $destDir" -ForegroundColor Green
}

# Merge seed facts (skip duplicate ids)
$factsPath = Join-Path $BrainRoot "system\facts.jsonl"
$existing = @{}
if (Test-Path $factsPath) {
  Get-Content -LiteralPath $factsPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    try {
      $o = $line | ConvertFrom-Json
      if ($o.id) { $existing[$o.id] = $true }
    } catch { }
  }
}

$seedPath = Join-Path $destDir "seed-facts.jsonl"
$added = 0
$linesOut = @()
if (Test-Path $factsPath) {
  $linesOut = @(Get-Content -LiteralPath $factsPath | Where-Object { $_.Trim() })
}
Get-Content -LiteralPath $seedPath | ForEach-Object {
  $line = $_.Trim()
  if (-not $line) { return }
  try {
    $o = $line | ConvertFrom-Json
    if ($o.id -and $existing.ContainsKey($o.id)) { return }
    $linesOut += $line
    $added++
    Write-Host "[fact] $($o.id)" -ForegroundColor Cyan
  } catch {
    Write-Host "[skip bad seed line]" -ForegroundColor DarkYellow
  }
}
[IO.File]::WriteAllLines($factsPath, $linesOut, $utf8)
Write-Host "[ok] facts added: $added" -ForegroundColor Green

# Refresh model context
$brainPs1 = "H:\models\shibass-brain\brain.ps1"
if (Test-Path $brainPs1) {
  & $brainPs1 -ExportContext | Out-Null
  Write-Host "[ok] ExportContext refreshed" -ForegroundColor Green
}

# Pointer file for knowledge index
$ptr = Join-Path $BrainRoot "system\SESSION_MEMORY_INDEX.md"
@"
# Session memory index
Updated: $(Get-Date -Format o)

Folder: $destDir

Read first:
- WORKING_STACK.md
- FIXES_THAT_WORKED.md
- AGENT_SESSIONS.md
- seed-facts.jsonl (also merged into facts.jsonl)

Primary agent chat:
https://cursor.com/agents/bc-21085a38-da67-49c9-afb6-f0ff7c0cf785
"@ | Set-Content -Path $ptr -Encoding UTF8

if ($AlsoIndex) {
  $know = "H:\models\knowledge-from-drives.ps1"
  if (Test-Path $know) {
    Write-Host "[index] brain session memory paths..." -ForegroundColor Magenta
    & $know -Index -Roots @($BrainRoot, $destDir, "H:\ai-knowledge")
  }
}

Write-Host ""
Write-Host "Session memory imported into Brain." -ForegroundColor Magenta
Write-Host $destDir
