#Requires -Version 5.1
# Download DAW/AI scripts as UTF-8 (with BOM) so Windows PowerShell 5.1 parses them.

param(
  [string]$Dest = "H:\models",
  [string]$Branch = "cursor/shibass-ai-panel-f785"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

$base = "https://raw.githubusercontent.com/shibass792/claude-code-local/$Branch/scripts"
$files = @(
  "daw-handoff.ps1",
  "knowledge-from-drives.ps1",
  "wait-then-ask.ps1",
  "cubase-ableton-handoff.md"
)

$utf8Bom = New-Object System.Text.UTF8Encoding $true
foreach ($name in $files) {
  $url = "$base/$name"
  $out = Join-Path $Dest $name
  Write-Host "GET $url" -ForegroundColor Cyan
  # WebClient keeps UTF-8 code points; WriteAllText adds BOM for Windows PS
  $wc = New-Object System.Net.WebClient
  $wc.Encoding = [System.Text.Encoding]::UTF8
  $text = $wc.DownloadString($url)
  [System.IO.File]::WriteAllText($out, $text, $utf8Bom)
  Write-Host ("  -> {0} ({1} bytes)" -f $out, (Get-Item $out).Length) -ForegroundColor Green
}

Write-Host ""
Write-Host "Test:" -ForegroundColor Magenta
Write-Host '  powershell -ExecutionPolicy Bypass -File H:\models\daw-handoff.ps1 -Init -Song "MySong" -Direction CubaseToAbleton'
