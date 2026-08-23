# התקנת כל המערכת + כל התיקונים (Windows)

נתיב אחד ל־`H:\shibass-ai`: Social Studio, API חי (סריקה / רנדור / Hooks), Demucs, ומסמכים.

**ענף עם התיקונים:** `cursor/real-apis-instapy-player-87eb`  
(לא הענף הישן `c044` לבד.)

---

## התקנה / עדכון (פקודה אחת)

ב־PowerShell:

```powershell
irm https://raw.githubusercontent.com/shibass792/claude-code-local/cursor/real-apis-instapy-player-87eb/INSTALL-SHIBASS-UPDATES.ps1 -OutFile $env:TEMP\INSTALL-SHIBASS-UPDATES.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\INSTALL-SHIBASS-UPDATES.ps1 -TargetRoot H:\shibass-ai
```

או הורד ZIP ואז הרץ `INSTALL-ALL-SHIBASS.cmd` מתוך התיקייה שנפתחה:

ZIP:  
https://github.com/shibass792/claude-code-local/archive/refs/heads/cursor/real-apis-instapy-player-87eb.zip

---

## הפעלה

מחר בבוקר (פס ייצור + Pack):

```text
H:\shibass-ai\START-DAILY-LINE.cmd
```

יעד 14 יום: `docs\SHIBASS_14DAY_EXECUTION_HE.md`

Social + API:

```text
H:\shibass-ai\START-ALL-SHIBASS.cmd
```

פותח:

1. **Studio API** — http://127.0.0.1:4051/ (סריקת מדיה, רנדור 9:16, hooks)
2. **Social Studio** (Electron)

API בלבד:

```text
H:\shibass-ai\promo-publisher\START-API.cmd
```

Demucs:

```powershell
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\start-demucs-pipeline.ps1
```

סטאק מלא (IDE / Panel / Memory + Studio API):

```powershell
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\start-shibass-stack.ps1 -IncludeStudioApi
```

---

## אימות אחרי התקנה

```powershell
Test-Path H:\shibass-ai\promo-publisher\api-server.js
Test-Path H:\shibass-ai\promo-publisher\modules\render-engine.js
Test-Path H:\shibass-ai\scripts\wire-demucs-for-midi-forge.ps1
Test-Path H:\shibass-ai\tools\demucs_wav_hook.py
```

ארבעתם חייבים להיות `True`.

---

## מה כלול בתיקונים

| רכיב | מצב |
|------|-----|
| סריקת מדיה / ספרייה | API חי |
| רנדור Reel (FFmpeg 9:16) | API חי |
| Viral hooks | Ollama אם זמין, אחרת תבניות מסומנות |
| Instagram publish | Meta Graph בלבד (עם טוקן); בלי טוקן — dry-run מודע |
| InstaPy / Selenium | **מושבת** (ToS) |
| Demucs / MIDI Forge | סקריפטים + hooks |

---

## אם משהו חסר

אל תשתמש ב־ZIP ישן מ־Downloads. הורד מחדש מהענף למעלה, או הרץ שוב את פקודת `INSTALL-SHIBASS-UPDATES.ps1`.
