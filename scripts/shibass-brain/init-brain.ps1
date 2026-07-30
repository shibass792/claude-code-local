#Requires -Version 5.1
<#
.SYNOPSIS
  Create H:\shibass-ai\SHIBASS_BRAIN folder tree + seed identity files.
#>
param(
  [string]$BrainRoot = "H:\shibass-ai\SHIBASS_BRAIN",
  [string]$TemplateDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $TemplateDir) {
  $TemplateDir = Join-Path $PSScriptRoot "templates"
}

$dirs = @(
  "identity",
  "music",
  "media",
  "career",
  "system",
  "vectors\text",
  "vectors\audio",
  "vectors\midi",
  "vectors\images",
  "knowledge_graph",
  "backups",
  "reports",
  "logs",
  "dashboard"
)

New-Item -ItemType Directory -Force -Path $BrainRoot | Out-Null
foreach ($d in $dirs) {
  New-Item -ItemType Directory -Force -Path (Join-Path $BrainRoot $d) | Out-Null
}

$seed = @(
  @{ Src = "personal_profile.json"; Dst = "identity\personal_profile.json" },
  @{ Src = "artistic_identity.json"; Dst = "identity\artistic_identity.json" },
  @{ Src = "preferences.json"; Dst = "identity\preferences.json" },
  @{ Src = "permanent_rules.json"; Dst = "identity\permanent_rules.json" }
)

$utf8 = New-Object System.Text.UTF8Encoding $true
foreach ($item in $seed) {
  $src = Join-Path $TemplateDir $item.Src
  $dst = Join-Path $BrainRoot $item.Dst
  if (Test-Path $dst) {
    Write-Host "[skip] exists $dst" -ForegroundColor DarkYellow
    continue
  }
  if (-not (Test-Path $src)) {
    throw "Missing template: $src"
  }
  $text = [IO.File]::ReadAllText($src)
  $text = $text -replace '"updated_at": null', ('"updated_at": "' + (Get-Date -Format o) + '"')
  [IO.File]::WriteAllText($dst, $text, $utf8)
  Write-Host "[ok] $dst" -ForegroundColor Green
}

$facts = Join-Path $BrainRoot "system\facts.jsonl"
if (-not (Test-Path $facts)) {
  New-Item -ItemType File -Path $facts -Force | Out-Null
  Write-Host "[ok] $facts" -ForegroundColor Green
}

$readme = Join-Path $BrainRoot "README.txt"
@"
ShiBass Brain root
Created: $(Get-Date -Format o)

Phase 1 active:
- identity\*.json
- system\facts.jsonl

Manage with:
  powershell -ExecutionPolicy Bypass -File H:\models\shibass-brain\brain.ps1 -Help
"@ | Set-Content -Path $readme -Encoding UTF8

Write-Host ""
Write-Host "Brain ready: $BrainRoot" -ForegroundColor Magenta
Write-Host "Next: edit identity files, then use brain.ps1 -AddFact / -ExportContext" -ForegroundColor Magenta
