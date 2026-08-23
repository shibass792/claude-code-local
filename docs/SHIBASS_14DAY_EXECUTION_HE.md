# 14 יום — טראק **ו**־Pack (24.08 → 06.09.2026)

שני יעדים במקביל. אף אחד לא חוסם את השני.

| יעד | סגירה ביום 14 |
|-----|----------------|
| **טראק** | מאסטרינג + שליחה ל-Audix. בכורה בסוכות 1–2.10. |
| **Producer Pack** | 50 MIDI (Phrygian Family) + 10 Serum + דמו + דף מכירה. מכירה ראשונה / ליסטינג חי. |
| **שיווק** | גל 1 ביום 1, הריגה ביום 4, גל 2 ביום 12, 3 רילס, EPK, 10 מיילי פרומוטרים. |

ShiBass עכשיו: **20.4K IG** @shibassmusic, מעורבות 1.56% (HypeAuditor). ספוטיפיי חודשי: לא נמדד. השלב הבא בסולם: **150–180K** (Captain Hook / Ace Ventura / Blastoyz).

---

## מחר בבוקר — בלי Chrome

```text
H:\shibass-ai\START-DAILY-LINE.cmd
```

מפעיל API :4051 + Transcriber :4340 + גשר 4000 אם ה-IDE כבוי, מייצר **50 MIDI מתוארכים**, מדפיס 42 תאי ספרינט, ופותח **Electron** (לא דפדפן).

| פקודה | מה |
|-------|-----|
| `START-SPRINT.cmd` | דסקטופ + ספרינט / סולם / Ads |
| `START-OPS.cmd` | פרובי HTTP חיים ב-CMD |
| `SHIBASS-MCP.cmd` | MCP stdio מקומי — לא מתקין שרת גלובלי |
| `cd promo-publisher && node cli.js help` | כל הפקודות |

סולם Phrygian Family: בס/קיק נשארים Phrygian. לידים/ארפים ~70% Phrygian, ~25% Dominant, ~5% Locrian. BPM 138–142. תיקייה: `output/psy_pack_v3/YYYY-MM-DD` וגם `H:\shibass-ai\10_OUTPUTS\MIDI_EXPORT\psy_pack_v3\YYYY-MM-DD`.

---

## Wave 1 — אתה מדליק ידנית

20 קמפיינים בחשבון `act_447647440556829`, כולם **PAUSED**, ₪20/יום. ה-IDs ב-`promo-publisher/data/wave1-campaigns.json`.

האפליקציה **לא** קוראת ל-Meta כדי להדליק. אחרי 4 ימים: הורד CSV → `node cli.js ads path\to\export.csv` או כפתור בדסקטופ. כלל הריגה: **CPC > ₪0.30 או 0 LPV**.

---

## EPK מוכן לשליחה

`node cli.js epk` כותב מייל באנגלית (Shaul / ShiBass / Blue Tunes / Dextamine / Zurich YT). למלא ידנית: `[EMAIL] [PHONE] [BEATPORT] [SOUNDCLOUD]`.

יום 2: מייל ל-Blue Tunes — האם הם מטפלים בבוקינג? אם לא — הפניה ל-`booking@fm-booking.com`.

---

## MCP (אופציונלי)

לא מותקן אוטומטית. אם תרצה ב-Cursor:

```json
{
  "mcpServers": {
    "shibass-local": {
      "command": "node",
      "args": ["H:\\shibass-ai\\promo-publisher\\mcp-server.js"]
    }
  }
}
```

---

## Ops

`START-OPS.cmd` / טאב Ops בדסקטופ. אם שירות כבוי — **OFFLINE**. אין תבנית "12/12 ONLINE".

---

```powershell
cd H:\shibass-ai\promo-publisher
node cli.js ops
node cli.js sprint
curl http://127.0.0.1:4051/api/ladder
curl http://127.0.0.1:4051/api/wave1
```
