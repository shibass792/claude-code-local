# העתקת עדכונים מ-ZIP — הוראות קצרות

## הבעיה שלך (עכשיו)

ראית `OK scripts` אבל:

```powershell
Test-Path "H:\shibass-ai\scripts\wire-demucs-for-midi-forge.ps1"   # False
Test-Path "H:\shibass-ai\tools\demucs_wav_hook.py"                # True
```

**משמעות:** ה-ZIP ב-Downloads **ישן** — יש בו `tools\demucs_wav_hook.py` אבל **אין** את קבצי `scripts\` של Demucs. העתקה "הצליחה" אבל לא הביאה את מה שחסר.

**אל תדביק טקסט/markdown ל-PowerShell** — רק פקודות.

---

## פתרון מומלץ (שלב אחד)

### 1) הורד ZIP מחדש

שמור בשם:

`%USERPROFILE%\Downloads\claude-code-local-cursor-shibass-social-studio-c044.zip`

קישור:

`https://github.com/shibass792/claude-code-local/archive/refs/heads/cursor/shibass-social-studio-c044.zip`

### 2) הרץ את המתקין (בודק את ה-ZIP לפני העתקה)

```powershell
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\COPY-ALL-FROM-ZIP.ps1
```

אם ה-ZIP עדיין ישן, תראה `STALE or wrong ZIP` ורשימת קבצים חסרים — **לא** יעתיק כלום.

### 3) אימות

```powershell
Test-Path "H:\shibass-ai\scripts\wire-demucs-for-midi-forge.ps1"
Test-Path "H:\shibass-ai\scripts\start-demucs-pipeline.ps1"
Test-Path "H:\shibass-ai\tools\demucs_wav_hook.py"
```

שלושתם חייבים להיות `True`.

### 4) Demucs

```powershell
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\start-demucs-pipeline.ps1
```

---

## בדיקת ZIP לפני העתקה (ידני)

```powershell
$ZipPath = "$env:USERPROFILE\Downloads\claude-code-local-cursor-shibass-social-studio-c044.zip"
$staging = "$env:TEMP\shibass-zip-check"
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $ZipPath -DestinationPath $staging -Force
$src = (Get-ChildItem $staging -Directory | Select-Object -First 1).FullName
Write-Host "ZIP source folder:" $src
Test-Path (Join-Path $src "scripts\wire-demucs-for-midi-forge.ps1")
Test-Path (Join-Path $src "scripts\start-demucs-pipeline.ps1")
Remove-Item $staging -Recurse -Force
```

אם כאן `False` — ה-ZIP לא מעודכן; הורד מחדש מהקישור למעלה.

---

## העתקה ידנית (רק אם COPY-ALL-FROM-ZIP.ps1 לא קיים)

```powershell
$ZipPath = "$env:USERPROFILE\Downloads\claude-code-local-cursor-shibass-social-studio-c044.zip"
$TargetRoot = "H:\shibass-ai"
$staging = "$env:TEMP\shibass-full-copy"
Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $ZipPath -DestinationPath $staging -Force
$src = (Get-ChildItem $staging -Directory | Select-Object -First 1).FullName
if (-not (Test-Path (Join-Path $src "scripts\wire-demucs-for-midi-forge.ps1"))) {
  Write-Host "STOP: ZIP missing Demucs scripts. Re-download branch ZIP." -ForegroundColor Red
  exit 1
}
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
Test-Path "H:\shibass-ai\tools\script_fix_paths.ps1"
```

אמור לראות `True` שלוש פעמים.

## תיקון script_fix_paths.ps1 (שגיאת $.PSIsContainer)

אם ראית מאות שגיאות `$.PSIsContainer is not recognized` — הקובץ המקומי היה שבור (`$` במקום `$_`).

**אחרי COPY-ALL** מה-ZIP העדכני, הגרסה ב-repo תקינה (אין `$.PSIsContainer`).

תיקון מהיר על הקובץ הישן (בלי ZIP):

```powershell
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\repair-script-fix-paths.ps1
```

או שורה אחת:

```powershell
(Get-Content H:\shibass-ai\tools\script_fix_paths.ps1 -Raw) -replace '\$\.PSIsContainer','$_.PSIsContainer' | Set-Content H:\shibass-ai\tools\script_fix_paths.ps1 -Encoding UTF8
```

הרצה (דוגמה — החלפת נתיב ישן):

```powershell
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\tools\script_fix_paths.ps1 -OldPrefix "D:\shibass-ai" -NewPrefix "H:\shibass-ai" -WhatIf
```

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
