# העתקת עדכונים מ-ZIP — הוראות קצרות

## הבעיה שלך

העתקת רק `main.js` + `package.json`.  
קבצי Demucs (`scripts\`, `tools\`) **לא הועתקו** — לכן PowerShell אמר "does not exist".

**אל תדביק טקסט/markdown ל-PowerShell** — רק פקודות.

## פתרון — הדבק בלוק אחד ב-PowerShell

```powershell
$ZipPath = "$env:USERPROFILE\Downloads\claude-code-local-cursor-shibass-social-studio-c044.zip"
$TargetRoot = "H:\shibass-ai"
$staging = "$env:TEMP\shibass-full-copy"
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $ZipPath -DestinationPath $staging -Force
$src = (Get-ChildItem $staging -Directory | Select-Object -First 1).FullName
foreach ($name in @("scripts","tools","docs","promo-publisher")) {
  $from = Join-Path $src $name
  $to = Join-Path $TargetRoot $name
  if (Test-Path $from) {
    if (-not (Test-Path $to)) { New-Item -ItemType Directory -Path $to -Force | Out-Null }
    Copy-Item -Path (Join-Path $from "*") -Destination $to -Recurse -Force
    Write-Host "OK $name"
  }
}
foreach ($f in @("COPY-ALL-FROM-ZIP.ps1","COPY-ALL-FROM-ZIP.cmd","START-MIDI-FORGE-DEMUCS.cmd")) {
  $sf = Join-Path $src $f
  if (Test-Path $sf) { Copy-Item $sf (Join-Path $TargetRoot $f) -Force }
}
Remove-Item $staging -Recurse -Force
Test-Path "H:\shibass-ai\scripts\wire-demucs-for-midi-forge.ps1"
Test-Path "H:\shibass-ai\tools\demucs_wav_hook.py"
```

אמור לראות `True` פעמיים.

## Demucs

```powershell
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\start-demucs-pipeline.ps1
```

## Social Studio (Electron)

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\shibass-social-studio" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "H:\shibass-ai\promo-publisher\.electron-user-data" -ErrorAction SilentlyContinue
cd H:\shibass-ai\promo-publisher
npm install
npm start
```

אם Electron נסגר מיד — הרץ:

```powershell
cd H:\shibass-ai\promo-publisher
npx electron . --disable-gpu --no-sandbox 2>&1 | Tee-Object -FilePath H:\shibass-ai\07_LOGS\electron-start.log
```

ושלח את תוכן `07_LOGS\electron-start.log`.
