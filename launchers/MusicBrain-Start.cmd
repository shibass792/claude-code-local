@echo off
setlocal EnableExtensions
chcp 65001 >nul
REM ============================================================
REM  Music Brain — לחיצה כפולה על המחשב
REM  סורק H:\ D:\ F:\ + הפרופיל שלך → מנתח → לומד → Cubase Bridge
REM
REM  אפשר גם להעתיק לקובץ לשולחן העבודה.
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
echo  ERROR: לא נמצא scripts\music-brain\auto-start.ps1
echo  משוך/שכפל את claude-code-local ואז הרץ שוב.
echo.
pause
exit /b 1

:run
echo.
echo   ========================================
echo      MUSIC BRAIN  —  ShiBass
echo      Scan / Analyze / Learn / Cubase
echo   ========================================
echo.
echo   סורק: H:\  D:\  F:\  %USERPROFILE%
echo   Bridge: http://127.0.0.1:18766
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%AUTO%" %*
set "EC=%ERRORLEVEL%"

if not "%EC%"=="0" (
  echo.
  echo  Failed with exit code %EC%
  pause
)
exit /b %EC%
