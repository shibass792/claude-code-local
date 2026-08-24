#Requires -Version 5.1
# ASCII-only. Wires ShiBass OS bridge + scan onto this PC.
# Default target: H:\shibass-ai
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$Branch = "cursor/real-studio-apis-0b72",
  [string]$RepoSlug = "shibass792/claude-code-local",
  [switch]$Full
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$Message) { Write-Host "[>] $Message" }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Get-RawUrl([string]$RelativePath) {
  return "https://raw.githubusercontent.com/$RepoSlug/$Branch/$RelativePath"
}

function Install-File {
  param([string]$RelativePath, [string]$Destination)
  Ensure-Directory (Split-Path -Parent $Destination)
  $url = Get-RawUrl $RelativePath
  Write-Step ("Download " + $RelativePath)
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $Destination -TimeoutSec 90
  if (-not (Test-Path -LiteralPath $Destination) -or ((Get-Item -LiteralPath $Destination).Length -lt 20)) {
    throw ("Download failed or empty: " + $url)
  }
}

Write-Host "===================================================================="
Write-Host "  ShiBass - update local PC"
Write-Host "===================================================================="
Write-Host ("Target: " + $TargetRoot)
Write-Host ("Branch: " + $Branch)
Write-Host ""

Ensure-Directory $TargetRoot

if ($Full) {
  $updates = Join-Path $TargetRoot "INSTALL-SHIBASS-UPDATES.ps1"
  Install-File "INSTALL-SHIBASS-UPDATES.ps1" $updates
  Write-Step "Full copy of promo-publisher, tools, scripts"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $updates -TargetRoot $TargetRoot -Branch $Branch
  if ($LASTEXITCODE -ne 0) {
    throw "INSTALL-SHIBASS-UPDATES.ps1 failed"
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node.exe is not on PATH. Install Node.js, then rerun."
}

$dest = Join-Path $TargetRoot "tools\os-bridge"
Ensure-Directory $dest

$bridgeFiles = @(
  "routes.js",
  "scan.js",
  "proxy.js",
  "patch-server.js",
  "apply.js",
  "os-bridge.test.js",
  "Patch-OsBridge.ps1"
)

foreach ($name in $bridgeFiles) {
  Install-File ("tools/os-bridge/" + $name) (Join-Path $dest $name)
}

Install-File "Scan-ShiBassApis.ps1" (Join-Path $TargetRoot "Scan-ShiBassApis.ps1")
Install-File "INSTALL-OS-BRIDGE.ps1" (Join-Path $TargetRoot "INSTALL-OS-BRIDGE.ps1")
Install-File "UPDATE-LOCAL-PC.ps1" (Join-Path $TargetRoot "UPDATE-LOCAL-PC.ps1")
Install-File "INSTALL-KIRO-CREW.ps1" (Join-Path $TargetRoot "INSTALL-KIRO-CREW.ps1")
Install-File "START-KIRO-CREW.ps1" (Join-Path $TargetRoot "START-KIRO-CREW.ps1")
Install-File "START-KIRO-CREW.cmd" (Join-Path $TargetRoot "START-KIRO-CREW.cmd")

$apply = Join-Path $dest "apply.js"
Write-Step "Patch server.js so 4000 proxies studio APIs to 4052"
& node $apply $TargetRoot
if ($LASTEXITCODE -ne 0) {
  throw "apply.js failed with exit $LASTEXITCODE"
}

$serverJs = Join-Path $TargetRoot "server.js"
if (Test-Path -LiteralPath $serverJs) {
  $text = Get-Content -LiteralPath $serverJs -Raw
  if ($text -notmatch "/api/os/health") {
    throw "server.js still missing /api/os/health after patch"
  }
  Write-Ok "server.js now contains /api/os/health"
} else {
  Write-Host "[!] server.js not found yet at H:\shibass-ai\server.js" -ForegroundColor Yellow
  Write-Host "    The bridge files are on disk. Copy server.js here, then rerun this script."
}

Write-Host ""
Write-Ok "Local device updated."
Write-Host "1. Restart: node server.js   (port 4000)"
Write-Host "2. Keep studio API: cd H:\shibass-ai\promo-publisher"
Write-Host "3. Then: npm run api"
Write-Host "4. Scan: powershell -ExecutionPolicy Bypass -File H:\shibass-ai\Scan-ShiBassApis.ps1"
Write-Host "5. Optional Kiro Crew on 5476 (never 4000/4052/8788):"
Write-Host "   powershell -ExecutionPolicy Bypass -File H:\shibass-ai\INSTALL-KIRO-CREW.ps1"
