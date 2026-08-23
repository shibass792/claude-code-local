#Requires -Version 5.1
<#
.SYNOPSIS
  Normalize .cmd/.bat files to CRLF + UTF-8 BOM (fixes 'cho', '/d', 'MIDI' parse errors).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\fix-windows-batch.ps1 -Path H:\shibass-ai\START-MIDI.cmd
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

if (-not (Test-Path $Path)) {
  Write-Error "File not found: $Path"
  exit 1
}

$content = Get-Content -LiteralPath $Path -Raw
$utf8Bom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($Path, $content.Replace("`n", "`r`n"), $utf8Bom)
Write-Host "Fixed CRLF + UTF-8 BOM: $Path" -ForegroundColor Green
