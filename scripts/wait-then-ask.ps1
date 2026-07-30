#Requires -Version 5.1
<#
.SYNOPSIS
  Waiter: waits until drive-index.jsonl is ready, then runs -Ask.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File H:\models\wait-then-ask.ps1
  powershell -ExecutionPolicy Bypass -File H:\models\wait-then-ask.ps1 -Question "sum up shibass-ai"
#>

param(
  [string]$IndexFile = "H:\ai-knowledge\drive-index.jsonl",
  [string]$Script    = "H:\models\knowledge-from-drives.ps1",
  [string]$Question  = "sum up the code in shibass-ai",
  [int]$StableSeconds = 20,   # size must not change for this long
  [int]$PollSeconds   = 5,
  [int]$MaxWaitMinutes = 120
)

$ErrorActionPreference = "Continue"
$deadline = (Get-Date).AddMinutes($MaxWaitMinutes)

function Test-FileReady([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  try {
    $fs = [IO.File]::Open($Path, 'Open', 'Read', 'None')
    $fs.Close()
    return $true
  } catch {
    return $false
  }
}

Write-Host ""
Write-Host "=== Waiter: index -> ask ===" -ForegroundColor Magenta
Write-Host "Index:  $IndexFile"
Write-Host "Ask:    $Question"
Write-Host "Stable: ${StableSeconds}s without size change"
Write-Host ""

$lastSize = -1
$stableFor = 0
$started = Get-Date

while ((Get-Date) -lt $deadline) {
  $elapsed = [int]((Get-Date) - $started).TotalSeconds

  if (-not (Test-Path -LiteralPath $IndexFile)) {
    Write-Host ("[{0,4}s] waiting for index file to appear..." -f $elapsed) -ForegroundColor Yellow
    Start-Sleep -Seconds $PollSeconds
    continue
  }

  $item = Get-Item -LiteralPath $IndexFile
  $size = $item.Length
  $locked = -not (Test-FileReady $IndexFile)

  if ($locked) {
    Write-Host ("[{0,4}s] index LOCKED (scan still writing)  size={1:N0}" -f $elapsed, $size) -ForegroundColor Yellow
    $stableFor = 0
    $lastSize = $size
    Start-Sleep -Seconds $PollSeconds
    continue
  }

  if ($size -ne $lastSize) {
    Write-Host ("[{0,4}s] size changing: {1:N0} -> {2:N0}  (resetting stable timer)" -f $elapsed, $lastSize, $size) -ForegroundColor Cyan
    $lastSize = $size
    $stableFor = 0
    Start-Sleep -Seconds $PollSeconds
    continue
  }

  $stableFor += $PollSeconds
  Write-Host ("[{0,4}s] size stable {1:N0} bytes  ({2}/{3}s)" -f $elapsed, $size, $stableFor, $StableSeconds) -ForegroundColor Green

  if ($stableFor -ge $StableSeconds -and $size -gt 0) {
    Write-Host ""
    Write-Host "Index ready. Starting Ask..." -ForegroundColor Magenta
    Write-Host ""
    & powershell -ExecutionPolicy Bypass -File $Script -Ask $Question
    exit $LASTEXITCODE
  }

  Start-Sleep -Seconds $PollSeconds
}

Write-Host "Timeout after $MaxWaitMinutes minutes. Index not stable." -ForegroundColor Red
exit 1
