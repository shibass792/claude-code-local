#Requires -Version 5.1
<#
.SYNOPSIS
  Scan H:\shibass-ai frontend files for /api/* calls and probe the main server.

.DESCRIPTION
  Collects JS/TS/HTML panel files, extracts fetch/axios endpoints, then OPTIONS
  each one against the ShiBass main server (default http://127.0.0.1:4000).

  Run this on the Windows machine, with server.js already listening:

      powershell -NoProfile -ExecutionPolicy Bypass -File H:\shibass-ai\Scan.ps1

  Or from this repo after copying the file onto H:\.
#>
[CmdletBinding()]
param(
    [string]$Root = 'H:\shibass-ai',
    [string]$ServerUrl = 'http://127.0.0.1:4000'
)

$ErrorActionPreference = 'Continue'

if (-not (Test-Path -LiteralPath $Root)) {
    Write-Host "הנתיב $Root לא קיים במחשב הזה. הרץ את הסקריפט על Windows עם H:\shibass-ai." -ForegroundColor Red
    exit 1
}

$SkipPattern = '\\node_modules\\|\\\.git\\|\\dist\\|\\build\\|\\\.electron-user-data\\'

Write-Host "אוסף קבצים מ-$Root ..." -ForegroundColor Cyan
$Files = Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Extension -match '\.(js|jsx|ts|tsx|mjs|cjs|html|vue)$' -and
        $_.FullName -notmatch $SkipPattern
    }

Write-Host "נאספו $($Files.Count) קבצים. מחפש קריאות API..." -ForegroundColor Cyan

$Endpoints = @{}
$Regex = '(?:fetch|axios\.(?:get|post|put|delete))\s*\(\s*[`''"](?:window\.__getApiBase\(\)\s*\+\s*)?(/api/[^`''"?]+)'

foreach ($File in $Files) {
    $Content = Get-Content -LiteralPath $File.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $Content) { continue }
    if ($Content -match $Regex) {
        $Matches = [regex]::Matches($Content, $Regex)
        foreach ($Match in $Matches) {
            $Endpoint = $Match.Groups[1].Value
            $Endpoints[$Endpoint] = $true
        }
    }
}

Write-Host "מצאתי $($Endpoints.Count) קריאות API שונות. מתחיל בדיקה מול $ServerUrl..." -ForegroundColor Yellow

$Working = @()
$Missing = @()

foreach ($Endpoint in $Endpoints.Keys) {
    $FullUrl = "$ServerUrl$Endpoint"
    try {
        $Response = Invoke-WebRequest -Uri $FullUrl -Method Options -UseBasicParsing -TimeoutSec 8
        if ($Response.StatusCode -ne 404) {
            $Working += $Endpoint
        } else {
            $Missing += $Endpoint
        }
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -eq 404) {
            $Missing += $Endpoint
        } elseif ($_.Exception.Response -eq $null) {
            Write-Host "השרת לא מגיב ב-$ServerUrl. ודא ש-server.js פועל!" -ForegroundColor Red
            break
        } else {
            $Working += $Endpoint
        }
    }
}

Write-Host "`nנקודות קצה פעילות (Backend קיים בשרת):" -ForegroundColor Green
if ($Working.Count -eq 0) {
    Write-Host "  (אין)" -ForegroundColor DarkGreen
} else {
    $Working | Sort-Object | ForEach-Object { Write-Host "  - $_" }
}

Write-Host "`nנקודות קצה חסרות (דורשות פיתוח בשרת):" -ForegroundColor Red
if ($Missing.Count -eq 0) {
    Write-Host "  (אין)" -ForegroundColor DarkRed
} else {
    $Missing | Sort-Object | ForEach-Object { Write-Host "  - $_" }
}

Write-Host "`nסריקה הושלמה." -ForegroundColor Cyan
Write-Host "העתק לכאן את הרשימה האדומה (החסרה) כדי שנכתוב לה את קוד השרת." -ForegroundColor Cyan
