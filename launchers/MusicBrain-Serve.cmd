@echo off
setlocal EnableExtensions
REM Instant SHIBASS player with persistent scan memory.
title SHIBASS S1 Serve
color 0B

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "MB=%REPO_ROOT%\music-brain"

if not exist "%MB%\music_brain\cli.py" (
  for %%D in (
    "%USERPROFILE%\claude-code-local"
    "H:\shibass-ai\claude-code-local"
    "H:\claude-code-local"
  ) do (
    if exist "%%~D\music-brain\music_brain\cli.py" (
      set "REPO_ROOT=%%~D"
      set "MB=%%~D\music-brain"
      goto :found
    )
  )
  echo ERROR: music-brain not found
  pause
  exit /b 1
)

:found
if "%MUSIC_BRAIN_DB%"=="" set "MUSIC_BRAIN_DB=%LOCALAPPDATA%\MusicBrain\knowledge.db"
if not exist "%LOCALAPPDATA%\MusicBrain" mkdir "%LOCALAPPDATA%\MusicBrain"

echo.
echo   SHIBASS S1 - full panel
echo   http://127.0.0.1:18766/
echo   Memory: %MUSIC_BRAIN_DB%
echo   Keep this window open.
echo.

cd /d "%MB%"
set PYTHONPATH=%MB%

where python >nul 2>&1
if errorlevel 1 (
  where py >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Python not on PATH
    pause
    exit /b 1
  )
  start "" http://127.0.0.1:18766/
  py -3 -m music_brain serve --host 0.0.0.0 --port 18766
) else (
  start "" http://127.0.0.1:18766/
  python -m music_brain serve --host 0.0.0.0 --port 18766
)

echo.
echo Server stopped.
pause
exit /b %ERRORLEVEL%
