# ShiBass Social Studio v2.1

תוכנת דסקטופ עצמאית (Electron) לניהול תוכן, רדאר מתחרים, רינדור סרטונים ואישור לפני פרסום ל-Instagram / TikTok / Facebook.

**כל מנוע בתוכנה מחובר ל-API או לכלי אמיתי.** אין לוג-תבנית ואין תוכן מומצא: אם מנוע לא זמין, התוכנה אומרת זאת במקום להציג הצלחה מדומה.

## המנועים האמיתיים

| יכולת | מה מריץ אותה בפועל | קובץ |
|--------|---------------------|------|
| הוקים וכיתובים | מודל מקומי — Ollama `POST /api/chat`, או כל נקודת קצה תואמת OpenAI | `modules/ai.js`, `modules/hooks.js` |
| רינדור וידאו 9:16 | `ffprobe` + `ffmpeg` — פלט 1080x1920 עם ויזואליזציה מהאודיו וכתוביות libass | `modules/renderer.js` |
| אינדקס מוזיקה | סריקת דיסק אמיתית + קריאת תגיות ב-`ffprobe`, עם מטמון לפי mtime | `modules/library.js` |
| רדאר מתחרים | `yt-dlp` — מטא-דאטה של פוסטים אחרונים, חריגה מול החציון האמיתי של האמן | `modules/radar.js` |
| פרסום ל-IG / FB | Meta Graph API — יצירת container, המתנה ל-`status_code=FINISHED`, פרסום, שליפת permalink | `modules/publishers/meta.js` |
| פרסום ל-TikTok | TikTok Content Posting API — init, מעקב `status/fetch`, קישור לפוסט | `modules/publishers/tiktok.js` |
| כתובת ציבורית לקובץ | שרת מקומי + Cloudflare Tunnel | `modules/tunnel.js` |

## תכונות

- **שער אישור (Human-in-the-Loop)** — כפתור הפרסום נעול עד צפייה בסרטון
- **לוג מנוע חי** — כל שורה נכתבת מפעולה שהרצה עכשיו (רינדור, קריאת מודל, סריקה, פרסום)
- **רדאר אמנים** — זיהוי Viral Outliers מול החציון האמיתי של כל אמן
- **הפקה מקובץ אודיו** — בחירת טראק ← רינדור אמיתי ← כיתובים מהמודל ← תור אישור
- **Dark UI** — ממשק RTL בעברית

## דרישות

- Node.js 18+
- Windows (מומלץ) או macOS / Linux
- **FFmpeg + FFprobe** — חובה לרינדור (NVENC נבחר אוטומטית אם באמת עובד)
- **Ollama** או נקודת קצה תואמת OpenAI — חובה להוקים וכיתובים
- **yt-dlp** — חובה לרדאר (`pip install -U yt-dlp`)
- `cloudflared` — חובה לפרסום, כי הרשתות מורידות את הקובץ מהאינטרנט

## התקנה והפעלה

```bash
cd promo-publisher
npm install
cp config/.env.example config/.env
# ערוך config/.env — ראה "הגדרת API" למטה
npm run doctor      # מציג מה באמת מחובר ומה חסר
npm start
```

Windows: לחיצה כפולה על `START-DESKTOP.cmd`

## פקודות

| פקודה | תיאור |
|--------|--------|
| `npm start` | פתיחת אפליקציית הדסקטופ |
| `npm run doctor` | בדיקת כל האינטגרציות; `-- --verify` שורף קריאת API אמיתית לכל פלטפורמה |
| `npm run render:reel <file>` | רינדור אמיתי מה-CLI (`--style`, `--duration`, `--start`, `--hook`, `--campaign`) |
| `npm run library:scan` | סריקת ספריית המוזיקה וכתיבת האינדקס |
| `npm run radar:scan` | סריקת רדאר דרך yt-dlp |
| `npm run import:social` | ייבוא סרטונים מתיקיית inbox לתור האישור |
| `npm test` | 82 בדיקות, כולל רינדור ffmpeg אמיתי |
| `npm run lint` | בדיקת תחביר לכל קבצי ה-JS |

## הגדרת API

1. העתק `config/.env.example` ל-`config/.env` — הקובץ מתעד כל משתנה.
2. **AI**: הרם Ollama (`ollama serve`) והורד מודל (`ollama pull llama3.1`). אם `OLLAMA_MODEL` ריק, נבחר המודל הראשון שהמנוע מדווח עליו.
3. **מוזיקה**: הגדר `MUSIC_ROOTS` לתיקיות הטראקים והסאמפלים.
4. **רדאר**: התקן yt-dlp. אינסטגרם וטיקטוק דורשים session — הגדר `YTDLP_COOKIES_FILE` או `YTDLP_COOKIES_FROM_BROWSER`.
5. **Meta**: מלא `META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`.
6. **TikTok**: מלא `TIKTOK_CLIENT_KEY`, `TIKTOK_ACCESS_TOKEN`. `TIKTOK_PUBLISH_MODE=draft` מעלה לטיוטות; `direct` מפרסם ודורש אפליקציה מאושרת.
7. **מנהרה**: התקן `cloudflared` או הגדר `CLOUDFLARE_TUNNEL_TOKEN`.

### מה קורה כשמנוע חסר

| מצב | התנהגות |
|------|----------|
| המודל לא זמין | כפתורי ההוקים מחזירים שגיאה מדויקת; רינדור עדיין עובד ו-`aiError` נרשם על הקמפיין |
| ffmpeg חסר | הרינדור נכשל עם ה-stderr של ffmpeg — אין "SUCCESS" מדומה |
| yt-dlp חסר או ללא cookies | הרדאר מחזיר `source: "none"` עם אזהרה ורשימת שגיאות לכל מקור |
| טוקנים חסרים | הפרסום נכשל ומדווח איזו פלטפורמה ולמה. אין קישורים מומצאים |
| אין `cloudflared` | הפרסום נעצר לפני קריאת ה-API, כי Meta לא יכולה להוריד מ-127.0.0.1 |
| `PUBLISH_DRY_RUN=1` | כל הזרימה נבדקת בלי קריאת API; מסומן "הרצה יבשה" ולא מנקה את התור |

`RADAR_ALLOW_SAMPLE=1` הוא הדרך היחידה לקבל פיד דוגמה, והוא מסומן תמיד כ-`sample` ב-UI.

## מבנה

```
promo-publisher/
├── main.js                     # Electron main + IPC
├── preload.js                  # גשר IPC
├── modules/
│   ├── ai.js                   # לקוח LLM מקומי
│   ├── hooks.js                # הוקים, כיתובים, האשטאגים
│   ├── renderer.js             # ffprobe + ffmpeg 1080x1920
│   ├── library.js              # אינדקס מוזיקה
│   ├── radar.js                # סריקת yt-dlp
│   ├── approval-publisher.js   # תור אישור + פרסום
│   ├── tunnel.js               # כתובת ציבורית זמנית
│   ├── store.js                # קריאה/כתיבה של JSON
│   └── publishers/
│       ├── meta.js
│       └── tiktok.js
├── scripts/                    # doctor, render-reel, scan-library, lint, import
├── tests/                      # 82 בדיקות
├── ui/                         # ממשק דסקטופ + לוג חי
├── config/
│   ├── watchlist.json
│   └── .env.example
└── output/                     # renders/, pending_campaigns.json, radar_feed.json,
                                # music_index.json, publish_results.json
```

## רישיון

MIT — חלק מפרויקט ShiBass / claude-code-local
