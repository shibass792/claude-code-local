@echo off
setlocal
set "INST=%LOCALAPPDATA%\MusicBrain"
if not exist "%INST%\config.json" (
  echo SHIBASS is not installed yet.
  echo Run: launchers\MusicBrain-Install.cmd
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\music-brain\install.ps1" -Uninstall
