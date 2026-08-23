#Requires -Version 5.1
<#
.SYNOPSIS
  Poll social output folder and import new renders into promo-publisher approval queue.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\watch-social-inbox.ps1
#>
param(
  [string]$Root = "H:\shibass-ai",
  [string]$Inbox = "H:\shibass-ai\10_OUTPUTS\social",
  [int]$IntervalSec = 30
)

$importScript = Join-Path $Root "promo-publisher\scripts\import-social-inbox.js"
if (-not (Test-Path $importScript)) {
  Write-Error "Missing $importScript — copy promo-publisher from repo first."
  exit 1
}

New-Item -ItemType Directory -Force -Path $Inbox | Out-Null

Write-Host "Watching $Inbox every ${IntervalSec}s → promo-publisher queue"
Write-Host "Ctrl+C to stop"
Write-Host ""

while ($true) {
  node $importScript --inbox $Inbox
  Start-Sleep -Seconds $IntervalSec
}
