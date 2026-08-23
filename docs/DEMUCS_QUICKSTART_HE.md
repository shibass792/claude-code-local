# Demucs + MIDI Forge — התחלה מהירה

## הבעיה

```
[i] test30.wav: WAV detected — audio stage not wired yet (Demucs venv), skipping.
```

MIDI Forge (8791) רואה את הקובץ אבל **אין venv של Demucs** בתהליך.

## פתרון (פקודה אחת)

```powershell
cd H:\shibass-ai
powershell -ExecutionPolicy Bypass -File .\scripts\start-demucs-pipeline.ps1
```

או:

1. `scripts\wire-demucs-for-midi-forge.ps1` — פעם אחת
2. לחיצה כפולה על `START-MIDI-FORGE-DEMUCS.cmd`

## מה קורה

| רכיב | נתיב / פורט |
|------|-------------|
| תיקיית ייצוא | `H:\shibass-ai\10_OUTPUTS\MIDI_EXPORT` |
| Stems | `H:\shibass-ai\10_OUTPUTS\stems\<שם-קובץ>\` |
| venv | `H:\shibass-ai\.venv-demucs\` |
| Watcher | `scripts\watch-midi-export-demucs.ps1` |

ה-watcher מריץ Demucs על כל WAV חדש — **גם אם Forge עדיין מדלג**.

## בדיקה ידנית

```powershell
H:\shibass-ai\.venv-demucs\Scripts\python.exe H:\shibass-ai\tools\demucs_wav_hook.py H:\shibass-ai\10_OUTPUTS\MIDI_EXPORT\test30.wav
```

## אחרי Stems → Social Studio

```powershell
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\watch-social-inbox.ps1
```

סרטונים ב-`10_OUTPUTS\social\` נכנסים לתור אישור ב-promo-publisher.

## Audio Worker 8015

אם **Full Audio Worker** כבר רץ על 8015 — אפשר להשאיר אותו במקביל.
ה-watcher החדש לא תופס את הפורט הזה.

## אבחון

```powershell
powershell -ExecutionPolicy Bypass -File H:\shibass-ai\scripts\shibass-doctor.ps1
```
