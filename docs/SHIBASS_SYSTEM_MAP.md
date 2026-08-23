# ShiBass System Map — ארגון, שיפור והגדלה

מסמך ייחוס למה שרץ היום על `H:\shibass-ai` ואיך לסדר את זה לעבודה יומית.

## מה יש היום (לפי מה שרץ אצלך)

| רכיב | נתיב / תהליך | פורט | סטטוס |
|------|----------------|------|--------|
| **AI Panel** | `H:\shibass-ai-panel` → `server.js` | **8787** | עובד (Ollama + Brain) |
| **Memory API** | `SHIBASS_SHARED_MEMORY\tools\shibass_memory_api.py` | **8792** | רץ; WinError 10053 = לקוח ניתק (רעש) |
| **Stem Groove** | `node app/server.js` (מתוך stem-groove) | **4050** | ⚠️ **4050 אצלך = Promo Publisher** — לא Stem Groove |
| **Promo Publisher (web)** | `H:\shibass-ai` server | **4050** | HTTP 200 — כבר רץ |
| **ShiBass Master Server** | master stack | **8765** | HTTP 200 — **אל תשים MIDI stub כאן** |
| **Main AI IDE** | `node server.js` @ root | **4000** | 142+ HTML panels |
| **Audio worker + Demucs** | מנטר `10_OUTPUTS\MIDI_EXPORT` | — | עובד `[cuda] test30.wav` |
| **ShiBass Brain** | `SHIBASS_BRAIN\` + `H:\models\shibass-brain\` | — | Phase 1 |
| **Ollama** | `http://127.0.0.1:11434` | **11434** | בסיס ל-AI |
| **Social Studio** | `promo-publisher\` (Electron) | — | ב-repo; לא מותקן עדיין ב-H: |
| **MIDI server** | `synths_midi_server.py` | ? | **חסר** ב-`H:\shibass-ai\` — batch שבור |

## בעיות שזיהינו

1. **עותקים כפולים** — `.install-staging\stem-groove-*` (עשרות גרסאות); לא ברור איזה “חי”.
2. **קבצי `.cmd` שבורים** — `'cho'`, `'/d'`, `'MIDI'` = קידוד/CRLF שגוי.
3. **Python מפוזר** — 312 vs 314; נתיבים שונים ב-batch.
4. **אין מקור אמת לפורטים** — 8787 / 8792 / 4050 / 11434 לא מתועדים במקום אחד.
5. **אין launcher אחד** — כל שירות נפתח ידנית.
6. **קבצים חסרים** — `synths_midi_server.py` בשורש H:.

---

## מבנה יעד מומלץ (Local-First)

```
H:\shibass-ai\
├── 00_INBOX\                 # WAV/MP3 חדשים מהאולפן
├── 10_OUTPUTS\
│   ├── MIDI_EXPORT\          # ← worker + demucs (קיים)
│   ├── stems\
│   └── social\                 # רינדורים ל-promo-publisher
├── config\
│   ├── ports.json              # כל הפורטים במקום אחד
│   └── .env                    # טוקנים Meta/TikTok (לא ב-git)
├── logs\                       # לוגים מרוכזים
├── SHIBASS_BRAIN\              # זיכרון + facts
├── SHIBASS_SHARED_MEMORY\      # Memory API
├── shibass-ai-panel\           # או symlink ל-H:\shibass-ai-panel
├── stem-groove\                # עותק יחיד “production”
├── promo-publisher\            # Social Studio
├── tools\                      # synths_midi_server.py, workers
├── .install-staging\           # רק ארכיון — לא להריץ מכאן
├── scripts\
│   ├── start-shibass-stack.ps1 # launcher מרוכז
│   ├── shibass-doctor.ps1      # בדיקת בריאות
│   ├── watch-social-inbox.ps1  # Demucs/render → תור אישור
│   └── fix-windows-batch.ps1   # תיקון .cmd שבורים
└── tools\synths_midi_server.py # stub MIDI (8765)
```

---

## סדר עדיפויות (מה לעשות קודם)

### שלב A — ייצוב (1–2 שעות)

1. **הרץ Doctor** — `scripts/shibass-doctor.ps1` (ראה repo).
2. **בחר עותק Stem Groove אחד** — העתק מ-`.install-staging\...\stem-groove-XXXX` ל-`H:\shibass-ai\stem-groove\`.
3. **תקן batch** — CRLF + UTF-8 ללא BOM; נתיב מלא ל-Python.
4. **שחזר / העבר** `synths_midi_server.py` ל-`H:\shibass-ai\tools\`.
5. **צור `config\ports.json`** — רשימת שירותים (template ב-repo).

### שלב B — חיבור (יום–יומיים)

1. **Launcher אחד** — `start-shibass.ps1`: Ollama → Brain → Panel 8787 → Memory 8792.
2. **Patch Memory API** — התעלמות מ-`ConnectionAbortedError` (לקוח ניתק).
3. **Social Studio** — `git clone` / העתק `promo-publisher`, `npm install`, `npm start`.
4. **קישור pipeline** — Demucs output → תיקיית `10_OUTPUTS\social\` → תור אישור.

### שלב C — הגדלה (0$ organic)

1. **רדאר אמנים** — `npm run radar:scan` ב-promo-publisher.
2. **FFmpeg/NVENC** — רינדור Reels מתוך stems.
3. **yt-dlp** — סריקת טרנדים חיה (במקום mock).
4. **yt index** — `knowledge-from-drives.ps1 -RefreshIndex` פעם בשבוע.

---

## מפת פורטים (מקור אמת)

| פורט | שירות | בדיקה |
|------|--------|--------|
| 11434 | Ollama | `curl http://127.0.0.1:11434/api/tags` |
| 8787 | AI Panel | `http://127.0.0.1:8787/api/status` |
| 8792 | Memory API | `http://127.0.0.1:8792/` |
| 4000 | ShiBass AI IDE | `curl http://127.0.0.1:4000/api/ops/health` |
| 4050 | Promo Publisher (web) | `http://127.0.0.1:4050/` |
| 4495 | Index Memory Engine | `http://127.0.0.1:4495/docs` |
| 4781 | Sound-DNA portal | `http://127.0.0.1:4781/` |
| 4786 | Sound-DNA worker | `http://127.0.0.1:4786/` |
| 8015 | Audio Worker (Demucs) | `http://127.0.0.1:8015/` |
| 8765 | Master Server | `http://127.0.0.1:8765/` |
| 17890 | מנהרת מדיה (זמני) | רק בעת פרסום Meta |
| 8765 | Master Server (לא MIDI!) | `http://127.0.0.1:8765/` |
| 8877 | MIDI stub (dev only) | `http://127.0.0.1:8877/health` |

