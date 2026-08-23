# Music Brain — install Python venv + dependencies
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

Write-Host "=== Music Brain Install ===" -ForegroundColor Cyan
Write-Host "Root: $Root"

# Python check
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
if (-not $py) {
    Write-Error "Python not found. Install Python 3.11+ from https://python.org"
}

$venvPath = Join-Path $Root ".venv"
if (-not (Test-Path $venvPath)) {
    Write-Host "Creating virtual environment..."
    & python -m venv $venvPath
}

$activate = Join-Path $venvPath "Scripts\Activate.ps1"
. $activate

Write-Host "Upgrading pip..."
python -m pip install --upgrade pip -q

Write-Host "Installing music-brain [watch]..."
pip install -e ".[watch]" -q

# data folder
$dataDir = Join-Path $Root "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

# config reminder
$config = Join-Path $Root "config.yaml"
if (Test-Path $config) {
    Write-Host ""
    Write-Host "Edit config.yaml — set your paths:" -ForegroundColor Yellow
    Write-Host "  H:\  D:\  F:\  C:\Users\shibass\"
}

Write-Host ""
Write-Host "Install complete!" -ForegroundColor Green
Write-Host "Run:  scripts\windows\pipeline-first-run.ps1   (first scan)"
Write-Host "Run:  scripts\windows\start-all.ps1            (UI + background)"
