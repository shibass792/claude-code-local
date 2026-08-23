# ShiBass Social Studio

Standalone **desktop** app (Electron) for organic growth on Instagram, TikTok, and Facebook — local-first, zero ad spend, human approval before every post.

## What it does

1. **Artist & Trend Radar** — watches a local artist list, scores posts by outlier views (`views / artist avg`), and surfaces winning hooks/styles.
2. **Idea Remix** — turns a viral structure into a ShiBass draft campaign (template + captions).
3. **Approval Gateway** — embedded 9:16 preview, caption edit, platform toggles. Publish stays locked until the clip is watched once.
4. **Publisher (dry-run)** — records publish intent + mock public media URL (placeholder for Cloudflare Tunnel / Meta / TikTok APIs).

## Quick start (Windows)

```bat
launchers\ShiBass-Social-Studio.cmd
```

Or:

```bat
cd social-studio
npm install
npm start
```

## Tests

```bat
cd social-studio
npm test
npm run lint:syntax
npm run radar:scan
```

## Layout

```
social-studio/
├── main.js                 # Electron main process + IPC
├── preload.js              # contextBridge API
├── modules/
│   ├── radar.js            # outlier scoring + watchlist
│   ├── approval-publisher.js
│   └── campaign-factory.js
├── ui/                     # desktop chrome (not a browser workflow)
├── data/                   # watchlist + viral feed (local JSON)
└── output/                 # pending queue, publish results (gitignored runtime)
```

## Human-in-the-loop rules

- Status machine: `PENDING_APPROVAL` → `PUBLISHED` | `REJECTED`
- `publishCampaign` throws if `watchedOnce` is false
- Real network tokens are **not** required for dry-run; connection panel shows setup status

## Next wiring (not in this PR)

- Cloudflare Tunnel / ngrok for Meta Graph video URL
- Meta + TikTok OAuth token refresh (`config/tokens.enc`)
- FFmpeg / NVENC render templates (spectrum, PIP, kinetic captions)
- Optional Telegram approval mirror

## Brand note

UI tokens match ShiBass Music Brain (cyan on deep navy, Orbitron / Rajdhani) — not a generic purple dashboard.
