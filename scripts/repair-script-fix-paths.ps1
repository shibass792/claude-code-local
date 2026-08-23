#Requires -Version 5.1
<#
.SYNOPSIS
  Fix broken tools\script_fix_paths.ps1 (typo $.PSIsContainer) or confirm it is OK.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\repair-script-fix-paths.ps1
#>
param(
  [string]$TargetRoot = "H:\shibass-ai"
)

$ErrorActionPreference = "Stop"

$path = Join-Path $TargetRoot "tools\script_fix_paths.ps1"

if (-not (Test-Path $path)) {
  Write-Host "Missing: $path" -ForegroundColor Red
  Write-Host "Run COPY-ALL-FROM-ZIP.ps1 after downloading a fresh branch ZIP." -ForegroundColor Yellow
  exit 1
}

$content = Get-Content -LiteralPath $path -Raw

if ($content -notmatch '\$\.PSIsContainer') {
  Write-Host "OK — tools\script_fix_paths.ps1 has no $.PSIsContainer typo." -ForegroundColor Green
  exit 0
}

Write-Host "Repairing $.PSIsContainer typo in $path" -ForegroundColor Yellow
$fixed = $content -replace '\$\.PSIsContainer', '$_.PSIsContainer'
Set-Content -LiteralPath $path -Value $fixed -Encoding UTF8
Write-Host "Done. Prefer re-copy from fresh ZIP if the script still errors." -ForegroundColor Green
