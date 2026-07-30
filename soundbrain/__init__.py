"""SoundBrain — a local studio knowledge engine.

Ten stages, one SQLite database, no cloud:

1. :mod:`soundbrain.scanner` indexes every drive you point it at
2. :mod:`soundbrain.taxonomy` decides what kind of bass / lead / kick / pad / FX / vocal a file is
3. :mod:`soundbrain.analyzer` extracts transient, envelope, LUFS, MFCC, chroma, tonnetz, tempo and key
4. :mod:`soundbrain.matcher` decides whether a bass fits a kick, key or no key
5. :mod:`soundbrain.learner` learns which instruments, keys and tempos you actually use
6. the same module learns your effect chains
7. :mod:`soundbrain.bridge` and :mod:`soundbrain.server` report matches while you work
8. :mod:`soundbrain.dna` gives every project a DNA record
9. :mod:`soundbrain.search` answers "a bass like Astrix" over your own library
10. :mod:`soundbrain.brain` keeps learning from every new track

Everything runs on your machine against your own files.
"""

from .config import Config, load_config  # noqa: F401
from .db import Database, open_db  # noqa: F401

__version__ = "1.0.0"

__all__ = ["Config", "Database", "load_config", "open_db", "__version__"]
