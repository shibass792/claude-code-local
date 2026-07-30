@echo off
setlocal EnableExtensions
chcp 65001 >nul
title SoundBrain — Install (Windows)

REM Install SoundBrain Match Panel into this Python, from this repo.
REM Run from anywhere — the script finds the repo root next to launchers\.

cd /d "%~dp0\.."
set "REPO=%CD%"
set "SOUNDBRAIN_HOME=%LOCALAPPDATA%\SoundBrain"
if not exist "%SOUNDBRAIN_HOME%" mkdir "%SOUNDBRAIN_HOME%"

echo.
echo === SoundBrain Install ===
echo Repo: %REPO%
echo Home: %SOUNDBRAIN_HOME%
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found on PATH.
  echo Install Python 3.10+ from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH".
  pause
  exit /b 1
)

python -c "import sys; print('Python', sys.version); raise SystemExit(0 if sys.version_info >= (3,10) else 1)"
if errorlevel 1 (
  echo [ERROR] Need Python 3.10 or newer.
  pause
  exit /b 1
)

if not exist "%REPO%\soundbrain\__init__.py" (
  echo [ERROR] soundbrain package not found in this folder.
  echo.
  echo Your clone is probably still on main. Fetch the Match Panel branch:
  echo.
  echo   cd /d "%REPO%"
  echo   git fetch origin
  echo   git checkout cursor/match-panel-cubase-8080
  echo   git pull
  echo.
  echo Then run this installer again:
  echo   launchers\SoundBrain-Install.cmd
  echo.
  pause
  exit /b 1
)

echo [1/3] Upgrading pip / setuptools / wheel...
python -m pip install --upgrade pip setuptools wheel
if errorlevel 1 (
  echo [ERROR] pip upgrade failed.
  pause
  exit /b 1
)

echo.
echo [2/3] Installing SoundBrain into this Python (editable)...
python -m pip install -e "%REPO%[audio]"
if errorlevel 1 (
  echo Editable+audio install failed — trying core only...
  python -m pip install -e "%REPO%"
  if errorlevel 1 (
    echo [ERROR] pip install -e failed.
    pause
    exit /b 1
  )
)

if exist "%REPO%\requirements-soundbrain.txt" (
  echo.
  echo [3/3] Extra requirements...
  python -m pip install -r "%REPO%\requirements-soundbrain.txt"
) else (
  echo [3/3] requirements-soundbrain.txt not needed — already installed via pyproject.
)

echo.
python -c "import soundbrain; print('OK: soundbrain importable from', soundbrain.__file__)"
if errorlevel 1 (
  echo [ERROR] import still fails after install.
  pause
  exit /b 1
)

echo.
echo Writing default config (detects drives)...
python -m soundbrain init
echo.
echo === Done ===
echo Next:
echo   1^) launchers\SoundBrain-Scan.cmd     ^(first-time library scan^)
echo   2^) launchers\SoundBrain-Panel.cmd    ^(open http://127.0.0.1:8770/panel^)
echo.
echo Or manually:
echo   python -m soundbrain pipeline
echo   python -m soundbrain serve
echo.
pause
endlocal
