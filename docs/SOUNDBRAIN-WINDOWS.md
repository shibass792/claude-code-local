# SoundBrain Match Panel — התקנה והרצה ב-Windows
#
# אם קיבלת:
#   No module named soundbrain
#   Could not open requirements file: requirements-soundbrain.txt
# זה אומר שהריפו אצלך עדיין על main (בלי SoundBrain), או שהחבילה לא הותקנה.

## 1) משוך את הענף עם הקוד

ב-PowerShell:

```powershell
cd H:\shibass-ai\claude-code-local
git fetch origin
git checkout cursor/match-panel-cubase-8080
git pull origin cursor/match-panel-cubase-8080
```

ודא שיש קבצים:

```powershell
dir soundbrain
dir requirements-soundbrain.txt
dir pyproject.toml
```

## 2) התקן (פעם אחת)

לחץ כפול / הרץ:

```text
launchers\SoundBrain-Install.cmd
```

או ידנית:

```powershell
cd H:\shibass-ai\claude-code-local
python -m pip install --upgrade pip setuptools wheel
python -m pip install -e ".[audio]"
python -m soundbrain init
```

## 3) סריקה ראשונה ואז פאנל

```text
launchers\SoundBrain-Scan.cmd
launchers\SoundBrain-Panel.cmd
```

הדפדפן ייפתח ל־http://127.0.0.1:8770/panel

## בדיקת תקינות

```powershell
python -c "import soundbrain; print(soundbrain.__file__)"
python -m soundbrain --help
```

אם עדיין `No module named soundbrain` — אתה לא בתיקיית הריפו הנכונה, או שה־`python` ב-PATH הוא התקנה אחרת מזו שבה הרצת `pip install`. הרץ:

```powershell
where python
python -m pip -V
python -m pip install -e "H:\shibass-ai\claude-code-local"
```
