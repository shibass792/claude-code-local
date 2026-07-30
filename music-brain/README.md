# Music Brain 🧠

מערכת AI מודולרית לייצור מוזיקה — סורקת את כל המחשב, מנתחת סאונד, לומדת את סגנון העבודה שלך, וממליצה מתוך הספריות הקיימות.

## ארכיטקטורה

```
┌─────────────┬──────────────┬──────────────┬─────────────────┐
│   Scanner   │   Analyzer   │  Knowledge   │    Matcher      │
│  (שלב 1)    │  (שלב 2-3)   │     DB       │    (שלב 4)      │
├─────────────┴──────────────┴──────────────┴─────────────────┤
│  Brain (5-6-10)  │  AI Search (9)  │  Cubase Bridge (7)     │
└─────────────────────────────────────────────────────────────┘
```

| מודול | תפקיד |
|--------|--------|
| **Scanner** | סריקה אינקרמנטלית של H:\, D:\, F:\, C:\Users\shibass\ |
| **Analyzer** | BPM, Key, LUFS, MFCC, Transient, סיווג Bass/Kick/Lead |
| **Knowledge DB** | SQLite — אינדקס מהיר של כל הקבצים והניתוחים |
| **Matcher** | התאמת באס לקיק גם בלי אותו Key (Pitch + Envelope + Transient) |
| **Brain** | לומד שימוש בפלאגינים, BPM, Key, שרשראות FX |
| **AI Search** | "באס כמו Astrix", "Kick ל-145 Full On" |
| **Cubase Bridge** | המלצות בפתיחת פרויקט |

## התקנה (Windows)

```powershell
cd music-brain
python -m venv .venv
.venv\Scripts\activate
pip install -e .
```

ערוך את `config.yaml` — ודא שהנתיבים נכונים:

```yaml
scan_paths:
  - "H:\\"
  - "D:\\"
  - "F:\\"
  - "C:\\Users\\shibass\\"
```

## שימוש

### Pipeline מלא (סריקה ראשונה)

```powershell
music-brain pipeline
```

### פקודות לפי שלב

```powershell
# שלב 1 — סריקה (רק קבצים חדשים/שהשתנו)
music-brain scan

# שלב 2+3 — ניתוח אודיו
music-brain analyze

# שלב 5 — סטטיסטיקות (70% Serum, F# 142 BPM...)
music-brain stats

# שלב 6 — שרשראות FX מומלצות
music-brain chains --plugin Serum

# שלב 7 — Cubase: פתיחת פרויקט
music-brain cubase "D:\Projects\MyTrack.cpr"

# שלב 8 — Project DNA
music-brain dna "D:\Projects\MyTrack.cpr"

# שלב 9 — חיפוש AI
music-brain search "באס כמו Astrix"
music-brain search "kick for 145 full on"

# שלב 10 — Brain Mode
music-brain brain

# סטטוס
music-brain status
```

## מה המערכת מזהה

### DAWs
Cubase (.cpr), Ableton (.als), Studio One (.song)

### פלאגינים
Serum, Sylenth, Vital, Nexus, Spire, Diva, Pigments, Massive, Omnisphere, Kontakt, Kick 3, Battery, Groove Agent

### סגנונות באס
`rolling_bass`, `offbeat_bass`, `fullon_bass`, `progressive_bass`, `dark_bass`, `goa_bass`

### ניתוח DSP (שלב 3)
Transient, Attack, Release, Envelope, Stereo Width, RMS, LUFS, MFCC, Spectral Rolloff, Tonnetz, Chroma, Spectral Contrast, Tempo/Key Confidence

## Project DNA (שלב 8)

כל פרויקט מקבל:
- BPM, Key, Mood, Genre
- Bass Style, Lead Style, FX Style
- Energy, Mix LUFS, Stereo Width
- Kick Type, Bass Type
- Preset List, Plugin List, Sample List, Plugin Chains

## Matcher — למה לא רק Key?

המנוע משקל:
- **Transient** (20%) — קיק חזק + באס רך = התאמה
- **Envelope** (15%) — באס שמתחיל אחרי ה-attack של הקיק
- **Spectral** (20%) — תדרים משלימים
- **Key** (15%) — חשוב אבל לא הכול
- **BPM** (15%)

## Cubase Bridge

כשפותחים פרויקט:

> מצאתי 26 באסים שמתאימים. מצאתי 9 מלודיות מאותו Key.

בעתיד: VST3 plugin + OSC לשילוב ישיר ב-Cubase.

## ביצועים

- **סריקה אינקרמנטלית** — רק קבצים חדשים או שהשתנו (mtime + hash)
- **מסד נתונים מקומי** — אין סריקה מחדש בכל פתיחה
- הרץ `analyze` ברקע אחרי `scan` — אפשר לעצור ולהמשיך

## רישיון

MIT
