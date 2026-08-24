#Requires -Version 5.1
# ASCII-only. Starts Kiro Crew gateway on 5476 only.
param(
  [string]$TargetRoot = "H:\shibass-ai",
  [int]$Port = 5476
)

$ErrorActionPreference = "Stop"

if ($Port -eq 4000 -or $Port -eq 4052 -or $Port -eq 8788) {
  throw "Refusing to bind Kiro Crew on $Port. Use 5476."
}

$clone = Join-Path $TargetRoot "KiroCrew"
$kiro = Join-Path $clone ".venv\Scripts\kirocrew.exe"
if (-not (Test-Path -LiteralPath $kiro)) {
  throw "Kiro Crew is not built. Run INSTALL-KIRO-CREW.ps1 first."
}

$env:KIROCREW_PORT = [string]$Port
Write-Host ("Starting Kiro Crew gateway on http://127.0.0.1:" + $Port)
Write-Host "ShiBass OS remains on 4000. Studio API remains on 4052."
Set-Location $clone
& $kiro gateway
