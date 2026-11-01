# Installs the fix-ticket skill on Windows.
#   1. Copies it to F:\shibass-ai\fix-ticket (your working copy)
#   2. Copies it to %USERPROFILE%\.claude\skills\fix-ticket so Claude Code finds it
#
# Run from this folder in PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
# Use a different drive/folder with:  -Target "D:\shibass-ai"

param(
    [string]$Target = "F:\shibass-ai"
)

$ErrorActionPreference = "Stop"
$source = $PSScriptRoot

$drive = Split-Path -Qualifier $Target
if (-not (Test-Path "$drive\")) {
    Write-Error "Drive $drive not found. Pass -Target with an existing drive, e.g. -Target 'C:\shibass-ai'."
}

$destinations = @(
    (Join-Path $Target "fix-ticket"),
    (Join-Path $env:USERPROFILE ".claude\skills\fix-ticket")
)

foreach ($dest in $destinations) {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    # Unzipped straight into the destination: nothing to copy (Copy-Item onto itself fails).
    if ((Resolve-Path $dest).Path.TrimEnd('\') -ieq (Resolve-Path $source).Path.TrimEnd('\')) {
        Write-Host "Already in place -> $dest"
        continue
    }
    Copy-Item -Path (Join-Path $source "*") -Destination $dest -Recurse -Force
    Write-Host "Installed fix-ticket -> $dest"
}

Write-Host ""
Write-Host "Done. Next steps:"
Write-Host "  1. Copy fix-ticket.config.example.json to your project root as fix-ticket.config.json and fill it in."
Write-Host "  2. Start Claude Code in your project and run:  /fix-ticket PROJ-123"
