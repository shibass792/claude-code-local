#Requires -Version 5.1
<#
.SYNOPSIS
  Emergency fix when Demucs hits 100% then fails saving stems (TorchCodec / torchaudio 2.9+).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\FIX-DEMUCS-TORCHCODEC.ps1
#>
param(
  [string]$Root = "H:\shibass-ai"
)

$ErrorActionPreference = "Stop"

$venv = Join-Path $Root ".venv-demucs"
$venvPy = Join-Path $venv "Scripts\python.exe"
$venvPip = Join-Path $venv "Scripts\pip.exe"
$reqFile = Join-Path $Root "config\demucs-requirements.txt"
$envFile = Join-Path $Root "config\demucs.env"

Write-Host ""
Write-Host "FIX Demucs TorchCodec / save_audio" -ForegroundColor Cyan
Write-Host ("Root: " + $Root)
Write-Host ""

if (-not (Test-Path $venvPip)) {
  throw ("Demucs venv not found. Run scripts\wire-demucs-for-midi-forge.ps1 first: " + $venv)
}

Write-Host "Reinstalling pinned CPU torch 2.5.1 + torchaudio 2.5.1..." -ForegroundColor Yellow
& $venvPy -m pip install --upgrade pip
if (Test-Path $reqFile) {
  & $venvPip install --force-reinstall -r $reqFile
} else {
  & $venvPip install --force-reinstall demucs "torch==2.5.1" "torchaudio==2.5.1" "soundfile>=0.12.1" --index-url https://download.pytorch.org/whl/cpu
}

Write-Host "Verifying torchaudio.save (no torchcodec)..." -ForegroundColor DarkGray
$saveCheck = @"
import torch, torchaudio, tempfile, os
wav = torch.zeros(2, 1600)
path = os.path.join(tempfile.gettempdir(), 'shibass_demucs_save_test.wav')
torchaudio.save(path, wav, 16000)
os.remove(path)
import torch as t
print('torch', t.__version__)
import torchaudio as ta
print('torchaudio', ta.__version__)
print('ok')
"@
& $venvPy -c $saveCheck
if ($LASTEXITCODE -ne 0) {
  throw "torchaudio save check still failing"
}
Write-Host "Save check: OK" -ForegroundColor Green

if (Test-Path $envFile) {
  $lines = Get-Content $envFile | ForEach-Object {
    if ($_ -match '^SHIBASS_DEMUCS_DEVICE=cuda$') {
      "SHIBASS_DEMUCS_DEVICE=auto"
    } else {
      $_
    }
  }
  Set-Content -Path $envFile -Value $lines -Encoding UTF8
  Write-Host ("Updated " + $envFile + " (cuda -> auto)") -ForegroundColor Green
}

Write-Host ""
Write-Host "Next:" -ForegroundColor White
Write-Host "  1. Stop the Demucs watcher (Ctrl+C), then restart it."
Write-Host "  2. Re-queue failed WAVs (touch file or edit config\demucs-processed.json)."
Write-Host "  3. Test:"
Write-Host ("     " + $venvPy + " " + (Join-Path $Root "tools\demucs_wav_hook.py") + " " + (Join-Path $Root "10_OUTPUTS\MIDI_EXPORT\test30.wav"))
Write-Host ""