---

## Agent / Build — איך זה מתחבר

`/build-agent` (Cloudflare) **לא** מחליף את ה-stack המקומי. ל-ShiBass עדיף:

- **Orchestrator מקומי** = `start-shibass.ps1` + `ports.json` + Doctor
- **זיכרון** = Brain + Memory API + facts.jsonl
- **כלים** = panel API, demucs worker, promo-publisher IPC
- **אישור אנושי** = Social Studio (לא פרסום אוטומטי)

אם תרצה agent בענן בעתיד — רק לת/tasks שלא דורשים GPU/DAW (למשל כתיבת captions), לא ל-Demucs.

---

## פקודות יומיות

```powershell
# בדיקת כל המערכת
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\shibass-doctor.ps1

# הפעלת stack AI (panel + brain)
powershell -ExecutionPolicy Bypass -File H:\models\start-shibass.ps1

# Social Studio (אחרי התקנה)
cd H:\shibass-ai\promo-publisher
npm start

# סריקת רדאר
npm run radar:scan
```

---

ראה גם **`docs/SHIBASS_LIVE_TOPOLOGY.md`** — מסונכרן מהקבצים שהעלית (sb-port-map, service-status).

| Branch | תוכן |
|--------|------|
| `cursor/shibass-ai-panel-f785` | Panel + Brain + start-shibass |
| `cursor/shibass-social-studio-c044` | promo-publisher Electron |
| `main` | claude-code-local (Mac AI) |

---

## כללים לסוכנים עתידיים

1. פקודות PowerShell בלבד בטרמinal — לא markdown בעברית.
2. `.ps1` / `.cmd` — **CRLF + UTF-8 BOM** ל-Windows 5.1.
3. פורט אחד = שירות אחד; עדכון רק ב-`ports.json`.
4. לא להריץ מ-`.install-staging` — רק מ-production folder.
5. סודות רק ב-`config\.env` — לא ב-facts/brain.
