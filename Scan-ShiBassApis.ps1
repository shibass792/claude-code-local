#Requires -Version 5.1
# ASCII-only. One-file scan. Do not paste loops into the terminal.
param(
  [string]$ScanPath = "",
  [string]$ServerUrl = "http://127.0.0.1:4000",
  [string]$StudioUrl = "http://127.0.0.1:4052"
)

$ErrorActionPreference = "Stop"

if (-not $ScanPath) {
  if ($PSScriptRoot) {
    $ScanPath = $PSScriptRoot
  } else {
    $ScanPath = (Get-Location).Path
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node.exe is not on PATH. Install Node.js, then rerun."
}

$scanJs = Join-Path $ScanPath "tools\os-bridge\scan.js"
if (-not (Test-Path -LiteralPath $scanJs)) {
  $scanJs = Join-Path $PSScriptRoot "tools\os-bridge\scan.js"
}
if (-not (Test-Path -LiteralPath $scanJs)) {
  throw "tools\os-bridge\scan.js is missing. Run INSTALL-OS-BRIDGE.ps1 first."
}

$outDir = Join-Path $ScanPath "output"
if (-not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}
$outFile = Join-Path $outDir "api-scan.json"

Write-Host "[scan] ShiBass API scan"
Write-Host ("[scan] root   " + $ScanPath)
Write-Host ("[scan] os     " + $ServerUrl)
Write-Host ("[scan] studio " + $StudioUrl)
Write-Host ""

& node $scanJs --root $ScanPath --os $ServerUrl --studio $StudioUrl --out $outFile --probe
if ($LASTEXITCODE -ne 0) {
  throw "scan.js exited $LASTEXITCODE"
}

Write-Host ""
Write-Host "[scan] JSON report:"
Write-Host $outFile
Write-Host ""
Write-Host "If OPTIONS 404 on 4000 for /api/engines /api/render /api/approval:"
Write-Host "  1) powershell -ExecutionPolicy Bypass -File H:\shibass-ai\INSTALL-OS-BRIDGE.ps1"
Write-Host "  2) Restart node server.js on 4000"
Write-Host "  3) cd H:\shibass-ai\promo-publisher"
Write-Host "  4) npm run api"
