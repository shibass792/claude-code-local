# ShiBass Social Studio v2.0

תוכנת דסקטופ עצמאית (Electron) לניהול תוכן, רדאר מתחרים, ואישור לפני פרסום ל-Instagram / TikTok / Facebook.

## תכונות

- **שער אישור (Human-in-the-Loop)** — כפתור הפרסום נעול עד צפייה בסרטון
- **רדאר אמנים** — זיהוי Viral Outliers (≥2.5x ממוצע צפיות)
- **פרסום רב-ערוצי** — Meta Graph API + TikTok Content Posting API
- **מנהרת HTTPS זמנית** — Cloudflare Tunnel / שרת מקומי לסרטונים
- **Dark UI** — ממשק RTL בעברית

## דרישות

- Node.js 18+
- Windows (מומלץ) או macOS / Linux
- FFmpeg (רינדור 9:16 אמיתי)
- `cloudflared` (אופציונלי, לפרסום Meta מהמחשב)

## התקנה והפעלה

```bash
cd promo-publisher
npm install
cp config/.env.example config/.env
# ערוך config/.env עם טוקנים של Meta / TikTok
npm start
```

Windows: לחיצה כפולה על `START-DESKTOP.cmd`

## מבנה

```
promo-publisher/
├── main.js                 # Electron main process
├── preload.js              # IPC bridge
├── modules/
│   ├── radar.js            # Artist watchlist + outlier scoring
│   ├── approval-publisher.js
│   ├── tunnel.js           # Temporary public URL for Meta
│   └── publishers/
│       ├── meta.js
│       └── tiktok.js
├── ui/                     # Desktop UI
├── config/
│   ├── watchlist.json
│   └── .env.example
└── output/                 # pending_campaigns.json, publish_results.json
```

## פקודות

| פקודה | תיאור |
|--------|--------|
| `npm start` | פתיחת אפליקציית הדסקטופ |
| `npm run api` | שרת HTTP אמיתי על פורט 4052 |
| `npm run radar:scan` | סריקת רדאר (CLI, yt-dlp אם מותקן) |
| `npm test` | בדיקות מודולים + רינדור FFmpeg |

## הגדרת API

1. העתק `config/.env.example` ל-`config/.env`
2. מלא `META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`
3. מלא `TIKTOK_CLIENT_KEY`, `TIKTOK_ACCESS_TOKEN`
4. (אופציונלי) `CLOUDFLARE_TUNNEL_TOKEN` או התקן `cloudflared`

ללא טוקנים — **פרסום נכשל בגלוי**. אין יותר לוג סימולציה שמצליח בלחיצה.

## Studio HTTP API (אמיתי)

```bash
cd promo-publisher
npm run api
# http://127.0.0.1:4052
```

| נתיב | מה הוא עושה באמת |
|------|-------------------|
| `GET /api/engines` | בודק FFmpeg, Ollama, yt-dlp, InstaPy, Meta |
| `POST /api/render` | רינדור 9:16 עם FFmpeg לקובץ MP4 (נכנס לתור אישור, לא מפרסם) |
| `POST /api/render/reel` | אותו רינדור — רקע + טראק, תמיד לתור אישור |
| `POST /api/backgrounds/scan` | סורק JPG/PNG/WEBP מ-`SHIBASS_BG_ROOTS`, Inbox, Downloads, Pictures |
| `GET /api/backgrounds` | אינדקס רקעים אחרון |
| `GET /api/backgrounds/file/:id` | תמונת ממוזערת / קובץ רקע |
| `POST /api/hooks` | Ollama / OpenAI-compatible / metadata engine |
| `POST /api/instagram/session` | Graph API (או InstaPy אם מותקן ו-`INSTAPY_ENABLED=1`) |
| `POST /api/music/scan` | סורק WAV/MP3/MIDI וכותב `output/music_index.json` |
| `GET /api/music/stream/:id` | סטרימינג אמיתי לנגן |
| `GET /api/log` | לוג יצירה מקריאות אמיתיות, לא תבנית |
| `GET /api/catalog` | קטלוג קטעים / עטיפות / ערוצים / FX (בלי FM) |
| `GET /api/db/health` | SQLite חי — `output/studio.db` |
| `POST /api/db/install` | יוצר את מסד ה-SQL ומייבא JSON ישן |
| `GET /api/scan` | סורק זיופי API/MCP וכותב ממצאים ל-SQL |
| `GET /api/mcp/status` | מצב אמיתי של `~/.claude` — בלי הצלחת דמה |

## SQLite מקומי

הסטודיו שומר לוג, קטלוג, תור אישור והיסטוריה ב-`output/studio.db` (Node 22 `node:sqlite`). אין שרת SQL נפרד.

Windows (שורת PowerShell אחת, בלי fence):

```
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\INSTALL-STUDIO-SQL.ps1
```

או מתוך התיקייה:

```
cd promo-publisher
npm run sql:install
npm run api
```

Windows: `START-STUDIO-API.cmd` משורש הריפו.

## שלבים הבאים

1. מלא `config/.env` בטוקני Meta / TikTok לפרסום חי
2. התקן `yt-dlp` לסריקת רדאר חיה
3. הרץ Ollama עם `OLLAMA_MODEL` להוקים
4. Telegram bot לאישור מהסמארטפון (אופציונלי)

## רישיון

MIT — חלק מפרויקט ShiBass / claude-code-local
