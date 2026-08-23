# ShiBass Social Studio v2.0

תוכנת דסקטופ עצמאית (Electron) לניהול תוכן, רדאר מתחרים, ואישור לפני פרסום ל-Instagram / TikTok / Facebook.

## תכונות

- **שער אישור (Human-in-the-Loop)** — כפתור הפרסום נעול עד צפייה בסרטון
- **רדאר אמנים** — זיהוי Viral Outliers (≥2.5x ממוצע צפיות)
- **פרסום רב-ערוצי** — Instagram Graph API רשמי + TikTok Content Posting API (בלי InstaPy / Selenium)
- **רינדור 9:16 חי** — FFmpeg (1080×1920) + כתוביות SRT
- **ReelHook** — קריאה אמיתית ל-Ollama (`/api/generate`)
- **נגן אוניברסלי** — סריקת דיסק ואינדקס קבצים
- **לוג יצירה חי** — כל שורה נכתבת ממנוע אמיתי, לא תבנית
- **מנהרת HTTPS זמנית** — Cloudflare Tunnel / שרת מקומי לסרטונים
- **Dark UI** — ממשק RTL בעברית

## דרישות

- Node.js 18+
- Windows (מומלץ) או macOS / Linux
- FFmpeg (חובה לרינדור 9:16)
- Ollama מקומי (חובה להוקים חיים)
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
│   ├── api-server.js       # HTTP API :17891
│   ├── creation-log.js     # Live engine log
│   ├── radar.js            # yt-dlp live scan + fallback sample
│   ├── approval-publisher.js
│   ├── tunnel.js           # Temporary public URL for Meta
│   ├── engines/            # Ollama, FFmpeg, Graph, library index
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
| `npm run api` | שרת HTTP חי על `:17891` |
| `npm run radar:scan` | סריקת רדאר (yt-dlp) |
| `npm test` | בדיקות מודולים |

## הגדרת API

1. העתק `config/.env.example` ל-`config/.env`
2. מלא `META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`
3. מלא `TIKTOK_CLIENT_KEY`, `TIKTOK_ACCESS_TOKEN`
4. (אופציונלי) `CLOUDFLARE_TUNNEL_TOKEN` או התקן `cloudflared`

ללא טוקנים / FFmpeg / Ollama הפעולה **נכשלת עם שגיאה אמיתית** — אין יותר פרסום מדומה.

InstaPy / Selenium לא מחוברים בכוונה: פרסום לאינסטגרם עובר רק ב-Graph API הרשמי.

## שלבים הבאים

1. Telegram bot לאישור מהסמארטפון (אופציונלי)
2. Whisper CLI לכתוביות מדויקות אם מותקן locally

## רישיון

MIT — חלק מפרויקט ShiBass / claude-code-local
