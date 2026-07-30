# Music Brain — download / update from GitHub
# Usage: powershell -ExecutionPolicy Bypass -File download.ps1

$ErrorActionPreference = "Stop"
$Branch = "cursor/music-brain-system-f88d"
$RepoZip = "https://github.com/shibass792/claude-code-local/archive/refs/heads/$Branch.zip"
$TargetDir = Join-Path $PSScriptRoot "..\..\.."
$ZipFile = Join-Path $env:TEMP "music-brain-download.zip"

Write-Host "=== Music Brain Download ===" -ForegroundColor Cyan
Write-Host "Branch: $Branch"
Write-Host "URL:    $RepoZip"

$parent = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (Test-Path (Join-Path $parent "music_brain\cli.py")) {
    Write-Host "Already inside music-brain repo. Updating via git..." -ForegroundColor Yellow
    Push-Location $parent
    git fetch origin $Branch 2>$null
    git pull origin $Branch 2>$null
    Pop-Location
    Write-Host "Done. Run install.ps1 if dependencies changed." -ForegroundColor Green
    exit 0
}

Write-Host "Downloading ZIP..."
Invoke-WebRequest -Uri $RepoZip -OutFile $ZipFile -UseBasicParsing

$extractRoot = Join-Path $env:TEMP "music-brain-extract"
if (Test-Path $extractRoot) { Remove-Item $extractRoot -Recurse -Force }
Expand-Archive -Path $ZipFile -DestinationPath $extractRoot -Force

$extracted = Get-ChildItem $extractRoot -Directory | Select-Object -First 1
$musicBrainSrc = Join-Path $extracted.FullName "music-brain"
if (-not (Test-Path $musicBrainSrc)) {
    Write-Error "music-brain folder not found in archive"
}

$dest = Join-Path (Split-Path $PSScriptRoot -Parent -Parent) ""
if ($dest -eq "") { $dest = Join-Path $env:USERPROFILE "MusicBrain" }

Write-Host "Copying to: $dest"
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }
Copy-Item -Path "$musicBrainSrc\*" -Destination $dest -Recurse -Force

Remove-Item $ZipFile -Force -ErrorAction SilentlyContinue
Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Download complete!" -ForegroundColor Green
Write-Host "Next: cd `"$dest`""
Write-Host "      powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1"
