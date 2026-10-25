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
    """Zeitpunkte der Uploads in der letzten Stunde, die ältesten zuerst, in Ortszeit.

    Zeitpunkte in der Zukunft zählen nicht: Wurde die Uhr zurückgestellt, sperrten sie sonst
    weit länger als eine Stunde. Zählt das Programm dadurch zu wenig, meldet der Server 429."""
    now = _now()
    return sorted(stamp for stamp in _load() if now - WINDOW < stamp <= now)


def remaining() -> int:
    """Wie viele Uploads in dieser Stunde noch gehen."""
    return max(PER_HOUR - len(recent()), 0)


def free_at(needed: int = 1) -> datetime | None:
    """Ab wann wieder `needed` Uploads hintereinander gehen; None, wenn sofort.
    Mehr als PER_HOUR gehen nie auf einmal – dafür zählt, ab wann die Stunde ganz frei ist."""
    stamps = recent()
    must_expire = len(stamps) + min(needed, PER_HOUR) - PER_HOUR
    if must_expire <= 0:
        return None
    return stamps[must_expire - 1] + WINDOW


def note_upload():
    """Einen gelungenen Upload mitzählen."""
    _save(recent() + [_now()])


def note_refused():
    """Der Server hat mit 429 abgelehnt: die Stunde ab jetzt als voll betrachten."""
    stamps = recent()
    _save(stamps + [_now()] * max(PER_HOUR - len(stamps), 0))


def _load() -> list[datetime]:
    """Alle gespeicherten Zeitpunkte in Ortszeit. Unlesbares wird übergangen, ebenso Zeitpunkte
    ohne Zeitzone – die schreibt das Programm nie, und vergleichen ließen sie sich nicht."""
    try:
        texts = json.loads(FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(texts, list):
        return []
    stamps = []
    for text in texts:
        try:
            stamp = datetime.fromisoformat(text)
        except (TypeError, ValueError):
            continue
        if stamp.tzinfo is not None:
            # In Ortszeit umrechnen: sonst zeigte „wieder ab 15:30 Uhr“ nach einer
            # Zeitumstellung die Uhrzeit von vorher.
            stamps.append(stamp.astimezone())
    return stamps


def _save(stamps: list[datetime]):
    try:
        system.write_file(FILE, json.dumps([s.isoformat(timespec="seconds") for s in stamps]))
    except OSError:
        pass  # nur eine Vorwarnung; der Server prüft die Grenze ohnehin selbst
