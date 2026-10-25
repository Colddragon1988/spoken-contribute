"""Archiv und Verlauf aller Uploads.

Jeder Upload bekommt einen eigenen Ordner unter verlauf/ im Datenordner:
  eintrag.json   wann, was, aus welcher Version, Ergebnis laut Server oder der Fehler
  daten.json.gz  genau das, was gesendet wurde, und die Antworten des Servers
  originale/     die SpokenContributions-Dateien, wie sie vor dem Leeren aussahen

Nichts davon wird automatisch gelöscht. eintrag.json wird zuletzt geschrieben: Ein Ordner ohne
sie ist ein abgebrochener Eintrag und erscheint nicht im Verlauf."""
from __future__ import annotations

import gzip
import itertools
import json
import re
import shutil
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

from . import system
from .wowdata import FLAVOR_NAMES, envelopes_in, parse_envelope, summarize

ROOT = system.data_dir() / "verlauf"
INFO, DATA, ORIGINALS = "eintrag.json", "daten.json.gz", "originale"
KIND_LABELS = {"zeilen": "Gesammelte Zeilen", "npc-texte": "NPC-Texte"}
SOURCE_NAMES = {"quests": "Quest", "books": "Buch", "readables": "Buch"}
EVENT_NAMES = {"detail": "Annahme", "progress": "Fortschritt", "complete": "Abschluss",
               "greeting": "Begrüßung", "gossip": "Gespräch"}


