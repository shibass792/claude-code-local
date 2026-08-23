#Requires -Version 5.1
<#
.SYNOPSIS
  Reinstall pinned Demucs venv deps (fixes torchcodec / save_audio errors).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\repair-demucs-venv.ps1
#>
param(
  [string]$Root = "H:\shibass-ai"
)

$wire = Join-Path $Root "scripts\wire-demucs-for-midi-forge.ps1"
if (-not (Test-Path $wire)) {
  throw ("Missing: " + $wire)
}

& powershell -ExecutionPolicy Bypass -File $wire -Root $Root -RepairVenv
