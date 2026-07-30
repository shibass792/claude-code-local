#Requires -Version 5.1
<#
.SYNOPSIS
  Cubase <-> Ableton handoff helper + AI memory indexer.

  Creates the stem/MIDI/reference package structure, NOTES template,
  and (optionally) indexes it for local myllama via knowledge-from-drives.ps1.

.EXAMPLES
  # New empty handoff package
  .\daw-handoff.ps1 -Init -Song "MyTrack" -Direction CubaseToAbleton

  # After YOU exported MIDI/stems into the drop folders, organize + remember
  .\daw-handoff.ps1 -Organize -Song "MyTrack" -Remember

  # Only push to AI memory (index paths, no copy)
  .\daw-handoff.ps1 -Remember -Song "MyTrack" -ProjectRoots H:\shibass-ai,H:\Music\CubaseProjects
#>

param(
  [string]$HandoffRoot = "H:\daw-handoff",
  [string]$Song = "Untitled",
  [ValidateSet("CubaseToAbleton","AbletonToCubase")]
  [string]$Direction = "CubaseToAbleton",

  [string[]]$ProjectRoots = @(),

  [switch]$Init,
  [switch]$Organize,
  [switch]$Remember,
  [switch]$Ask,

  [string]$Question = "",

  [string]$KnowledgeScript = "H:\models\knowledge-from-drives.ps1",
  [string]$WaitScript      = "H:\models\wait-then-ask.ps1",
  [string]$GuideSource     = ""  # optional path to cubase-ableton-handoff.md
)

$ErrorActionPreference = "Stop"
$safeSong = ($Song -replace '[<>:"/\\|?*]', '_').Trim()
if (-not $safeSong) { $safeSong = "Untitled" }

$songDir = Join-Path $HandoffRoot $safeSong
$dirs = @(
  (Join-Path $songDir "01-midi"),
  (Join-Path $songDir "02-stems"),
  (Join-Path $songDir "03-reference"),
  (Join-Path $songDir "04-notes"),
  (Join-Path $songDir "05-original"),
  (Join-Path $songDir "00-drop-midi"),
  (Join-Path $songDir "00-drop-stems"),
  (Join-Path $songDir "00-drop-reference")
)

function Ensure-Dirs {
  New-Item -ItemType Directory -Force -Path $songDir | Out-Null
  foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

function Write-NotesTemplate {
  $notes = Join-Path $songDir "04-notes\NOTES.md"
  if (Test-Path $notes) {
    Write-Host "[skip] NOTES.md already exists" -ForegroundColor DarkYellow
    return
  }

  $from = if ($Direction -eq "CubaseToAbleton") { "Cubase" } else { "Ableton Live" }
  $to   = if ($Direction -eq "CubaseToAbleton") { "Ableton Live" } else { "Cubase" }

  @"
# Handoff: $safeSong
Direction: $from -> $to
Created: $(Get-Date -Format o)

## Session
- BPM:
- Time signature:
- Key / scale:
- Sample rate: (keep identical in both DAWs, e.g. 48000)
- Bit depth export: 24-bit WAV
- Start bar / export from: bar 1 / project start

## Track list (name -> role -> plugins used)
| # | Stem / MIDI name | Role | Plugins / instruments |
|---|------------------|------|------------------------|
| 1 | 01_kick | drums | |
| 2 | 02_bass | bass | |

## Cubase-only / Ableton-only things that will NOT transfer
- Mixer routing / buses / sidechains
- Stock instruments (re-load manually or rely on printed stems)
- Expression maps / complex MIDI CCs (print to audio if critical)

## Checklist
- [ ] MIDI exported to 01-midi
- [ ] Stems WAV in 02-stems (from project start, consistent length preferred)
- [ ] Reference mix in 03-reference
- [ ] Same sample rate both DAWs
- [ ] Opened in target DAW and compared to reference

## How to export ($from -> $to)
See: 04-notes\cubase-ableton-handoff.md
Or run the menus described in that guide.

## AI memory
Indexed via daw-handoff.ps1 -Remember so myllama can answer about this package.
"@ | Set-Content -Path $notes -Encoding UTF8

  Write-Host "[ok] wrote $notes" -ForegroundColor Green
}

function Copy-Guide {
  $dest = Join-Path $songDir "04-notes\cubase-ableton-handoff.md"
  $candidates = @(
    $GuideSource,
    "H:\models\cubase-ableton-handoff.md",
    (Join-Path $PSScriptRoot "cubase-ableton-handoff.md")
  ) | Where-Object { $_ -and (Test-Path $_) }

  if ($candidates.Count -gt 0) {
    Copy-Item $candidates[0] $dest -Force
    Write-Host "[ok] guide -> $dest" -ForegroundColor Green
  } else {
    @"
# See README in daw-handoff docs.
Cubase/Ableton: export MIDI + stems WAV + reference + fill NOTES.md
"@ | Set-Content $dest -Encoding UTF8
  }
}

function Write-CheatSheet {
  $path = Join-Path $songDir "04-notes\EXPORT-CHEATSHEET.txt"
  if ($Direction -eq "CubaseToAbleton") {
    @"
CUBASE -> ABLETON ($safeSong)
1) Cubase: note BPM + sample rate
2) Export MIDI -> drop into: $songDir\00-drop-midi
3) Export Audio Mixdown per track/group WAV 24-bit from start -> 00-drop-stems
4) Export stereo reference -> 00-drop-reference
5) Run: daw-handoff.ps1 -Organize -Song "$safeSong" -Remember
6) Ableton: new set, set BPM, drag 01-midi + 02-stems, check vs 03-reference
"@ | Set-Content $path -Encoding UTF8
  } else {
    @"
ABLETON -> CUBASE ($safeSong)
1) Ableton: note BPM + sample rate
2) Export MIDI -> 00-drop-midi
3) Export Audio (individual tracks) WAV 24-bit -> 00-drop-stems
4) Export master reference -> 00-drop-reference
5) Run: daw-handoff.ps1 -Organize -Song "$safeSong" -Remember
6) Cubase: new project same SR/BPM, import MIDI+audio, align bar 1
"@ | Set-Content $path -Encoding UTF8
  }
  Write-Host "[ok] cheatsheet -> $path" -ForegroundColor Green
}

