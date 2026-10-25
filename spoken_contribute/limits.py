"""Die Upload-Grenze des Servers für gesammelte Zeilen: höchstens 10 Uploads pro Stunde je
IP-Adresse (saved-variables.ts).

Das Programm zählt seine eigenen Uploads mit, damit es nicht erst am Fehler 429 merkt, dass die
Grenze erreicht ist. Uploads über die Website kennt es nicht – meldet der Server trotzdem 429,
gilt die Stunde ab da als voll."""
from __future__ import annotations

import json
from datetime import datetime, timedelta

from . import system

PER_HOUR = 10
WINDOW = timedelta(hours=1)
FILE = system.data_dir() / "upload-zeiten.json"


def _now() -> datetime:
    return datetime.now().astimezone()


def recent() -> list[datetime]:
    """Zeitpunkte der Uploads in der letzten Stunde, die ältesten zuerst."""
    try:
        stamps = [datetime.fromisoformat(s) for s in json.loads(FILE.read_text(encoding="utf-8"))]
    except (OSError, ValueError, TypeError):
        return []
    cutoff = _now() - WINDOW
    return sorted(s for s in stamps if s > cutoff)


def remaining() -> int:
    """Wie viele Uploads in dieser Stunde noch gehen."""
    return max(PER_HOUR - len(recent()), 0)


def free_at(needed: int = 1) -> datetime | None:
    """Ab wann wieder `needed` Uploads gehen; None, wenn sofort."""
    stamps = recent()
    over = len(stamps) + needed - PER_HOUR
    if over <= 0:
        return None
    return stamps[over - 1] + WINDOW


def note_upload():
    """Einen gelungenen Upload mitzählen."""
    _save(recent() + [_now()])


def note_refused():
    """Der Server hat mit 429 abgelehnt: die Stunde ab jetzt als voll betrachten."""
    stamps = recent()
    _save(stamps + [_now()] * max(PER_HOUR - len(stamps), 0))


def _save(stamps: list[datetime]):
    try:
        system.write_file(FILE, json.dumps([s.isoformat(timespec="seconds") for s in stamps]))
    except OSError:
        pass  # nur eine Vorwarnung; der Server prüft die Grenze ohnehin selbst
