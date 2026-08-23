@echo off
setlocal EnableExtensions
chcp 65001 >nul
REM Copy this file to the Desktop - it finds the repo automatically.

title Music Brain
color 0B

set "AUTO="

for %%D in (
  "%~dp0..\scripts\music-brain\auto-start.ps1"
  "%USERPROFILE%\claude-code-local\scripts\music-brain\auto-start.ps1"
  "%USERPROFILE%\Desktop\claude-code-local\scripts\music-brain\auto-start.ps1"
  "%USERPROFILE%\Desktop\Local AI Setup\scripts\music-brain\auto-start.ps1"
  "H:\shibass-ai\claude-code-local\scripts\music-brain\auto-start.ps1"
  "H:\claude-code-local\scripts\music-brain\auto-start.ps1"
  "H:\shibass-ai\scripts\music-brain\auto-start.ps1"
  "D:\claude-code-local\scripts\music-brain\auto-start.ps1"
) do (
  if exist "%%~D" (
    set "AUTO=%%~D"
    goto :found
  )
)

echo.
echo  Music Brain not found.
echo  Make sure claude-code-local exists (with music-brain inside).
echo.
pause
exit /b 1

:found
echo.
echo   MUSIC BRAIN - starting...
echo   %AUTO%
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%AUTO%" %*
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo  Failed: %EC%
  pause
)
exit /b %EC%
