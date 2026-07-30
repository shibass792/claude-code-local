@echo off
setlocal EnableExtensions
REM Scan disks into Music Brain DB while the player server stays running.
title SHIBASS Scan
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
echo.
echo   SHIBASS - scanning media library
echo   Roots: H:\  D:\  F:\  %USERPROFILE%
echo   Keep MusicBrain-Serve.cmd running in the other window.
echo.

cd /d "%MB%"
set PYTHONPATH=%MB%

where python >nul 2>&1
if errorlevel 1 (
  py -3 -m music_brain pipeline --root H:\ --root D:\ --root F:\ --root "%USERPROFILE%" -v
) else (
  python -m music_brain pipeline --root H:\ --root D:\ --root F:\ --root "%USERPROFILE%" -v
)

echo.
echo   Done. Reload http://127.0.0.1:18766/ in the browser.
pause
exit /b %ERRORLEVEL%
