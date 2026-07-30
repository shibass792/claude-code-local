@echo off
setlocal EnableExtensions
REM No-space launcher — safe in PowerShell:  .\launchers\HDrive-Start.cmd
REM Double-click this file, or run from any folder after copying to Desktop.

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "AUTO=%REPO_ROOT%\scripts\h-drive\auto-start.ps1"

REM If this copy was installed to Desktop / .claude, find the real repo.
if not exist "%AUTO%" goto :findrepo
goto :run

:findrepo
for %%D in (
  "%USERPROFILE%\claude-code-local"
  "%USERPROFILE%\Desktop\claude-code-local"
  "%USERPROFILE%\Desktop\Local AI Setup"
  "H:\shibass-ai\claude-code-local"
  "H:\claude-code-local"
  "H:\shibass-ai"
) do (
  if exist "%%~D\scripts\h-drive\auto-start.ps1" (
    set "AUTO=%%~D\scripts\h-drive\auto-start.ps1"
    goto :run
  )
)
echo ERROR: Could not find scripts\h-drive\auto-start.ps1
echo Clone claude-code-local, then run HDrive-Start.cmd from that repo's launchers\ folder.
pause
exit /b 1

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%AUTO%" %*
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo Failed with exit code %EC%
  pause
)
exit /b %EC%
