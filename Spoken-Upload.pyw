#!/usr/bin/env python3
"""Spoken-Beiträge hochladen – Startpunkt für Windows, macOS und Linux.

Doppelklick (bzw. ohne Argumente) öffnet das Fenster. Im Terminal:
  --test          zeigen, was gesendet würde – nichts wird gesendet oder gelöscht
  --ohne-fenster  hochladen ohne Fenster, z. B. für einen Zeitplan
Braucht Python 3.8 oder neuer mit tkinter."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from spoken_contribute.main import main  # noqa: E402 – erst nach dem Pfad

sys.exit(main(sys.argv[1:]))
