@echo off
REM SoundBrain Match Panel — search YouTube/song → ARP + Cubase project
cd /d "%~dp0\.."
set SOUNDBRAIN_HOME=%LOCALAPPDATA%\SoundBrain
if not exist "%SOUNDBRAIN_HOME%" mkdir "%SOUNDBRAIN_HOME%"

where python >nul 2>nul
if errorlevel 1 (
  echo Python not found on PATH.
  pause
  exit /b 1
)

python -m soundbrain serve --host 127.0.0.1 --port 8770
pause
