@echo off
title MIDI Forge + Demucs
cd /d "H:\shibass-ai"

if not exist "config\demucs.env" (
  echo Run scripts\wire-demucs-for-midi-forge.ps1 first
  pause
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in ("config\demucs.env") do (
  set "%%A=%%B"
)

if not defined SHIBASS_DEMUCS_VENV (
  echo config\demucs.env is incomplete. Re-run wire-demucs-for-midi-forge.ps1
  pause
  exit /b 1
)

echo Demucs venv: %SHIBASS_DEMUCS_VENV%
echo Stems out:   %SHIBASS_STEMS_OUTPUT%
echo Watch dir:   H:\shibass-ai\10_OUTPUTS\MIDI_EXPORT
echo.
echo Starting Demucs watcher (processes WAV even if Forge skips)...
start "ShiBass Demucs Watcher" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\watch-midi-export-demucs.ps1"
echo.
echo 1. Restart MIDI Forge / music_brain on port 8791 from THIS window if needed.
echo 2. Drop WAV into MIDI_EXPORT - watcher runs Demucs automatically.
echo 3. Optional: keep Full Audio Worker on 8015 running in parallel.
echo 4. If save fails with TorchCodec, run FIX-DEMUCS-TORCHCODEC.ps1 once.
echo.
cmd /k
