# Music Brain — first full scan + analyze + index
# Usage: powershell -ExecutionPolicy Bypass -File pipeline-first-run.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

. (Join-Path $Root ".venv\Scripts\Activate.ps1")

Write-Host "=== Music Brain — First Pipeline ===" -ForegroundColor Cyan
Write-Host "This may take a long time on first run (all drives)."
Write-Host ""

# Backup before big operation
Write-Host "[1/5] Backup database..."
music-brain backup

Write-Host "[2/5] Scan all drives (incremental)..."
music-brain scan

Write-Host "[3/5] Learn from DAW projects..."
# pipeline includes learn; run full pipeline with workers
$workers = [Environment]::ProcessorCount
if ($workers -gt 8) { $workers = 8 }
Write-Host "[4/5] Analyze audio (workers=$workers)..."
music-brain pipeline --limit 5000 --workers $workers

Write-Host "[5/5] Build sonic embeddings index..."
music-brain index-embeddings

Write-Host ""
Write-Host "First run complete!" -ForegroundColor Green
music-brain status
Write-Host ""
Write-Host "Start UI: scripts\windows\start-all.ps1"
