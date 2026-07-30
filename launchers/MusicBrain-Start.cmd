@echo off
setlocal EnableExtensions
chcp 65001 >nul
REM ============================================================
REM  Music Brain - double-click launcher for Windows
REM  Scans H:\ D:\ F:\ + profile, then opens SHIBASS S1 player
REM ============================================================

title Music Brain
color 0B

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "AUTO=%REPO_ROOT%\scripts\music-brain\auto-start.ps1"

if exist "%AUTO%" goto :run

:findrepo
for %%D in (
  "%USERPROFILE%\claude-code-local"
  "%USERPROFILE%\Desktop\claude-code-local"
  "%USERPROFILE%\Desktop\Local AI Setup"
  "H:\shibass-ai\claude-code-local"
  "H:\claude-code-local"
  "H:\shibass-ai"
  "D:\claude-code-local"
) do (
  if exist "%%~D\scripts\music-brain\auto-start.ps1" (
    set "AUTO=%%~D\scripts\music-brain\auto-start.ps1"
    goto :run
  )
)

echo.
echo  ERROR: scripts\music-brain\auto-start.ps1 not found
echo  Clone claude-code-local and run again.
echo.
pause
exit /b 1

:run
echo.
echo   ========================================
echo      SHIBASS S1  -  Media Player
echo      Starting server FIRST (then you can scan)
echo   ========================================
echo.
echo   Player: http://127.0.0.1:18766/
echo   Keep this window OPEN
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%AUTO%" -ServeOnly %*
set "EC=%ERRORLEVEL%"

if not "%EC%"=="0" (
  echo.
  echo  Failed with exit code %EC%
  pause
)
exit /b %EC%
