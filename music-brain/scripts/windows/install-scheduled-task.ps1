# Register Windows Task Scheduler — auto-start Music Brain on login
# Run as Administrator recommended
# Usage: powershell -ExecutionPolicy Bypass -File install-scheduled-task.ps1

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$startScript = Join-Path $PSScriptRoot "start-all.ps1"
$TaskName = "MusicBrain"

Write-Host "=== Install Scheduled Task: $TaskName ===" -ForegroundColor Cyan
Write-Host "Root: $Root"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`"" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Music Brain — scan, analyze, Cubase AI" -Force

Write-Host ""
Write-Host "Task '$TaskName' registered — starts on login." -ForegroundColor Green
Write-Host "Remove: Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
