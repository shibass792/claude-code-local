@echo off
setlocal EnableExtensions
REM Music Brain — scan / analyze / learn / Cubase bridge
REM Usage:
REM   launchers\Music-Brain.cmd setup
REM   launchers\Music-Brain.cmd pipeline
REM   launchers\Music-Brain.cmd serve
REM   launchers\Music-Brain.cmd search "bass like Astrix"

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "MB=%REPO_ROOT%\music-brain"
set "PY=python"

if not exist "%MB%\music_brain\cli.py" goto :findrepo
goto :dispatch

:findrepo
for %%D in (
  "%USERPROFILE%\claude-code-local"
  "%USERPROFILE%\Desktop\claude-code-local"
  "%USERPROFILE%\Desktop\Local AI Setup"
  "H:\shibass-ai\claude-code-local"
  "H:\claude-code-local"
  "H:\shibass-ai"
) do (
  if exist "%%~D\music-brain\music_brain\cli.py" (
    set "REPO_ROOT=%%~D"
    set "MB=%%~D\music-brain"
    goto :dispatch
  )
)
echo ERROR: Could not find music-brain package.
pause
exit /b 1

:dispatch
set "CMD=%~1"
if "%CMD%"=="" set "CMD=status"
shift

if /I "%CMD%"=="setup" goto :setup
if /I "%CMD%"=="pipeline" goto :run
if /I "%CMD%"=="scan" goto :run
if /I "%CMD%"=="analyze" goto :run
if /I "%CMD%"=="match" goto :run
if /I "%CMD%"=="search" goto :run
if /I "%CMD%"=="learn" goto :run
if /I "%CMD%"=="dna" goto :run
if /I "%CMD%"=="serve" goto :run
if /I "%CMD%"=="status" goto :run
if /I "%CMD%"=="test" goto :test

echo Unknown command: %CMD%
echo Commands: setup pipeline scan analyze match search learn dna serve status test
exit /b 2

:setup
where python >nul 2>&1 || (
  echo ERROR: python not on PATH
  exit /b 1
)
pushd "%MB%"
%PY% -m pip install -e ".[dev]" -q
if errorlevel 1 %PY% -m pip install -e . -q
popd
echo.
echo Music Brain ready.
echo   launchers\Music-Brain.cmd pipeline
echo   launchers\Music-Brain.cmd serve
exit /b 0

:test
pushd "%MB%"
%PY% -m pytest -q
set "EC=%ERRORLEVEL%"
popd
exit /b %EC%

:run
pushd "%MB%"
if /I "%CMD%"=="pipeline" (
  %PY% -m music_brain pipeline --root H:\ --root D:\ --root F:\ --root "%USERPROFILE%" -v %*
) else if /I "%CMD%"=="scan" (
  %PY% -m music_brain scan --root H:\ --root D:\ --root F:\ --root "%USERPROFILE%" -v %*
) else if /I "%CMD%"=="serve" (
  %PY% -m music_brain serve --host 127.0.0.1 --port 18766 %*
) else (
  %PY% -m music_brain %CMD% %*
)
set "EC=%ERRORLEVEL%"
popd
exit /b %EC%
