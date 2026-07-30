"""Configuration for DAW Match — all overridable by env vars.

Everything lives under ~/.daw-match so the panel keeps zero state in the repo.
"""
import json
import os
import shutil

HOME = os.path.expanduser("~")
STATE_DIR = os.path.expanduser(os.environ.get("DAW_MATCH_HOME", f"{HOME}/.daw-match"))
INDEX_PATH = f"{STATE_DIR}/index.json"
LINKS_PATH = f"{STATE_DIR}/links.json"
CACHE_DIR = f"{STATE_DIR}/cache"

# Where matched arps get staged next to the DAW project, one folder per track.
SESSIONS_DIR = os.path.expanduser(
    os.environ.get("DAW_MATCH_SESSIONS", f"{HOME}/DAW-Match Sessions")
)

PORT = int(os.environ.get("DAW_MATCH_PORT", "4020"))

# Default library roots. Anything missing is skipped silently, so a Mac with
# only one of these still works.
DEFAULT_LIBRARY_ROOTS = [
    f"{HOME}/Music/DAW-Match Library",
    f"{HOME}/Documents/Cubase Projects",
    f"{HOME}/Music/Ableton/User Library",
]

# Which app name each DAW button hands off to (`open -a <name>` on macOS).
DEFAULT_DAW_APPS = {
    "cubase": "Cubase 14",
    "ableton": "Ableton Live 12 Suite",
}

ARP_EXTS = {".mid", ".midi"}
AUDIO_EXTS = {".wav", ".aif", ".aiff", ".mp3", ".flac", ".m4a", ".ogg"}
PROJECT_EXTS = {".cpr": "cubase", ".als": "ableton"}


def _split_env_list(name):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return []
    return [os.path.expanduser(p) for p in raw.split(os.pathsep) if p.strip()]


class Config:
    """Resolved runtime settings. Env vars win over the JSON config file."""

    def __init__(self, overrides=None):
        data = self._load_file()
        if overrides:
            data.update(overrides)

        roots = _split_env_list("DAW_MATCH_LIBRARY") or data.get("library_roots")
        self.library_roots = [os.path.expanduser(r) for r in (roots or DEFAULT_LIBRARY_ROOTS)]

        apps = dict(DEFAULT_DAW_APPS)
        apps.update(data.get("daw_apps") or {})
        for daw in list(apps):
            env = os.environ.get(f"DAW_MATCH_{daw.upper()}_APP")
            if env:
                apps[daw] = env
        self.daw_apps = apps

        # Escape hatch: run this instead of `open -a`. Receives the file path as
        # $1 and the DAW id as $2. Used for non-macOS hosts and for tests.
        self.open_cmd = os.environ.get("DAW_MATCH_OPEN_CMD") or data.get("open_cmd") or ""

        # A user's own matcher script. Called as `script <input>`; stdout is
        # merged into the results (JSON list, or one path per line).
        self.external_script = os.path.expanduser(
            os.environ.get("DAW_MATCH_SCRIPT") or data.get("external_script") or ""
        )

        self.sessions_dir = os.path.expanduser(data.get("sessions_dir") or SESSIONS_DIR)
        self.port = int(data.get("port") or PORT)

    @staticmethod
    def _load_file():
        path = f"{STATE_DIR}/config.json"
        try:
            with open(path, "r", encoding="utf-8") as fh:
                loaded = json.load(fh)
            return loaded if isinstance(loaded, dict) else {}
        except (OSError, ValueError):
            return {}

    def to_dict(self):
        return {
            "library_roots": self.library_roots,
            "daw_apps": self.daw_apps,
            "sessions_dir": self.sessions_dir,
            "external_script": self.external_script,
            "open_cmd": self.open_cmd,
            "port": self.port,
        }


def ensure_state_dirs():
    os.makedirs(STATE_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)


def have(tool):
    return shutil.which(tool) is not None
