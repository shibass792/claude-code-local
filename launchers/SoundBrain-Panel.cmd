@echo off
setlocal EnableExtensions
chcp 65001 >nul
title SoundBrain Match Panel

cd /d "%~dp0\.."
set "REPO=%CD%"
set "SOUNDBRAIN_HOME=%LOCALAPPDATA%\SoundBrain"
if not exist "%SOUNDBRAIN_HOME%" mkdir "%SOUNDBRAIN_HOME%"
REM Fallback if the package was not pip-installed yet:
set "PYTHONPATH=%REPO%;%PYTHONPATH%"

where python >nul 2>nul
if errorlevel 1 (
  echo Python not found on PATH.
  pause
  exit /b 1
)

if not exist "%REPO%\soundbrain\__init__.py" (
  echo [ERROR] soundbrain folder missing.
  echo Checkout the Match Panel branch first:
  echo   git fetch origin
  echo   git checkout cursor/match-panel-cubase-8080
  echo Then run: launchers\SoundBrain-Install.cmd
  pause
  exit /b 1
)

python -c "import soundbrain" 2>nul
if errorlevel 1 (
  echo soundbrain not installed — running installer...
  call "%~dp0SoundBrain-Install.cmd"
)

echo.
echo SoundBrain Match Panel
echo   URL:  http://127.0.0.1:8770/panel
echo   DB:   %SOUNDBRAIN_HOME%\soundbrain.db
echo   Repo: %REPO%
echo.
echo Opening browser...
start "" "http://127.0.0.1:8770/panel"

python -m soundbrain serve --host 127.0.0.1 --port 8770
echo.
echo Server stopped.
pause
endlocal
