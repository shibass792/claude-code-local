#Requires -Version 5.1
<#
.SYNOPSIS
  Index + ask over your drives WITHOUT copying files.
  Reads content from the original paths only when you ask.

.EXAMPLE
  # 1) Build index (paths only, no content copy)
  powershell -ExecutionPolicy Bypass -File .\knowledge-from-drives.ps1 -Index

  # 2) Ask a question (pulls matching files from drives into Ollama)
  powershell -ExecutionPolicy Bypass -File .\knowledge-from-drives.ps1 -Ask "מה יש בפרויקט shibass-ai?"
#>

param(
  # Drives / roots to scan (no copy - only paths go into the index)
  [string[]]$Roots = @("H:\", "C:\Users\shibass\Documents", "C:\Users\shibass\Desktop"),

  # Where to store the lightweight path index (NOT file contents)
  [string]$IndexFile = "H:\ai-knowledge\drive-index.jsonl",

  # Ollama model name
  [string]$Model = "myllama",

  # Ollama API
  [string]$OllamaUrl = "http://127.0.0.1:11434",

  # Build / refresh index
  [switch]$Index,

  # Ask a question (pulls relevant files from drives live)
  [string]$Ask,

  # Max files to pull into one answer
  [int]$TopK = 8,

  # Max chars per file sent to the model
  [int]$MaxCharsPerFile = 6000,

  # Max total chars for context
  [int]$MaxTotalChars = 24000,

  # Max file size to consider (bytes)
  [long]$MaxFileBytes = 5MB
)

$ErrorActionPreference = "Continue"

# Normalize Roots: allow "a;b;c" or accidental "a,b" from -File quirks
$Roots = @(
  $Roots |
    ForEach-Object { "$_" -split '[;]' } |
    ForEach-Object { $_.Trim().Trim('"') } |
    Where-Object { $_ }
)

$codeExt = ".py",".js",".ts",".tsx",".jsx",".mjs",".cjs",".java",".go",".rs",".cs",".cpp",".c",".h",".php",".rb",".swift",".sql",".sh",".ps1",".bat",".html",".css",".vue",".svelte",".json",".yml",".yaml",".toml",".prisma",".graphql"
$docExt  = ".md",".mdx",".txt",".rst",".csv",".log"
$chatExt = ".json",".jsonl",".html"
$allExt  = $codeExt + $docExt + $chatExt

$skipDirNames = @(
  "node_modules",".git","dist","build",".next","out","coverage",
  "__pycache__",".venv","venv",".tox",".cache","target",
  ".idea",".vscode","AppData","Windows","Program Files","Program Files (x86)",
  '$Recycle.Bin',"System Volume Information","Recovery","node_modules"
)

function Test-SkipDir([string]$path) {
  foreach ($part in ($path -split "[\\/]")) {
    if ($skipDirNames -contains $part) { return $true }
  }
  return $false
}

function Build-Index {
  $dir = Split-Path $IndexFile -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if (Test-Path $IndexFile) { Remove-Item $IndexFile -Force }

  Write-Host "Indexing paths only (no file copy)..." -ForegroundColor Cyan
  $n = 0

  foreach ($root in $Roots) {
    if (-not (Test-Path -LiteralPath $root)) {
      Write-Host "[skip missing] $root" -ForegroundColor DarkYellow
      continue
    }
    Write-Host "[scan] $root" -ForegroundColor Green

    Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object {
        ($allExt -contains $_.Extension.ToLower()) -and
        -not (Test-SkipDir $_.DirectoryName) -and
        $_.Length -gt 0 -and
        $_.Length -le $MaxFileBytes
      } |
      ForEach-Object {
        $rec = [ordered]@{
          path     = $_.FullName
          name     = $_.Name
          ext      = $_.Extension.ToLower()
          size     = $_.Length
          modified = $_.LastWriteTimeUtc.ToString("o")
          root     = $root
        }
        ($rec | ConvertTo-Json -Compress) | Add-Content -Path $IndexFile -Encoding UTF8
        $n++
        if (($n % 500) -eq 0) { Write-Host "  indexed $n files..." }
      }
  }

  Write-Host "Done. Indexed $n file paths -> $IndexFile" -ForegroundColor Magenta
  Write-Host "No content was copied. Files stay on their drives." -ForegroundColor Magenta
}

function Get-IndexRecords {
  if (-not (Test-Path $IndexFile)) {
    throw "Index not found: $IndexFile`nRun first: -Index"
  }
  Get-Content $IndexFile -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json }
}

