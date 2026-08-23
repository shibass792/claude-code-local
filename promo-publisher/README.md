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
2. מלא `META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID` לפרסום Reels אמיתי דרך Instagram Graph API
3. מלא `TIKTOK_CLIENT_KEY`, `TIKTOK_ACCESS_TOKEN`
4. (אופציונלי) `CLOUDFLARE_TUNNEL_TOKEN` או התקן `cloudflared`
5. (אופציונלי) `OLLAMA_HOST` / `OLLAMA_MODEL` להוקים חיים. בלי Ollama נוצרים הוקים מקומיים לפי שם הטראק וה-BPM
6. `SHIBASS_MUSIC_ROOTS` לסריקת הנגן

ללא טוקני Meta/TikTok — **אין פרסום מדומה**. הכפתורים קוראים ל-API אמיתי ומחזירים שגיאה חיה.

## API מקומי אמיתי

```bash
cd promo-publisher
npm run api
# http://127.0.0.1:4050
```

| Method | Path | מה באמת קורה |
|--------|------|----------------|
| GET | `/api/health` | בודק FFmpeg, Ollama, Instagram Graph, TikTok, אינדקס נגן |
| POST | `/api/render` | FFmpeg מייצר MP4 9:16 1080x1920 |
| POST | `/api/hooks` | קורא ל-Ollama; אם נפל — fallback מקומי לפי מטא-דאטה |
| GET | `/api/instagram/health` | `GET graph.facebook.com/v21.0/me` |
| POST | `/api/player/scan` | סורק תיקיות אודיו/MIDI וכותב `output/music_index.json` |
| GET | `/api/player/file?id=` | סטרים אמיתי של הקובץ שנסרק |
| POST | `/api/create-campaign` | רינדור + הוקים + כניסה לתור אישור |

Instagram משתמש ב-**Graph API הרשמי** לפרסום Reels. אין Selenium / InstaPy scraping.

## שלבים הבאים

1. yt-dlp לסריקת רדאר חיה (כרגע מסומן `source: sample` אם אין סריקה)
2. Telegram bot לאישור מהסמארטפון (אופציונלי)

## רישיון

MIT — חלק מפרויקט ShiBass / claude-code-local
