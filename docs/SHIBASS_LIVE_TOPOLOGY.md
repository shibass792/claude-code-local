# ShiBass Live Topology — מסמך מסונכרן מהמערכת שלך

> מקור: `sb-service-status`, `sb-port-map`, `service-registry`, `shibass_master_manifest`, `DIAGNOSTICS.md`  
> תאריך snapshot: **2026-08-23**

## תיקון חשוב לעומת הניחוי הקודם

| מה חשבנו | מה באמת אצלך |
|----------|----------------|
| 4050 = Stem Groove | **4050 = Promo Publisher** (HTTP 200) |
| 8765 = MIDI stub | **8765 = ShiBass Master Server** (HTTP 200) |
| שרת מרכזי 8787 | **4000 = ShiBass AI IDE** (142+ דפי HTML) |
| זיכרון רק 8792 | **גם 4495 = Index Memory Engine** (+ 8792 Shared Memory) |
| Sound-DNA על 4781 | **4781 = פורטל / All-Brain** · worker על **4786** |

---

## Tier 1 — רץ ונבדק (sb-service-status)

| פורט | שירות | סטטוס |
|------|--------|--------|
| 4000 | ShiBass AI IDE | HTTP 200 |
| 4050 | Promo Publisher | HTTP 200 |
| 4555 | Launch Factory | HTTP 200 |
| 4870 | Release Distribution Studio | HTTP 200 |
| 4899 | Edit Studio | HTTP 200 |
| 4900 | Publishing Board | HTTP 200 |
| 8016 | ACE-Step | HTTP 200 |
| 3005 | Local Data Engine | HTTP 200 |
| 4100 | Hub Ports (Audio-to-MIDI) | HTTP 200 |
| 4320 | ShiBass Music OS | HTTP 200 |
| 4297 | Release Audit Center | HTTP 200 |
| 4781 | Sound-DNA / All-Connected Brain | HTTP 200 |
| 7777 | Control Panel | HTTP 200 |
| 8765 | ShiBass Master Server | HTTP 200 |
| 8015 | Full Audio Worker (Demucs) | HTTP 200 |
| 5100 | Promo Publisher proxy | HTTP 200 |
| 5200 | Local-AI Gate | HTTP 200 |
| 8000 | Static Panels | HTTP 200 |

**מאזין אבל non-200:** 4860 Academy, 4296 Producer Brain DB, 4782 All-Connected Brain

---

## Tier 2 — מנוהל דרך service-registry (פאנל)

| פורט | שירות | startCommand |
|------|--------|--------------|
| 4000 | Main Server | `node server.js` @ `H:\shibass-ai` |
| 3080 | DSH DeepSeek Harness | dsh-runtime |
| 11434 | Ollama | `ollama serve` |
| 4192 | SB Intelligence Hub | `H:\shibass-ai\sb-intelligence-hub` |
| 4495 | Index Memory Engine | `SHIBASS_INDEX_MEMORY_ENGINE` → `/docs` |
| 4786 | Sound-DNA worker | `sound_dna_server.py --port 4786` |
| 5678 | n8n | `n8n start` (2–4 דקות ראשונה) |

---

## טווח שמור — אל תיגע בלי בדיקה

**8788–8859** — Synth Studio, VST Host, Port Keeper  
קרא תמיד: `H:\shibass-ai\07_LOGS\port_status.json`

| פורט | שימוש |
|------|--------|
| 8788 | Synth Studio (Antigravity FastAPI) |
| 8791 | music_brain / S1 player |
| 8850–8859 | VST Host (pedalboard) |
| 8849 | Port Keeper mutex |

---

## נכסים קריטיים (manifest + diagnostics)

- **DB:** `H:\shibass-ai\shibass.db` — 37.5 MB, 8,948 קבצים, 7,860 MIDI
- **ספרייה:** 5,505 פריטים · 803 presets · Serum 1,616
- **Cubase 15 Pro** — templates ב-`H:\ShiBass_Cubase_Projects\Audix_Templates`
- **Demucs CUDA** — worker על `10_OUTPUTS\MIDI_EXPORT`
- **רilisense:** Audix Record Label · ShiBass signed

---

## 3 בעיות ארגון עיקריות (לפי הקבצים)

### 1. בלגן פורטים ב-HTML
`sb-port-map` מצא **60+ פורטים** ב-142+ קבצי HTML. רבים מסומנים `legacy / unknown`.  
**פתרון:** מקור אמת אחד → `scripts/config/shibass-ports.json` + refactor הדרגתי של hardcoded URLs.

### 2. שני מנועי זיכרון
- **4495** — Index Memory Engine (FastAPI `/docs`)
- **8792** — Shared Memory API (facts)

אל תמזג — תגדיר **תפקיד לכל אחד** ב-manifest.

### 3. Promo כפול
- **4050** — Promo Publisher web (כבר רץ)
- **5100** — proxy
- **promo-publisher/** — Electron Social Studio (repo) — **שכבת אישור**, לא מחליף את 4050

---

## סדר עבודה מומלץ (מעודכן)

```
1. shibass-doctor.ps1          ← בדיקה
2. העתק config → H:\shibass-ai\config\
3. אל תיגע ב-8765 / 4050 / 4781
4. Social Studio Electron      ← npm start (אישור לפני פרסום)
5. watch-social-inbox.ps1      ← Demucs → תור אישור
6. נקה ~90 Task Scheduler + 27 Startup shortcuts (DIAGNOSTICS §6)
7. VS Build Tools (admin)        ← sphere-vst אם רוצה VST3
```

---

## קבצי config ב-repo

| קובץ | תפקיד |
|------|--------|
| `scripts/config/shibass-ports.json` | מפת פורטים + נתיבים |
| `scripts/config/shibass-service-registry.json` | פקודות start לפאנל |
| `docs/SHIBASS_SYSTEM_MAP.md` | מדריך ארגון כללי |