@dataclass
class Entry:
    folder: Path
    info: dict  # der Inhalt von eintrag.json

    @property
    def time(self) -> datetime:
        """Zeitpunkt in Ortszeit. Ein Zeitpunkt ohne Zeitzone (etwa von Hand eingetragen) gilt
        als Ortszeit – sonst ließe er sich nicht mit den übrigen vergleichen und sortieren."""
        return datetime.fromisoformat(self.info["zeit"]).astimezone()

    @property
    def failed(self) -> bool:
        return self.info.get("status") != "ok"

    def payload(self) -> dict | None:
        """Das Gesendete samt Antwort; None, wenn nichts gespeichert ist (fehlgeschlagener Upload)."""
        try:
            with gzip.open(self.folder / DATA, "rt", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None


# ---------------------------------------------------------------- schreiben

def record(kind: str, info: dict, payload: dict | None = None,
           originals: list[tuple[Path, str]] = (), when: datetime | None = None) -> Entry:
    """Einen Upload archivieren. originals: (Datei, Name im Archiv) – werden kopiert."""
    when = when or datetime.now().astimezone()
    folder = _new_folder(when, kind)
    if payload is not None:
        with gzip.open(folder / DATA, "wt", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
    for source, name in originals:
        target = folder / ORIGINALS / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    info = {"zeit": when.isoformat(timespec="seconds"), "art": kind, **info}
    system.write_file(folder / INFO, json.dumps(info, ensure_ascii=False, indent=2))
    return Entry(folder, info)


def _new_folder(when: datetime, kind: str) -> Path:
    """Ein neuer, leerer Ordner je Eintrag; zwei Uploads in derselben Sekunde bekommen -2 usw."""
    stamp = when.strftime("%Y-%m-%d_%H-%M-%S")
    for n in itertools.count(1):
        folder = ROOT / (f"{stamp}_{kind}" if n == 1 else f"{stamp}_{kind}-{n}")
        try:
            folder.mkdir(parents=True)
            return folder
        except FileExistsError:
            continue


# Sicherungen des früheren Skripts: <Zeit>_[<Version>_]<Account>_SpokenContributions.lua[.bak]
OLD_BACKUP = re.compile(r"(\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d)_(.+)_(SpokenContributions\.lua(?:\.bak)?)")


def migrate_old_archive():
    """Übernimmt die losen Sicherungen des früheren Skripts aus dem Datenordner in den Verlauf:
    je Zeitpunkt ein Eintrag. Die alten Dateien werden erst gelöscht, wenn ihr Eintrag steht."""
    groups: dict[str, list[tuple[Path, re.Match]]] = {}
    for path in system.data_dir().glob("*_SpokenContributions.lua*"):
        match = OLD_BACKUP.fullmatch(path.name)
        if match:
            groups.setdefault(match.group(1), []).append((path, match))
    for stamp, files in sorted(groups.items()):
        try:
            when = datetime.strptime(stamp, "%Y-%m-%d_%H-%M-%S").astimezone()
        except ValueError:
            continue  # unmöglicher Zeitpunkt im Namen: die Dateien bleiben einfach liegen
        _migrate_group(when, sorted(files))
        for path, _ in files:
            path.unlink()


def _migrate_group(when: datetime, files: list[tuple[Path, re.Match]]):
    envelopes, originals, versions = [], [], []
    for path, match in files:
        flavor, _, account = match.group(2).rpartition("_")
        flavor = flavor or "classic_era"  # die erste Fassung kannte nur Classic Era
        name = FLAVOR_NAMES.get(f"_{flavor}_", flavor)
        if name not in versions:
            versions.append(name)
        envelopes += envelopes_in(path)
        originals.append((path, f"{flavor}/{account}/{match.group(3)}"))
    envelopes = list(dict.fromkeys(envelopes))
    kinds, titles = summarize(envelopes)
    record("zeilen",
           {"status": "ok", "versionen": versions, "anzahl": len(envelopes),
            "zusammenfassung": kinds, "titel": titles,
            "hinweis": "Aus dem Archiv des früheren Skripts übernommen; die Antwort des Servers "
                       "wurde damals nicht gespeichert."},
           payload={"gesendet": {"envelopes": envelopes}}, originals=originals, when=when)


# ---------------------------------------------------------------- lesen und anzeigen

def entries() -> list[Entry]:
    """Alle archivierten Uploads, die neuesten zuerst."""
    found = []
    for path in ROOT.glob(f"*/{INFO}"):
        try:
            info = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(info, dict):
                datetime.fromisoformat(info["zeit"])  # ohne lesbaren Zeitpunkt kein Eintrag
                found.append(Entry(path.parent, info))
        except (OSError, ValueError, KeyError, TypeError):
            continue  # beschädigt; der Ordner bleibt unberührt
    # Bei gleicher Sekunde entscheidet der Ordnername (…_zeilen-2 nach …_zeilen), damit die
    # Reihenfolge nicht davon abhängt, in welcher Folge das Dateisystem die Ordner liefert.
    return sorted(found, key=lambda e: (e.time, e.folder.name), reverse=True)


def result_text(info: dict) -> str:
    """Kurzfassung des Ergebnisses, z. B. „12 neu, 3 schon bekannt“."""
    if info.get("status") != "ok":
        return "Fehlgeschlagen"
    result = info.get("ergebnis")
    if not result:
        return "gesendet (Antwort nicht gespeichert)"
    parts = [f"{result.get('neu', 0)} neu"]
    for key, label in (("bekannt", "schon bekannt"), ("aktualisiert", "aktualisiert"),
                       ("abgelehnt", "nicht verwendbar")):
        if result.get(key):
            parts.append(f"{result[key]} {label}")
    return ", ".join(parts)


def row(entry: Entry) -> tuple:
    """Eine Zeile der Verlaufstabelle: Zeitpunkt, Art, Version, Anzahl, Ergebnis."""
    info = entry.info
    version = ", ".join(info.get("versionen", []))
    if info.get("sprache"):
        version += f" ({info['sprache']})"
    return (entry.time.strftime("%d.%m.%Y  %H:%M"), KIND_LABELS.get(info.get("art"), "?"),
            version, info.get("anzahl", ""), result_text(info))


def totals(found: list[Entry]) -> str:
    """Die Summenzeile über dem Verlauf."""
    ok = [e for e in found if not e.failed]
    lines = sum(e.info.get("anzahl", 0) for e in ok if e.info.get("art") == "zeilen")
    texts = sum(e.info.get("anzahl", 0) for e in ok if e.info.get("art") == "npc-texte")
    answered = [e.info["ergebnis"] for e in ok if e.info.get("ergebnis")]
    text = f"{len(ok)} Uploads: {lines} gesammelte Zeilen und {texts} NPC-Texte"
    if answered:  # beim übernommenen Archiv kennt man die Antwort des Servers nicht
        text += f", davon {sum(r.get('neu', 0) for r in answered)} neu für das Projekt"
    failed = len(found) - len(ok)
    return text + (f" · {failed} fehlgeschlagen" if failed else "")


def details(entry: Entry) -> str:
    """Alles zu einem Upload als Text; die erste Zeile ist die Überschrift."""
    info = entry.info
    out = [f"{KIND_LABELS.get(info.get('art'), '?')} – {entry.time:%d.%m.%Y um %H:%M:%S}",
           f"Version: {row(entry)[2] or '?'}"]
    if info.get("zusammenfassung"):
        out.append(f"Inhalt: {info['zusammenfassung']}")
    if entry.failed:
        out.append(f"Fehlgeschlagen: {info.get('fehler', '?')}")
        out.append("Gelöscht wurde dabei nichts; die Daten gingen beim nächsten Upload erneut mit.")
    else:
        out.append(f"Ergebnis: {result_text(info)}")
    if info.get("zu_lang"):
        out.append(f"{info['zu_lang']} Texte waren länger als der Server annimmt; sie stehen unten "
                   "unter „Nicht gesendet“.")
    if info.get("hinweis"):
        out.append(info["hinweis"])
    payload = entry.payload()
    if payload:
        out += ["", "Gesendet:"]
        out += _envelope_lines(payload) if info.get("art") == "zeilen" else _text_lines(payload)
    return "\n".join(out)


def _envelope_lines(payload: dict) -> list[str]:
    """Je Umschlag: Titel, Art, Ereignis und NPC, darunter der Text."""
    lines = []
    for envelope in (payload.get("gesendet") or {}).get("envelopes", []):
        fields = parse_envelope(envelope)
        npc = re.sub(r"^\d+\s+", "", fields.get("npc", ""))  # "276 Viktori …" → "Viktori …"
        meta = " · ".join(x for x in (SOURCE_NAMES.get(fields["source"], fields["source"]),
                                      EVENT_NAMES.get(fields.get("event"), fields.get("event")), npc) if x)
        lines.append(f"\n• {fields.get('title') or fields.get('book') or '(ohne Titel)'}   ({meta})")
        text = fields.get("text") or max((v for v in fields.values() if "\n" in v), key=len, default="")
        text = re.sub(r"<[^>]*>", "", text)  # Bücher sind als HTML gespeichert
        lines += ["    " + line.strip() for line in text.splitlines() if line.strip()]
    return lines


def _text_lines(payload: dict) -> list[str]:
    """Je Paket Sprache und Build, darunter die Texte; am Ende die zu langen."""
    def show(text: str) -> str:
        return text.replace("\n", "\n        ")

    lines = []
    for request in payload.get("gesendet") or []:
        texts = request.get("texts", [])
        lines.append(f"\nSprache {request.get('lang')}, Build {request.get('build')} – {len(texts)} Texte:")
        for t in texts:
            male, female = t.get("text", ""), t.get("text1", "")
            lines.append(f"#{t.get('id')}  {show(male or female)}")
            if male and female and female != male:
                lines.append(f"        weiblich: {show(female)}")
    skipped = payload.get("nicht_gesendet") or []
    if skipped:
        lines.append(f"\nNicht gesendet (zu lang für den Server) – {len(skipped)} Texte:")
        lines += [f"#{t.get('id')}  {show(t.get('text') or t.get('text1', ''))}" for t in skipped]
    return lines


# ---------------------------------------------------------------- Suche und Statistik

def search_text(entry: Entry) -> str:
    """Alles zu einem Upload in Kleinbuchstaben, zum Durchsuchen (Titel, Texte, Fehler …).
    Liest dafür das Gesendete – bei vielen NPC-Texten einige MB, also nicht im Fenster-Thread."""
    return details(entry).casefold()


@dataclass
class Statistics:
    uploads: int = 0
    failed: int = 0
    lines: int = 0  # gesendete gesammelte Zeilen
    lines_new: int = 0
    lines_known: int = 0
    texts: int = 0  # gesendete NPC-Texte
    texts_new: int = 0
    texts_changed: int = 0
    per_version: dict = field(default_factory=dict)  # {Version: [Zeilen, NPC-Texte]}
    first: datetime | None = None
    last: datetime | None = None


def statistics(found: list[Entry]) -> Statistics:
    """Summen über die Einträge; braucht nur eintrag.json, nicht das Gesendete."""
    stats = Statistics()
    for entry in found:
        if entry.failed:
            stats.failed += 1
            continue
        info, result = entry.info, entry.info.get("ergebnis") or {}
        count = info.get("anzahl", 0)
        stats.uploads += 1
        stats.first = min(stats.first or entry.time, entry.time)
        stats.last = max(stats.last or entry.time, entry.time)
        column = 0 if info.get("art") == "zeilen" else 1
        if column == 0:
            stats.lines += count
            stats.lines_new += result.get("neu", 0)
            stats.lines_known += result.get("bekannt", 0)
        else:
            stats.texts += count
            stats.texts_new += result.get("neu", 0)
            stats.texts_changed += result.get("aktualisiert", 0)
        for version in info.get("versionen", []) or ["?"]:
            stats.per_version.setdefault(version, [0, 0])[column] += count
    return stats


def daily(found: list[Entry], days: int = 30) -> list[tuple[date, int, int]]:
    """(Tag, gesammelte Zeilen, NPC-Texte) für die letzten `days` Tage bis heute."""
    today = datetime.now().astimezone().date()
    totals = {today - timedelta(days=n): [0, 0] for n in range(days)}
    for entry in found:
        day = entry.time.date()
        if entry.failed or day not in totals:
            continue
        totals[day][0 if entry.info.get("art") == "zeilen" else 1] += entry.info.get("anzahl", 0)
    return [(day, *totals[day]) for day in sorted(totals)]
