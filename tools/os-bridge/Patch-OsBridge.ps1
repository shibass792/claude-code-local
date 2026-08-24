#Requires -Version 5.1
# ASCII-only. Windows PowerShell 5.1 reads this as ANSI; non-ASCII breaks quotes.
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$Branch = "cursor/real-studio-apis-0b72",
  [string]$RepoSlug = "shibass792/claude-code-local"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$Message) { Write-Host "[>] $Message" }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[!] $Message" -ForegroundColor Yellow }

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
  Write-Step "Download $RelativePath"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $Destination
  if (-not (Test-Path -LiteralPath $Destination) -or ((Get-Item -LiteralPath $Destination).Length -lt 20)) {
    throw "Download failed or empty: $url"
  }
}

$files = @(
  "routes.js",
  "scan.js",
  "proxy.js",
  "patch-server.js",
  "apply.js",
  "os-bridge.test.js",
  "Patch-OsBridge.ps1"
)

Write-Host "===================================================================="
Write-Host "  ShiBass - mount OS bridge on server.js (4000 -> 4052)"
Write-Host "===================================================================="
Write-Host ("Target: " + $TargetRoot)
Write-Host ("Branch: " + $Branch)
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node.exe is not on PATH. Install Node.js, then rerun."
}

$dest = Join-Path $TargetRoot "tools\os-bridge"
Ensure-Directory $dest

$repoCopy = Join-Path $PSScriptRoot "apply.js"
if (Test-Path -LiteralPath $repoCopy) {
  Write-Step "Copying tools from this folder"
  foreach ($name in $files) {
    $src = Join-Path $PSScriptRoot $name
    if (Test-Path -LiteralPath $src) {
      Copy-Item -LiteralPath $src -Destination (Join-Path $dest $name) -Force
    }
  }
} else {
  foreach ($name in $files) {
    Install-File ("tools/os-bridge/" + $name) (Join-Path $dest $name)
  }
}

function Install-RootScript([string]$RelativePath) {
  $leaf = Split-Path -Leaf $RelativePath
  $destination = Join-Path $TargetRoot $leaf
  $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $local = Join-Path $repoRoot ($RelativePath.Replace("/", "\"))
  if (Test-Path -LiteralPath $local) {
    Copy-Item -LiteralPath $local -Destination $destination -Force
    Write-Ok ("Copied " + $leaf + " -> " + $destination)
  } else {
    Install-File $RelativePath $destination
  }
}

Install-RootScript "Scan-ShiBassApis.ps1"
Install-RootScript "INSTALL-OS-BRIDGE.ps1"

$apply = Join-Path $dest "apply.js"
if (-not (Test-Path -LiteralPath $apply)) {
  throw "apply.js is missing under $dest"
}

Write-Step "Patching server.js"
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
  Write-Warn "server.js not found at $serverJs - apply.js should have said so"
}

Write-Host ""
Write-Ok "Done. Restart node server.js (port 4000)."
Write-Host "Keep Studio API running on 4052: cd H:\shibass-ai\promo-publisher"
Write-Host "Then: npm run api"
Write-Host "Scan after restart: powershell -ExecutionPolicy Bypass -File H:\shibass-ai\Scan-ShiBassApis.ps1"
