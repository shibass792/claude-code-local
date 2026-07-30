# Music Brain — stop background services started by start-all.ps1

$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$pidFile = Join-Path $Root "data\running.json"

if (-not (Test-Path $pidFile)) {
    Write-Host "No running.json found. Killing music-brain python processes..."
    Get-Process python* -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*music_brain*"
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    exit 0
}

$pids = Get-Content $pidFile | ConvertFrom-Json
foreach ($name in @("serve", "watch", "cubase")) {
    $id = $pids.$name
    if ($id) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped $name (PID $id)"
    }
}
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "Done." -ForegroundColor Green