function Find-Relevant {
  param([string]$Query, [int]$Take)

  $tokens = ($Query.ToLower() -split "\W+") | Where-Object { $_.Length -ge 2 } | Select-Object -Unique
  if (-not $tokens) { $tokens = @($Query.ToLower()) }

  $scored = @()
  foreach ($r in (Get-IndexRecords)) {
    $hay = ($r.path + " " + $r.name).ToLower()
    $score = 0
    foreach ($t in $tokens) {
      if ($hay -like "*$t*") { $score += 3 }
    }
    # Prefer code/docs over random json
    if ($codeExt -contains $r.ext) { $score += 1 }
    if ($docExt  -contains $r.ext) { $score += 2 }
    if ($score -gt 0) {
      $scored += [pscustomobject]@{ Score = $score; Rec = $r }
    }
  }

  $scored | Sort-Object Score -Descending | Select-Object -First $Take
}

function Read-FromDrive {
  param([string]$Path, [int]$MaxChars)
  try {
    # Pull live from original drive path - no copy
    $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
    if ($null -eq $text) { return $null }
    if ($text.Length -gt $MaxChars) {
      return $text.Substring(0, $MaxChars) + "`n...[truncated]..."
    }
    return $text
  } catch {
    try {
      $text = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
      if ($text.Length -gt $MaxChars) {
        return $text.Substring(0, $MaxChars) + "`n...[truncated]..."
      }
      return $text
    } catch {
      Write-Host "[cannot read] $Path" -ForegroundColor Red
      return $null
    }
  }
}

function Ask-Ollama {
  param([string]$Question)

  Write-Host "Searching index + pulling matching files from drives..." -ForegroundColor Cyan
  $hits = Find-Relevant -Query $Question -Take $TopK
  if (-not $hits) {
    Write-Host "No matching files in index. Try different words, or re-run -Index with more -Roots." -ForegroundColor Yellow
    return
  }

  $chunks = New-Object System.Collections.Generic.List[string]
  $used = 0
  foreach ($h in $hits) {
    $p = $h.Rec.path
    Write-Host ("  pull [{0}] {1}" -f $h.Score, $p) -ForegroundColor DarkGray
    $body = Read-FromDrive -Path $p -MaxChars $MaxCharsPerFile
    if (-not $body) { continue }
    $block = "----- FILE: $p -----`n$body"
    if (($used + $block.Length) -gt $MaxTotalChars) { break }
    $chunks.Add($block) | Out-Null
    $used += $block.Length
  }

  if ($chunks.Count -eq 0) {
    Write-Host "Found paths but could not read any file content." -ForegroundColor Red
    return
  }

  $context = ($chunks -join "`n`n")
  $prompt = @"
אתה עוזר מקומי. ענה בעברית אלא אם מבקשים אחרת.
הסתמך רק על הקבצים שנמשכו מהכוננים למטה. אם אין מספיק מידע - אמור זאת.
אל תמציא נתיבים או קוד שלא מופיעים.

שאלה:
$Question

קבצים שנמשכו מהכוננים (ללא העתקה):
$context
"@

  Write-Host "Asking Ollama ($Model)..." -ForegroundColor Cyan
  $payload = @{
    model  = $Model
    prompt = $prompt
    stream = $false
  } | ConvertTo-Json -Depth 5

  try {
    $resp = Invoke-RestMethod -Uri "$OllamaUrl/api/generate" -Method Post -Body $payload -ContentType "application/json; charset=utf-8"
    Write-Host ""
    Write-Host "===== תשובה =====" -ForegroundColor Magenta
    Write-Host $resp.response
    Write-Host "=================" -ForegroundColor Magenta
  } catch {
    Write-Host "Ollama error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Check: ollama serve / ollama run $Model" -ForegroundColor Yellow
  }
}

# --- main ---
if (-not $Index -and -not $Ask) {
  Write-Host @"

Usage:
  # Build path index from drives (NO copy)
  .\knowledge-from-drives.ps1 -Index

  # Ask - pulls matching file content live from drives into myllama
  .\knowledge-from-drives.ps1 -Ask "סכם את הקוד ב-shibass-ai"

  # Custom drives
  .\knowledge-from-drives.ps1 -Index -Roots H:\, D:\projects

"@
  exit 0
}

if ($Index) { Build-Index }
if ($Ask)   { Ask-Ollama -Question $Ask }
