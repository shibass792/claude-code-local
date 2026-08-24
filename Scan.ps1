#Requires -Version 5.1
# One-file scan. Creates itself on H:\ if you downloaded it, and pulls
# tools/os-bridge when missing so you do not paste loops into the terminal.
param(
  [string]$Root = "H:\shibass-ai",
  [string]$ServerUrl = "http://127.0.0.1:4000",
  [string]$StudioUrl = "http://127.0.0.1:4052",
  [string]$Branch = "cursor/fix-electron-epipe-0efa",
  [string]$RepoSlug = "shibass792/claude-code-local"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Test-Path -LiteralPath $Root)) {
  Write-Host ("Path missing: " + $Root) -ForegroundColor Red
  exit 1
}

function Get-RawUrl([string]$RelativePath) {
  return "https://raw.githubusercontent.com/$RepoSlug/$Branch/$RelativePath"
}

function Ensure-File([string]$RelativePath, [string]$Destination) {
  $dir = Split-Path -Parent $Destination
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  if ((Test-Path -LiteralPath $Destination) -and ((Get-Item -LiteralPath $Destination).Length -gt 20)) {
    return
  }
  $url = Get-RawUrl $RelativePath
  Write-Host ("[scan] download " + $RelativePath)
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $Destination
}

$bridgeDir = Join-Path $Root "tools\os-bridge"
Ensure-File "tools/os-bridge/routes.js" (Join-Path $bridgeDir "routes.js")
Ensure-File "tools/os-bridge/scan.js" (Join-Path $bridgeDir "scan.js")
Ensure-File "tools/os-bridge/proxy.js" (Join-Path $bridgeDir "proxy.js")

$scanJs = Join-Path $bridgeDir "scan.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node.exe is not on PATH."
}

$outDir = Join-Path $Root "output"
if (-not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}
$outFile = Join-Path $outDir "api-scan.json"

Write-Host "[scan] ShiBass API scan"
Write-Host ("[scan] root   " + $Root)
Write-Host ("[scan] os     " + $ServerUrl)
Write-Host ("[scan] studio " + $StudioUrl)
Write-Host ""

& node $scanJs --root $Root --os $ServerUrl --studio $StudioUrl --out $outFile --probe
if ($LASTEXITCODE -ne 0) {
  throw "scan.js exited $LASTEXITCODE"
}

Write-Host ""
Write-Host "[scan] JSON report:"
Write-Host $outFile
Write-Host ""
Write-Host "If OPTIONS 404 on 4000 for /api/engines /api/render /api/approval:"
Write-Host "  1) powershell -ExecutionPolicy Bypass -File H:\shibass-ai\INSTALL-OS-BRIDGE.ps1"
Write-Host "  2) H:\shibass-ai\START-OS-SERVER.cmd"
Write-Host "  3) H:\shibass-ai\START-STUDIO-API.cmd"