function Invoke-Organize {
  Ensure-Dirs
  $map = @{
    "00-drop-midi"      = "01-midi"
    "00-drop-stems"     = "02-stems"
    "00-drop-reference" = "03-reference"
  }
  $moved = 0
  foreach ($pair in $map.GetEnumerator()) {
    $src = Join-Path $songDir $pair.Key
    $dst = Join-Path $songDir $pair.Value
    if (-not (Test-Path $src)) { continue }
    Get-ChildItem -LiteralPath $src -File -ErrorAction SilentlyContinue | ForEach-Object {
      $target = Join-Path $dst $_.Name
      Move-Item -LiteralPath $_.FullName -Destination $target -Force
      Write-Host "  move $($_.Name) -> $($pair.Value)" -ForegroundColor Cyan
      $moved++
    }
  }
  Write-Host "[ok] organized $moved files" -ForegroundColor Green

  # inventory for AI
  $inv = Join-Path $songDir "04-notes\INVENTORY.md"
  $lines = @("# Inventory for $safeSong", "Generated: $(Get-Date -Format o)", "")
  foreach ($sub in @("01-midi","02-stems","03-reference","05-original")) {
    $p = Join-Path $songDir $sub
    $lines += "## $sub"
    if (Test-Path $p) {
      Get-ChildItem $p -File -ErrorAction SilentlyContinue | ForEach-Object {
        $lines += ("- {0} ({1:N0} bytes)" -f $_.Name, $_.Length)
      }
    }
    $lines += ""
  }
  $lines | Set-Content $inv -Encoding UTF8
  Write-Host "[ok] inventory -> $inv" -ForegroundColor Green
}

function Invoke-Remember {
  if (-not (Test-Path $KnowledgeScript)) {
    throw "Missing $KnowledgeScript - install knowledge-from-drives.ps1 first"
  }

  # Always include this song handoff + global guide memory folder
  $roots = New-Object System.Collections.Generic.List[string]
  $roots.Add($songDir) | Out-Null
  $roots.Add($HandoffRoot) | Out-Null
  foreach ($r in $ProjectRoots) {
    if ($r -and (Test-Path $r)) { $roots.Add($r) | Out-Null }
  }

  # Persist MEMORY pointer
  $memDir = "H:\ai-knowledge"
  New-Item -ItemType Directory -Force -Path $memDir | Out-Null
  $mem = Join-Path $memDir "DAW-MEMORY.md"
  @"
# DAW conversion memory (local AI)
Updated: $(Get-Date -Format o)

## Method
Best Cubase <-> Ableton handoff = MIDI + stems WAV + reference + NOTES.md
No native .cpr <-> .als perfect convert.

## Active song package
$songDir

## Project roots indexed
$($roots -join "`n")

## Ask examples
- How do I move this song to Ableton?
- List stems for $safeSong
- What is the BPM / sample rate in NOTES?
"@ | Set-Content $mem -Encoding UTF8
  $roots.Add($memDir) | Out-Null

  Write-Host "[remember] indexing (paths only, no copy)..." -ForegroundColor Magenta
  # Call in-process with a real string[] (repeated -Roots via -File fails on PS 5.1)
  $uniqueRoots = @($roots | Select-Object -Unique)
  & $KnowledgeScript -Index -Roots $uniqueRoots
  Write-Host "[remember] done. Use -Ask or wait-then-ask.ps1" -ForegroundColor Magenta
}

function Invoke-Ask {
  param([string]$Q)
  if (-not $Q) { $Q = "Summarize handoff package for $safeSong and how to open it in the target DAW" }
  if (Test-Path $WaitScript) {
    & powershell -ExecutionPolicy Bypass -File $WaitScript -Question $Q
  } else {
    & powershell -ExecutionPolicy Bypass -File $KnowledgeScript -Ask $Q
  }
}

# --- main ---
if (-not ($Init -or $Organize -or $Remember -or $Ask)) {
  Write-Host @"

daw-handoff.ps1 - Cubase <-> Ableton package + AI memory

  -Init -Song "MyTrack" -Direction CubaseToAbleton
  -Organize -Song "MyTrack"
  -Remember -Song "MyTrack" -ProjectRoots H:\shibass-ai
  -Ask -Song "MyTrack" -Question "how do I import the stems"

Workflow:
  1) -Init
  2) Export MIDI/stems/reference from Cubase or Ableton into 00-drop-* folders
  3) -Organize -Remember
  4) -Ask

"@
  exit 0
}

Ensure-Dirs

if ($Init) {
  Write-NotesTemplate
  Copy-Guide
  Write-CheatSheet
  Write-Host ""
  Write-Host "Package ready: $songDir" -ForegroundColor Magenta
  Write-Host "Next: export into 00-drop-midi / 00-drop-stems / 00-drop-reference" -ForegroundColor Magenta
}

if ($Organize) { Invoke-Organize }
if ($Remember) { Invoke-Remember }
if ($Ask)      { Invoke-Ask -Q $Question }
