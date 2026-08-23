#Requires -Version 5.1
# ASCII-only wrapper. See tools/sb-daw/Patch-SbDawJobs.ps1
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$Branch = "cursor/real-studio-apis-0b72",
  [switch]$RewriteHtml
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$nested = Join-Path $here "tools\sb-daw\Patch-SbDawJobs.ps1"

if (Test-Path -LiteralPath $nested) {
  if ($RewriteHtml) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $nested -TargetRoot $TargetRoot -Branch $Branch -RewriteHtml
  } else {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $nested -TargetRoot $TargetRoot -Branch $Branch
  }
  exit $LASTEXITCODE
}

Write-Host "Local tools/sb-daw is missing - downloading Patch-SbDawJobs.ps1"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$temp = Join-Path $env:TEMP "Patch-SbDawJobs.ps1"
$url = "https://raw.githubusercontent.com/shibass792/claude-code-local/$Branch/tools/sb-daw/Patch-SbDawJobs.ps1"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $temp
if ($RewriteHtml) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $temp -TargetRoot $TargetRoot -Branch $Branch -RewriteHtml
} else {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $temp -TargetRoot $TargetRoot -Branch $Branch
}
exit $LASTEXITCODE
