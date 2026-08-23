# 14 יום — ביצוע (לא עוד תוכנית)

**יעד יחיד:** לסיים ולמכור **ShiBass Producer Pack v1** (בנק MIDI + מקום לפריסטי Serum) דרך Audix.  
טראק מקורי רץ בבוקר כשגרה, אבל **לא** חוסם את הכסף.

למה Pack ולא טראק: אפשר לסגור מלאי ממחר בלי לחכות לדרופ מושלם. הטראק עדיין נבנה מאותם MIDI.

---

## מחר בבוקר (45 דקות)

```text
H:\shibass-ai\START-DAILY-LINE.cmd
```

זה מפעיל:

| פורט | שירות |
|------|--------|
| **4051** | Studio + ספרייה + psy_pack + Pack + EPK |
| **4340** | Transcriber → `guide_he.md` |
| **4000** | גשר ספרייה **רק אם** ה-IDE לא רץ (מתקן `API 4000 not reachable`) |

ואז מייצר 10 קבצי MIDI בסולם **E Phrygian / 142 BPM**.

1. Cubase / Ableton — תבנית Audix.  
2. גרור MIDI ל־Serum / Sylenth1.  
3. 15 דקות Kick & Bass.  
4. בזמן עבודה: הדבק נקודות ממדריך Backbone/מיקס בשדה המדריך ב־Studio → `guide_he.md`.

ספרייה: פתח **http://127.0.0.1:4051/** — לא תלוי ב־IDE 4000.

---

## ימי 1–4 — מלאי

- כל בוקר: `START-DAILY-LINE.cmd` (10 MIDI חדשים).  
- שמור 3–8 פריסטי Serum הכי טובים לתיקייה שה-Pack יוצר (`Serum_Presets`).  
- ב־Studio לחץ **ארוז Producer Pack** (50 MIDI + ZIP).

## ימי 5–8 — מוצר

- README + מחיר בדיקה **$19–29**.  
- העלה ל־Audix / Bandcamp / Gumroad.  
- ריל אחד: “קוד מייצר MIDI → Cubase מנגן דרופ” (מסך 4K).

## ימי 9–14 — הופעות + מכירה

- **EPK + אימייל** ב־Studio (כולל Shiva Mangala).  
- 10 פרומוטרים / מועדונים — אותו מכתב, תאריך פנוי.  
- כל פוסט מוביל ל־Pack **או** לתאריך הופעה — לא לשניהם בלי CTA.

---

## אם הספרייה כותבת `API 4000 not reachable`

ה-UI הישן מחפש את ה-IDE. קו הייצור החדש חי על **4051**.  
`START-DAILY-LINE.cmd` גם מעלה גשר על 4000 כשה-IDE כבוי.

```powershell
curl http://127.0.0.1:4051/api/health
curl http://127.0.0.1:4051/api/line/status
curl http://127.0.0.1:4340/api/health
```
