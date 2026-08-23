# Music Brain — Windows Install & Scripts Guide

## הורדה

### אופציה 1 — ZIP (הכי פשוט)

https://github.com/shibass792/claude-code-local/archive/refs/heads/cursor/music-brain-system-f88d.zip

חלץ → היכנס לתיקייה:
`claude-code-local-cursor-music-brain-system-f88d\music-brain\`

### אופציה 2 — סקריפט הורדה

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\download.ps1
```

### אופציה 3 — Git

```powershell
git clone -b cursor/music-brain-system-f88d https://github.com/shibass792/claude-code-local.git
cd claude-code-local\music-brain
```

---

## סקריפטים — `scripts\windows\`

| סקריפט | מה עושה |
|--------|---------|
| **Music-Brain-Install.bat** | דאבל-קליק — התקנה מלאה |
| **Music-Brain-Pipeline.bat** | דאבל-קליק — סריקה ראשונה |
| **Music-Brain-Start.bat** | דאבל-קליק — הפעל הכל |
| `download.ps1` | הורדה/עדכון מ-GitHub |
| `install.ps1` | Python venv + pip install |
| `pipeline-first-run.ps1` | scan → analyze → embeddings (ראשון) |
| `start-all.ps1` | Web UI + watch + Cubase Companion |
| `stop-all.ps1` | עצור את כל השירותים |
| `install-scheduled-task.ps1` | הרצה אוטומטית עם עליית Windows |
| `search.ps1` | חיפוש מהיר מהטרמינל |
| `similar.ps1` | מצא סאונדים דומים |
| `backup.ps1` | גיבוי music_brain.db |

---

## התקנה מהירה (3 שלבים)

### 1. התקנה
דאבל-קליק על:
```
scripts\windows\Music-Brain-Install.bat
```

או:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1
```

### 2. ערוך `config.yaml`
```yaml
scan_paths:
  - "H:\\"
  - "D:\\"
  - "F:\\"
  - "C:\\Users\\shibass\\"
```

### 3. סריקה ראשונה
דאבל-קליק על:
```
scripts\windows\Music-Brain-Pipeline.bat
```

---

## שימוש יומיומי

### הפעל הכל (UI + Brain Mode + Cubase)
```
scripts\windows\Music-Brain-Start.bat
```

פותח אוטומטית: **http://127.0.0.1:8787**

### חיפוש מהטרמינל
```powershell
.\scripts\windows\search.ps1 "באס כמו Astrix"
.\scripts\windows\search.ps1 "kick 145 full on"
```

### סאונדים דומים
```powershell
.\scripts\windows\similar.ps1 -Style astrix
.\scripts\windows\similar.ps1 -Path "H:\Samples\bass\my_bass.wav"
```

### עצור הכל
```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\stop-all.ps1
```

### הרצה אוטומטית עם Windows (אופציונלי)
```powershell
# Run as Administrator
powershell -ExecutionPolicy Bypass -File scripts\windows\install-scheduled-task.ps1
```

---

## קבצי פלט

| קובץ | תוכן |
|------|------|
| `data\music_brain.db` | מסד הנתונים המלא |
| `data\cubase_recommendations.json` | המלצות Cubase אחרונות |
| `data\logs\` | לוגים של serve / watch / cubase |
| `data\backups\` | גיבויים אוטומטיים של DB |

---

## דרישות

- Windows 10/11
- Python 3.11+
- ~2GB פנוי לספריית Python + DB (תלוי בגודל הספריות)
