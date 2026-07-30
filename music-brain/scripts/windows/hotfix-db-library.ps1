# Hotfix: migrate library columns before indexes (fixes serve crash)
# Run from ANY directory:
#   powershell -ExecutionPolicy Bypass -File H:\claude-code-local\music-brain\scripts\windows\hotfix-db-library.ps1

$ErrorActionPreference = "Stop"

$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

Write-Host "=== Music Brain DB hotfix ===" -ForegroundColor Cyan
Write-Host "Project: $Root"

# Prefer git pull from repo root (parent of music-brain)
$RepoRoot = Split-Path $Root -Parent
if (Test-Path (Join-Path $RepoRoot ".git")) {
    Write-Host "Pulling latest from git..."
    Push-Location $RepoRoot
    git fetch origin cursor/music-brain-system-f88d 2>$null
    git checkout origin/cursor/music-brain-system-f88d -- music-brain/music_brain/database/knowledge_db.py
    if ($LASTEXITCODE -ne 0) {
        Write-Host "git checkout failed — trying pull..." -ForegroundColor Yellow
        git pull origin cursor/music-brain-system-f88d
    }
    Pop-Location
} elseif (Test-Path (Join-Path $Root ".git")) {
    Push-Location $Root
    git pull origin cursor/music-brain-system-f88d
    Pop-Location
}

$Kb = Join-Path $Root "music_brain\database\knowledge_db.py"
if (-not (Test-Path $Kb)) {
    Write-Error "Not found: $Kb"
}

$content = Get-Content $Kb -Raw
if ($content -notmatch "SCHEMA_BOOTSTRAP_VERSION|_ensure_files_migrated") {
    Write-Host "WARNING: knowledge_db.py still looks outdated." -ForegroundColor Yellow
    Write-Host "Open $Kb and confirm SCHEMA_BOOTSTRAP_VERSION exists." -ForegroundColor Yellow
} else {
    Write-Host "OK: knowledge_db.py has migration fix." -ForegroundColor Green
}

Write-Host "Reinstalling package..."
$pip = "pip"
if (Test-Path (Join-Path $Root ".venv\Scripts\pip.exe")) {
    $pip = Join-Path $Root ".venv\Scripts\pip.exe"
}
& $pip install -e . --force-reinstall --no-deps 2>$null
& $pip install -e .

Write-Host ""
Write-Host "Verify fix marker:" -ForegroundColor Cyan
Select-String -Path $Kb -Pattern "SCHEMA_BOOTSTRAP_VERSION|_ensure_files_migrated" | Select-Object -First 3

Write-Host ""
Write-Host "Now run:" -ForegroundColor Green
Write-Host "  music-brain serve"
Write-Host "If it still fails, rename data\music_brain.db to music_brain.db.bak and try again."
