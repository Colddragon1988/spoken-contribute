"""Startpunkt: ohne Argumente das Fenster, mit --test oder --ohne-fenster im Terminal."""
from __future__ import annotations

import sys
from pathlib import Path

from . import history, settings, upload

USAGE = """Aufruf: Spoken-Upload.pyw [--test | --ohne-fenster]
  (ohne)          Fenster öffnen
  --test          im Terminal zeigen, was gesendet würde – nichts wird gesendet oder gelöscht
  --ohne-fenster  im Terminal hochladen, z. B. für einen Zeitplan"""


def main(args: list[str]) -> int:
    if any(arg not in ("--test", "--ohne-fenster") for arg in args):
        print(USAGE)
        return 0 if set(args) & {"-h", "--help"} else 2
    try:
        history.migrate_old_archive()
    except (OSError, ValueError) as err:  # ValueError: ein unmöglicher Zeitpunkt im Dateinamen
        print(f"Altes Archiv nicht übernommen: {err}", file=sys.stderr)
    if args:
        return run_in_terminal(test="--test" in args)
    try:
        from .gui import run_window
    except ImportError as err:  # tkinter fehlt, unter Linux ein eigenes Paket
        print(f"Für das Fenster fehlt tkinter ({err}).\n"
              "Debian/Ubuntu: sudo apt install python3-tk · Fedora: sudo dnf install python3-tkinter\n"
              "Ohne Fenster geht es mit --ohne-fenster.", file=sys.stderr)
        return 1
    return run_window()


def run_in_terminal(test: bool) -> int:
    config = settings.load()
    if not config.wow_dir:
        print("Kein WoW-Ordner gefunden – bitte einmal im Fenster auswählen.")
        return 1
    report = upload.run(Path(config.wow_dir), settings.load_login(), test=test, log=print)
    print(report.text())
    return 1 if report.failed else 0
