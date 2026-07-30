# Music Brain — start Web UI + background watch + Cubase Companion
# Usage: powershell -ExecutionPolicy Bypass -File start-all.ps1

$ErrorActionPreference = "Continue"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

$venvBin = Join-Path $Root ".venv\Scripts"
$musicBrain = Join-Path $venvBin "music-brain.exe"
if (-not (Test-Path $musicBrain)) {
    Write-Error "Run install.ps1 first"
}

$logDir = Join-Path $Root "data\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

Write-Host "=== Music Brain — Starting ===" -ForegroundColor Cyan

# Web UI
$serveJob = Start-Process -FilePath $musicBrain -ArgumentList "serve" `
    -WorkingDirectory $Root -WindowStyle Minimized `
    -RedirectStandardOutput (Join-Path $logDir "serve.log") `
    -RedirectStandardError (Join-Path $logDir "serve.err.log") -PassThru

Start-Sleep -Seconds 2

# Background watch (scan + analyze new files)
$watchJob = Start-Process -FilePath $musicBrain -ArgumentList "watch", "--events" `
    -WorkingDirectory $Root -WindowStyle Minimized `
    -RedirectStandardOutput (Join-Path $logDir "watch.log") `
    -RedirectStandardError (Join-Path $logDir "watch.err.log") -PassThru

# Cubase Companion (.cpr save → recommendations)
$cubaseJob = Start-Process -FilePath $musicBrain -ArgumentList "cubase-companion", "--events" `
    -WorkingDirectory $Root -WindowStyle Minimized `
    -RedirectStandardOutput (Join-Path $logDir "cubase.log") `
    -RedirectStandardError (Join-Path $logDir "cubase.err.log") -PassThru

Write-Host ""
Write-Host "Services started:" -ForegroundColor Green
Write-Host "  Web UI:            http://127.0.0.1:8787"
Write-Host "  Watch PID:         $($watchJob.Id)"
Write-Host "  Serve PID:         $($serveJob.Id)"
Write-Host "  Cubase Companion:  $($cubaseJob.Id)"
Write-Host "  Logs:              data\logs\"
Write-Host ""
Write-Host "Recommendations file: data\cubase_recommendations.json"
Write-Host ""
Write-Host "Opening browser..."
Start-Process "http://127.0.0.1:8787"

# Save PIDs for stop script
@{
    serve  = $serveJob.Id
    watch  = $watchJob.Id
    cubase = $cubaseJob.Id
} | ConvertTo-Json | Set-Content (Join-Path $Root "data\running.json")
