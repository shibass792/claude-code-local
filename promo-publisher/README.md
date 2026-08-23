# ShiBass Social Studio v2.0

תוכנת דסקטופ עצמאית (Electron) לניהול תוכן, רדאר מתחרים, ואישור לפני פרסום ל-Instagram / TikTok / Facebook.

## תכונות

- **שער אישור (Human-in-the-Loop)** — כפתור הפרסום נעול עד צפייה בסרטון
- **רדאר אמנים** — זיהוי Viral Outliers (≥2.5x ממוצע צפיות)
- **פרסום רב-ערוצי** — Meta Graph API + TikTok Content Posting API (ללא mock-success)
- **מנועי יצירה אמיתיים** — לוג JSONL, FFmpeg 9:16, ReelHook (Ollama), נגן עם סריקת קבצים
- **Instagram Graph בלבד** — אין InstaPy/Selenium; סטטוס חי ל-graph.facebook.com
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
# או API בלבד בדפדפן:
npm run api
# ואז http://127.0.0.1:4051
```

Windows: `START-DESKTOP.cmd` או `START-ENGINES-API.cmd`

## מבנה

```
promo-publisher/
├── main.js                 # Electron main process
├── preload.js              # IPC bridge
├── modules/
│   ├── radar.js
│   ├── approval-publisher.js
│   ├── api-router.js       # HTTP /api/* for every engine button
│   ├── engines/            # log, Graph, FFmpeg, ReelHook, player
│   ├── tunnel.js
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
| `npm start` | דסקטופ + Engines API על 4051 |
| `npm run api` | שרת HTTP בלבד (`http://127.0.0.1:4051`) |
| `npm run radar:scan` | סריקת רדאר (CLI) |
| `npm test` | בדיקות מודולים + רינדור FFmpeg |

## הגדרת API

1. העתק `config/.env.example` ל-`config/.env`
2. מלא `META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`
3. מלא `TIKTOK_CLIENT_KEY`, `TIKTOK_ACCESS_TOKEN`
4. (אופציונלי) `CLOUDFLARE_TUNNEL_TOKEN` או התקן `cloudflared`

ללא טוקנים — קריאות Instagram/TikTok/Facebook **נכשלות במפורש**. אין לוג הצלחה מזויף.

Instagram משתמש ב-Graph API הרשמי בלבד. InstaPy/Selenium (לייק/פולו אוטומטי) לא מיושם.

## שלבים הבאים

1. אינטגרציית yt-dlp לסריקת רדאר חיה
2. Telegram bot לאישור מהסמארטפון (אופציונלי)

## רישיון

MIT — חלק מפרויקט ShiBass / claude-code-local
