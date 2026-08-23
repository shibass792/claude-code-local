#Requires -Version 5.1
<#
.SYNOPSIS
  Create .venv-demucs and config so MIDI Forge (8791) can run the audio stage.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\wire-demucs-for-midi-forge.ps1
#>
param(
  [string]$Root = "H:\shibass-ai",
  [ValidateSet("auto", "cpu", "cuda")]
  [string]$Device = "auto"
)

$ErrorActionPreference = "Stop"

$venv = Join-Path $Root ".venv-demucs"
$cfgDir = Join-Path $Root "config"
$cfgFile = Join-Path $cfgDir "demucs.env"
$pyHook = Join-Path $Root "tools\demucs_wav_hook.py"
$stemsOut = Join-Path $Root "10_OUTPUTS\stems"
$midiExport = Join-Path $Root "10_OUTPUTS\MIDI_EXPORT"

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

Write-Host ""
Write-Host "Wire Demucs for MIDI Forge" -ForegroundColor Cyan
Write-Host ("Root: " + $Root)
Write-Host ""

Ensure-Dir $cfgDir
Ensure-Dir $stemsOut
Ensure-Dir $midiExport

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
  throw "python not found in PATH"
}

$venvPy = Join-Path $venv "Scripts\python.exe"
if (Test-Path $venvPy) {
  Write-Host "Venv exists: $venv" -ForegroundColor Green
} else {
  Write-Host "Creating venv: $venv" -ForegroundColor Yellow
  & python -m venv $venv
  & $venvPy -m pip install --upgrade pip
  & (Join-Path $venv "Scripts\pip.exe") install demucs torch torchaudio
}

$legacyDemucs = Join-Path $Root "sb-demucs.py"
if (Test-Path $legacyDemucs) {
  Write-Host ("Found legacy sb-demucs.py (hook still uses venv demucs module)") -ForegroundColor DarkGray
}

if ($Device -eq "auto") {
  $detected = & $venvPy -c "import torch; print('cuda' if torch.cuda.is_available() else 'cpu')"
  $Device = $detected.Trim()
  Write-Host ("Auto-detected Demucs device: " + $Device) -ForegroundColor Green
}

$envLines = @(
  "SHIBASS_ROOT=$Root",
  "SHIBASS_DEMUCS_VENV=$venv",
  "SHIBASS_STEMS_OUTPUT=$stemsOut",
  "SHIBASS_DEMUCS_MODEL=htdemucs",
  "SHIBASS_DEMUCS_DEVICE=$Device",
  "SHIBASS_DEMUCS_HOOK=$pyHook",
  "SHIBASS_DEMUCS_ENABLED=1"
)
Set-Content -Path $cfgFile -Value $envLines -Encoding UTF8
Write-Host ("Wrote " + $cfgFile) -ForegroundColor Green

Write-Host ""
Write-Host "Set these BEFORE starting MIDI Forge (8791):" -ForegroundColor White
foreach ($line in $envLines) {
  $parts = $line.Split("=", 2)
  if ($parts.Length -eq 2) {
    Set-Item -Path ("Env:" + $parts[0]) -Value $parts[1]
    Write-Host ("  `$env:" + $parts[0] + "='" + $parts[1] + "'")
  }
}

Write-Host ""
Write-Host "Test on test30.wav:" -ForegroundColor White
$testWav = Join-Path $midiExport "test30.wav"
if (Test-Path $testWav) {
  & (Join-Path $venv "Scripts\python.exe") $pyHook $testWav
} else {
  Write-Host ("  (no file yet: " + $testWav + ")")
}

Write-Host ""
Write-Host "Start background watcher (recommended):" -ForegroundColor White
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\watch-midi-export-demucs.ps1"
Write-Host "Or double-click START-MIDI-FORGE-DEMUCS.cmd"
Write-Host ""
Write-Host "If MIDI Forge still skips WAV, the watcher above still processes files." -ForegroundColor Yellow
Write-Host ""
