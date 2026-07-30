@echo off
setlocal EnableExtensions
chcp 65001 >nul
title SoundBrain — Scan / Pipeline

cd /d "%~dp0\.."
set "REPO=%CD%"
set "SOUNDBRAIN_HOME=%LOCALAPPDATA%\SoundBrain"
if not exist "%SOUNDBRAIN_HOME%" mkdir "%SOUNDBRAIN_HOME%"
set "PYTHONPATH=%REPO%;%PYTHONPATH%"

where python >nul 2>nul
if errorlevel 1 (
  echo Python not found on PATH.
  pause
  exit /b 1
)

python -c "import soundbrain" 2>nul
if errorlevel 1 (
  echo soundbrain is not installed. Running installer first...
  call "%~dp0SoundBrain-Install.cmd"
  python -c "import soundbrain" 2>nul
  if errorlevel 1 (
    echo Still cannot import soundbrain. Fix install, then retry.
    pause
    exit /b 1
  )
)

echo Scanning / analysing / learning projects...
echo Home DB: %SOUNDBRAIN_HOME%\soundbrain.db
echo.
python -m soundbrain pipeline
echo.
echo Pipeline finished. You can open the panel now:
echo   launchers\SoundBrain-Panel.cmd
pause
endlocal
