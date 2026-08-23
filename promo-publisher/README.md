# ShiBass Social Studio v2.1 — Live APIs

תוכנת דסקטופ (Electron) + **HTTP API** לניהול תוכן, רינדור 9:16, Universal Player, ואישור לפני פרסום.

## מה חדש (בלי סימולטור)

| כפתור / זרימה | API אמיתי |
|----------------|-----------|
| בדיקת מנועים | `GET /api/health` — FFmpeg / Ollama / Meta / TikTok / Media Index |
| הפקת הוקים | `POST /api/hooks/generate` — Ollama חי, או תבניות מקומיות **מסומנות** |
| רנדר 9:16 | `POST /api/render/reel` — FFmpeg אמיתי → `output/reels/*.mp4` |
| סריקת מדיה | `POST /api/media/scan` + Universal Player stream |
| יצירה לתור | `POST /api/create/campaign` |
| Instagram | **Meta Graph API בלבד** (InstaPy/Selenium חסומים במדיניות) |

## הפעלה מהירה (API + UI בדפדפן)

```bash
cd promo-publisher
npm install
npm run api
# http://127.0.0.1:4051/
```

Windows: `START-API.cmd`

## דסקטופ Electron

```bash
npm start
```

או `START-DESKTOP.cmd`

## משתני סביבה

העתק `config/.env.example` → `config/.env`:

- `META_ACCESS_TOKEN`, `META_IG_USER_ID`, `META_PAGE_ID` — פרסום Instagram/Facebook אמיתי
- `TIKTOK_ACCESS_TOKEN` — TikTok Content Posting API
- `OLLAMA_URL`, `OLLAMA_MODEL` — ReelHook AI
- `SHIBASS_MEDIA_ROOTS` — שורשי סריקה (מופרדים ב-`;` ב-Windows / `:` ב-Unix)
- `SHIBASS_API_PORT` — ברירת מחדל `4051`

ללא טוקני Meta/TikTok — **פרסום** נשאר dry-run/mock (מודע). רינדור, סריקה והוקים הם חיים גם בלי טוקנים.

## מדיניות Instagram

InstaPy / Selenium botting **לא נתמך** (ToS). הפרסום עובר רק דרך Meta Content Publishing API עם טוקנים ב-`.env`.

## בדיקות

```bash
npm test
npm run lint
```

## מבנה

```
promo-publisher/
├── api-server.js           # HTTP API + web/studio UI
├── web/studio.html         # Universal Player + live creation log
├── modules/
│   ├── media-library.js
│   ├── render-engine.js
│   ├── hook-generator.js
│   ├── engines.js
│   ├── campaign-factory.js
│   └── publishers/meta.js  # Graph API
└── fixtures/media/         # WAV/MIDI לבדיקות
```
