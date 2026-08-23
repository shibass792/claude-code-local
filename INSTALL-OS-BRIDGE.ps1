#Requires -Version 5.1
# ASCII-only wrapper. See tools/os-bridge/Patch-OsBridge.ps1
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [string]$Branch = "cursor/real-studio-apis-0b72"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$nested = Join-Path $here "tools\os-bridge\Patch-OsBridge.ps1"

if (Test-Path -LiteralPath $nested) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $nested -TargetRoot $TargetRoot -Branch $Branch
  exit $LASTEXITCODE
}

Write-Host "Local tools/os-bridge is missing - downloading Patch-OsBridge.ps1"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$temp = Join-Path $env:TEMP "Patch-OsBridge.ps1"
$url = "https://raw.githubusercontent.com/shibass792/claude-code-local/$Branch/tools/os-bridge/Patch-OsBridge.ps1"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $temp
& powershell -NoProfile -ExecutionPolicy Bypass -File $temp -TargetRoot $TargetRoot -Branch $Branch
exit $LASTEXITCODE
