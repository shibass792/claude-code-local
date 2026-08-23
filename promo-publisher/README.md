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
- FFmpeg + NVENC (לשלב הרינדור — חיבור עתידי)
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
| `npm run radar:scan` | סריקת רדאר (CLI) |
| `npm test` | בדיקות מודולים |

## הגדרת API

1. העתק `config/.env.example` ל-`config/.env`
2. מלא `META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`
3. מלא `TIKTOK_CLIENT_KEY`, `TIKTOK_ACCESS_TOKEN`
4. (אופציונלי) `CLOUDFLARE_TUNNEL_TOKEN` או התקן `cloudflared`

ללא טוקנים — המערכת רצה במצב **סימולציה** (mock publish) לבדיקת זרימת האישור.

## שלבים הבאים

1. חיבור מנוע FFmpeg / NVENC הקיים לרינדור תבניות
2. אינטגרציית yt-dlp לסריקת רדאר חיה
3. Ollama לכתיבת הוקים אוטומטית
4. Telegram bot לאישור מהסמארטפון (אופציונלי)

## רישיון

MIT — חלק מפרויקט ShiBass / claude-code-local
