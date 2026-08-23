#Requires -Version 5.1
# ASCII-only. Installs the ShiBass Studio SQLite database on this PC.
param(
  [string]$Branch = "cursor/real-studio-apis-0b72",
  [string]$RepoSlug = "shibass792/claude-code-local",
  [string]$StudioRoot = "H:\shibass-ai\promo-publisher"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$Message) { Write-Host "[>] $Message" }
function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }

function Ensure-Directory([string]$Path) {
  if (-not [System.IO.Directory]::Exists($Path)) {
    [void][System.IO.Directory]::CreateDirectory($Path)
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
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $Destination -TimeoutSec 60
  $bytes = (Get-Item -LiteralPath $Destination).Length
  Write-Ok ("Saved {0} bytes -> {1}" -f $bytes, $Destination)
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js is missing. Install Node 22+ then rerun this script."
}

$ver = & node -p "process.versions.node"
Write-Step "Node $ver"
$major = [int]($ver.Split('.')[0])
if ($major -lt 22) {
  throw "Studio SQL needs Node 22+ for node:sqlite. This PC has $ver"
}

$localInstaller = Join-Path $PSScriptRoot "tools\studio-sql\install-studio-sql.js"
$localSql = Join-Path $PSScriptRoot "promo-publisher\modules\sql-db.js"
if ((Test-Path -LiteralPath $localInstaller) -and (Test-Path -LiteralPath $localSql)) {
  Write-Ok "Using local repo files from $PSScriptRoot"
  $StudioRoot = Join-Path $PSScriptRoot "promo-publisher"
  $installer = $localInstaller
} else {
  $files = @(
    @{ Rel = "promo-publisher/modules/sql-db.js"; Dest = Join-Path $StudioRoot "modules\sql-db.js" },
    @{ Rel = "promo-publisher/modules/scan-fake.js"; Dest = Join-Path $StudioRoot "modules\scan-fake.js" },
    @{ Rel = "promo-publisher/modules/store.js"; Dest = Join-Path $StudioRoot "modules\store.js" },
    @{ Rel = "promo-publisher/modules/creation-log.js"; Dest = Join-Path $StudioRoot "modules\creation-log.js" },
    @{ Rel = "tools/studio-sql/install-studio-sql.js"; Dest = "H:\shibass-ai\tools\studio-sql\install-studio-sql.js" }
  )
  foreach ($file in $files) {
    Install-File -RelativePath $file.Rel -Destination $file.Dest
  }
  $installer = "H:\shibass-ai\tools\studio-sql\install-studio-sql.js"
}

Ensure-Directory (Join-Path $StudioRoot "output")
$env:STUDIO_ROOT = $StudioRoot
Write-Step "Creating SQLite database and importing JSON stores"
& node $installer
if ($LASTEXITCODE -ne 0) {
  throw "SQL installer exited $LASTEXITCODE"
}

$db = Join-Path $StudioRoot "output\studio.db"
if (-not (Test-Path -LiteralPath $db)) {
  throw "studio.db was not created at $db"
}

Write-Ok "SQLite ready at $db"
Write-Host "Restart Studio API:  cd $StudioRoot"
Write-Host "Then:  npm run api"
