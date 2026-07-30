#Requires -Version 5.1
# Download DAW/AI + ShiBass Brain scripts as UTF-8 (with BOM) for Windows PowerShell 5.1.

param(
  [string]$Dest = "H:\models",
  [string]$Branch = "cursor/shibass-ai-panel-f785"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Dest "shibass-brain\templates") | Out-Null

$base = "https://raw.githubusercontent.com/shibass792/claude-code-local/$Branch/scripts"
$utf8Bom = New-Object System.Text.UTF8Encoding $true

function Save-Utf8Bom([string]$Url, [string]$Out) {
  Write-Host "GET $Url" -ForegroundColor Cyan
  $wc = New-Object System.Net.WebClient
  $wc.Encoding = [System.Text.Encoding]::UTF8
  $text = $wc.DownloadString($Url)
  $dir = Split-Path $Out -Parent
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Out, $text, $utf8Bom)
  Write-Host ("  -> {0} ({1} bytes)" -f $Out, (Get-Item $Out).Length) -ForegroundColor Green
}

$files = @(
  "daw-handoff.ps1",
  "knowledge-from-drives.ps1",
  "wait-then-ask.ps1",
  "cubase-ableton-handoff.md",
  "start-shibass.ps1"
)
foreach ($name in $files) {
  Save-Utf8Bom "$base/$name" (Join-Path $Dest $name)
}

$brain = @(
  @{ Rel = "shibass-brain/init-brain.ps1"; Out = "shibass-brain\init-brain.ps1" },
  @{ Rel = "shibass-brain/brain.ps1"; Out = "shibass-brain\brain.ps1" },
  @{ Rel = "shibass-brain/import-session-memory.ps1"; Out = "shibass-brain\import-session-memory.ps1" },
  @{ Rel = "shibass-brain/README.md"; Out = "shibass-brain\README.md" },
  @{ Rel = "shibass-brain/templates/personal_profile.json"; Out = "shibass-brain\templates\personal_profile.json" },
  @{ Rel = "shibass-brain/templates/artistic_identity.json"; Out = "shibass-brain\templates\artistic_identity.json" },
  @{ Rel = "shibass-brain/templates/preferences.json"; Out = "shibass-brain\templates\preferences.json" },
  @{ Rel = "shibass-brain/templates/permanent_rules.json"; Out = "shibass-brain\templates\permanent_rules.json" },
  @{ Rel = "shibass-brain/memory/WORKING_STACK.md"; Out = "shibass-brain\memory\WORKING_STACK.md" },
  @{ Rel = "shibass-brain/memory/AGENT_SESSIONS.md"; Out = "shibass-brain\memory\AGENT_SESSIONS.md" },
  @{ Rel = "shibass-brain/memory/FIXES_THAT_WORKED.md"; Out = "shibass-brain\memory\FIXES_THAT_WORKED.md" },
  @{ Rel = "shibass-brain/memory/seed-facts.jsonl"; Out = "shibass-brain\memory\seed-facts.jsonl" }
)
foreach ($b in $brain) {
  Save-Utf8Bom "$base/$($b.Rel)" (Join-Path $Dest $b.Out)
}

$panel = "H:\shibass-ai-panel"
if (Test-Path $panel) {
  New-Item -ItemType Directory -Force -Path (Join-Path $panel "public") | Out-Null
  Save-Utf8Bom "$base/shibass-ai-panel/server.js" (Join-Path $panel "server.js")
  Save-Utf8Bom "$base/shibass-ai-panel/public/index.html" (Join-Path $panel "public\index.html")
  Save-Utf8Bom "$base/shibass-ai-panel/public/app.js" (Join-Path $panel "public\app.js")
  Save-Utf8Bom "$base/shibass-ai-panel/public/styles.css" (Join-Path $panel "public\styles.css")
}

Write-Host ""
Write-Host "Init brain + import session memory:" -ForegroundColor Magenta
Write-Host '  powershell -ExecutionPolicy Bypass -File H:\models\shibass-brain\init-brain.ps1'
Write-Host '  powershell -ExecutionPolicy Bypass -File H:\models\shibass-brain\import-session-memory.ps1'
Write-Host "Then restart panel (npm start) if server.js was updated." -ForegroundColor Magenta
