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
    """Argumente auswerten, Altlasten aufräumen, dann Fenster oder Terminal."""
    if any(arg not in ("--test", "--ohne-fenster") for arg in args):
        print(USAGE)
        return 0 if set(args) & {"-h", "--help"} else 2
    test = "--test" in args
    if not test:  # der Testlauf verspricht, nichts zu verändern
        tidy_up()
    if args:
        return run_in_terminal(test)
    try:
        from .gui import run_window
    except ImportError as err:  # tkinter fehlt, unter Linux ein eigenes Paket
        print(f"Für das Fenster fehlt tkinter ({err}).\n"
              "Debian/Ubuntu: sudo apt install python3-tk · Fedora: sudo dnf install python3-tkinter\n"
              "Ohne Fenster geht es mit --ohne-fenster.", file=sys.stderr)
        return 1
    return run_window()


def tidy_up():
    """Was frühere Fassungen hinterlassen haben, in die heutige Form bringen."""
    try:
        history.migrate_old_archive()
    except OSError as err:
        print(f"Altes Archiv nicht übernommen: {err}", file=sys.stderr)
    try:
        settings.move_password_to_keyring()  # Passwort einer früheren Fassung aus login.json holen
    except OSError as err:  # login.json nicht beschreibbar; das Passwort steht noch darin
        print(f"Passwort nicht in den Schlüsselbund umgezogen: {err}", file=sys.stderr)


def run_in_terminal(test: bool) -> int:
    """Ein Durchgang ohne Fenster; der Rückgabewert ist der Exit-Code (1 = nicht alles geklappt)."""
    for stream in (sys.stdout, sys.stderr):
        # In eine Datei umgeleitet, schreibt Windows z. B. cp1252: Quest-Titel in anderen
        # Schriften dürfen den Upload dann nicht mit einem UnicodeEncodeError abbrechen.
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    config = settings.load()
    if not config.wow_dir:
        print("Kein WoW-Ordner gefunden – bitte einmal im Fenster auswählen.")
        return 1
    report = upload.run(Path(config.wow_dir), settings.credentials(), test=test, log=print)
    print(report.text())
    return 1 if report.failed else 0
