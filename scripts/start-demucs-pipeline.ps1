#Requires -Version 5.1
<#
.SYNOPSIS
  One-shot: ensure Demucs venv + start MIDI_EXPORT watcher.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\start-demucs-pipeline.ps1
#>
param(
  [string]$Root = "H:\shibass-ai",
  [switch]$SkipWire,
  [switch]$RunOnce
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $SkipWire) {
  $wire = Join-Path $scriptDir "wire-demucs-for-midi-forge.ps1"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $wire -Root $Root
}

$watchScript = Join-Path $scriptDir "watch-midi-export-demucs.ps1"
$watchArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $watchScript, "-Root", $Root)
if ($RunOnce) {
  $watchArgs += "-RunOnce"
  Start-Process -FilePath "powershell" -ArgumentList $watchArgs -WorkingDirectory $Root -Wait -NoNewWindow
  Write-Host "RunOnce finished." -ForegroundColor Green
} else {
  Start-Process -FilePath "powershell" -ArgumentList $watchArgs -WorkingDirectory $Root -WindowStyle Normal
  Write-Host "Demucs watcher started in new window." -ForegroundColor Green
}
Write-Host "Drop WAV into: $Root\10_OUTPUTS\MIDI_EXPORT" -ForegroundColor White
