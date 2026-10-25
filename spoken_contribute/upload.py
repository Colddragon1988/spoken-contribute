"""Ein Upload-Durchgang: laufende WoW-Versionen auslassen, die gesammelten Zeilen und die
NPC-Texte senden, alles Gesendete archivieren und erst danach aufräumen.

1. SpokenContributions.lua – Zeilen ohne Vertonung, die das Addon gesammelt hat. Nur die
   "!SPOKEN"-Umschläge werden gesendet (anonym); danach wird die Liste in der Datei geleert.
2. Cache/ADB/<Sprache>/DBCache.bin – die NPC-Texte (BroadcastText) aus dem Spiel-Cache.
   Verlangt eine Anmeldung; danach wird der Cache gelöscht, WoW legt ihn neu an.

Die Teile sind unabhängig: Was fehlschlägt, bleibt liegen und geht beim nächsten Mal mit."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import history, system
from .api import Site, UploadError
from .wowdata import (CONTRIBUTIONS, backup_of, cache_files, cache_folders, clear_contributions,
                      collect_contributions, flavor_name, newest_texts, spoken_flavors, summarize)

MAX_ENVELOPES = 2000  # Obergrenze des Servers pro Upload (saved-variables.ts)
# Grenzen von /api/broadcast-text (app/api/broadcast-text/route.ts): mehr als 20 000 Texte
# lehnt der Server als Ganzes ab, längere Texte als MAX_TEXT_LENGTH verwirft er stillschweigend.
BROADCAST_BATCH = 5_000
MAX_TEXT_LENGTH = 4_000

Log = Callable[[str], None]  # Fortschrittsmeldungen während des Uploads


@dataclass
class Outcome:
    """Ergebnis eines Teils: Text für die Zusammenfassung, ob etwas gesendet wurde, ob etwas schiefging."""
    text: str
    sent: bool = False
    failed: bool = False


@dataclass
class Report:
    """Ergebnis eines ganzen Durchgangs: Überschrift und ein Abschnitt je Teil."""
    head: str
    sections: list[str]
    failed: bool = False

    def text(self) -> str:
        return "\n\n".join([self.head, *self.sections])


@dataclass
class Overview:
    """Was gerade bereitliegt – für die Anzeige im Fenster."""
    flavors: list[Path]
    running: set[str] | None
    lines: int
    texts: int


def overview(wow: Path) -> Overview:
    flavors = spoken_flavors(wow)
    lines = {e for _, _, envelopes in collect_contributions(flavors) for e in envelopes}
    texts = sum(len(rows) for folder in cache_folders(flavors)
                for rows in newest_texts(cache_files(folder)).values())
    return Overview(flavors, system.running_flavors(), len(lines), texts)


# ---------------------------------------------------------------- gesammelte Zeilen

@dataclass
class Batch:
    """Die gesammelten Zeilen, die in diesem Durchgang mitgehen."""
    envelopes: list[str] = field(default_factory=list)  # ohne Doppelte
    files: list[Path] = field(default_factory=list)  # die .lua-Dateien, die danach geleert werden
    per_flavor: dict[str, int] = field(default_factory=dict)  # Anzahl je Version, für die Meldung
    deferred: int = 0  # Umschläge, die erst beim nächsten Mal mitgehen


def plan_batch(stores: list[tuple[Path, Path, list[str]]]) -> Batch:
    """Wählt die Dateien für diesen Durchgang aus (zusammen höchstens MAX_ENVELOPES Umschläge).

    Eine Datei geht ganz oder gar nicht mit, denn danach wird sie geleert: Was nicht mehr passt,
    bleibt bis zum nächsten Mal liegen. Nur die erste Datei mit Umschlägen geht immer mit, auch
    wenn sie allein (.lua und .bak zusammen) über der Grenze liegt – sonst käme sie nie durch;
    sie wird dann auf mehrere Uploads verteilt."""
    batch, seen = Batch(), set()
    for flavor, lua, envelopes in stores:
        new = [e for e in envelopes if e not in seen]
        if batch.envelopes and len(batch.envelopes) + len(new) > MAX_ENVELOPES:
            batch.deferred += len(new)
            continue
        batch.envelopes += new
        seen.update(new)
        batch.files.append(lua)
        if new:
            name = flavor_name(flavor)
            batch.per_flavor[name] = batch.per_flavor.get(name, 0) + len(new)
    return batch


def originals_of(files: list[Path]) -> list[tuple[Path, str]]:
    """Die .lua- und .bak-Dateien mit ihrem Namen im Archiv (<Version>/<Account>/<Datei>)."""
    found = []
    for lua in files:  # …/_classic_era_/WTF/Account/<Account>/SavedVariables/SpokenContributions.lua
        flavor, account = lua.parents[4].name.strip("_"), lua.parents[1].name
        found += [(f, f"{flavor}/{account}/{f.name}") for f in (lua, backup_of(lua)) if f.exists()]
    return found


def short_titles(titles: list[str]) -> str:
    text = ", ".join(titles[:10])
    if len(titles) > 10:
        text += f" und {len(titles) - 10} weitere"
    return text


def contribution_payload(envelopes: list[str]) -> dict:
    """Ein Upload, wie ihn das Formular der Website schickt: anonym, ohne Name und E-Mail."""
    return {"envelopes": envelopes, "name": None, "email": None, "website": ""}


def send_envelopes(site: Site, envelopes: list[str]) -> list[dict]:
    """Die Umschläge senden, je Upload höchstens MAX_ENVELOPES; gibt die Antworten zurück.
    Meist ist es ein einziger Upload – mehrere nur, wenn schon eine Datei allein zu groß ist."""
    answers = []
    for start in range(0, len(envelopes), MAX_ENVELOPES):
        payload = contribution_payload(envelopes[start:start + MAX_ENVELOPES])
        result = site.post("/api/contributions/batch", payload, "Gesammelte Zeilen")
        if not result.get("ok"):
            raise UploadError(f"Gesammelte Zeilen: unerwartete Antwort {str(result)[:200]}.")
        answers.append(result)
    return answers


def refused_count(value) -> int:
    """„refused“ kommt als Zahl oder als {Grund: Anzahl}."""
    if isinstance(value, dict):
        return sum(_count(n) for n in value.values())
    return _count(value)


def upload_contributions(site: Site, flavors: list[Path], credentials, test: bool, log: Log) -> Outcome:
    """Alle Versionen in einem Upload: der Server erlaubt nur 10 Uploads pro Stunde."""
    batch = plan_batch(collect_contributions(flavors))
    if not batch.envelopes:
        return Outcome("Gesammelte Zeilen: keine neuen seit dem letzten Upload.")
    origin = ", ".join(f"{n} aus {name}" for name, n in batch.per_flavor.items())
    kinds, titles = summarize(batch.envelopes)
    notes = [short_titles(titles)] if titles else []
    uploads = math.ceil(len(batch.envelopes) / MAX_ENVELOPES)
    if uploads > 1:
        notes.append(f"Mehr als {MAX_ENVELOPES} Zeilen in einer Datei – sie gehen in {uploads} Uploads.")
    if batch.deferred:
        notes.append(f"{batch.deferred} weitere passen nicht mehr in diesen Upload (höchstens "
                     f"{MAX_ENVELOPES}) und gehen beim nächsten Mal mit.")
    if test:
        return Outcome("\n  ".join([f"Gesammelte Zeilen: würde {kinds} senden ({origin}).", *notes]))

    log(f"Gesammelte Zeilen: sende {len(batch.envelopes)} …")
    answers = send_envelopes(site, batch.envelopes)
    accepted = sum(_count(a.get("accepted")) for a in answers)
    known = sum(_count(a.get("known")) for a in answers)
    refused = sum(refused_count(a.get("refused")) for a in answers)
    try:
        history.record("zeilen",
                       {"status": "ok", "versionen": list(batch.per_flavor), "anzahl": len(batch.envelopes),
                        "zusammenfassung": kinds, "titel": titles,
                        "ergebnis": {"neu": accepted - known, "bekannt": known, "abgelehnt": refused}},
                       # "antwort" bleibt wie bisher ein Objekt; nur bei mehreren Uploads eine Liste.
                       payload={"gesendet": contribution_payload(batch.envelopes),
                                "antwort": answers[0] if len(answers) == 1 else answers},
                       originals=originals_of(batch.files))
    except OSError as err:
        raise UploadError(f"Gesammelte Zeilen: gesendet, aber nicht archiviert ({err}).") from None

    stats = f"{accepted - known} neu für das Projekt"
    if known:
        stats += f", {known} kannte es schon"
    if refused:
        stats += f", {refused} nicht verwendbar"
    lines = [f"Gesammelte Zeilen: {kinds} gesendet ({origin}).", stats, *notes]

    # Erst jetzt leeren: Server und Archiv haben alles.
    try:
        kept = clear_contributions(batch.files, set(batch.envelopes))
    except OSError as err:
        lines.append(f"{CONTRIBUTIONS} ließ sich nicht leeren ({err}). Die Zeilen gehen beim "
                     "nächsten Mal erneut mit; der Server erkennt sie wieder.")
        return Outcome("\n  ".join(lines), sent=True, failed=True)
    if kept:
        lines.append(f"{len(kept)} Datei(en) haben sich während des Uploads verändert und bleiben "
                     "unberührt; sie gehen beim nächsten Mal mit.")
    else:
        lines.append(f"Liste in {CONTRIBUTIONS} geleert.")
    return Outcome("\n  ".join(lines), sent=True)


# ---------------------------------------------------------------- NPC-Texte

def utf16_length(text: str) -> int:
    """Länge wie in JavaScript gezählt (UTF-16-Einheiten), so misst auch der Server."""
    return len(text.encode("utf-16-le")) // 2


def is_too_long(row: dict) -> bool:
    return utf16_length(row["text"]) > MAX_TEXT_LENGTH or utf16_length(row["text1"]) > MAX_TEXT_LENGTH


@dataclass
class CacheJob:
    """Der Spiel-Cache einer Version in einer Sprache."""
    folder: Path  # …/<Version>/Cache/ADB/<Sprache>
    files: list[Path]  # DBCache.bin und Zwischenstände; werden nach dem Upload gelöscht
    by_build: dict[int, list[dict]]  # zu sendende Texte je Client-Build
    too_long: list[dict]  # Texte, die der Server verwerfen würde; nur fürs Archiv

    @property
    def flavor(self) -> Path:
        return self.folder.parents[2]

    @property
    def lang(self) -> str:
        return self.folder.name

    @property
    def label(self) -> str:
        return f"NPC-Texte ({flavor_name(self.flavor)}, {self.lang})"

    @property
    def count(self) -> int:
        return sum(len(rows) for rows in self.by_build.values())


def cache_jobs(flavors: list[Path]) -> list[CacheJob]:
    """Alle Caches mit NPC-Texten; zu lange Texte sind schon aussortiert."""
    jobs = []
    for folder in cache_folders(flavors):
        files = cache_files(folder)
        by_build = newest_texts(files)
        if not by_build:
            continue
        skipped = [row for rows in by_build.values() for row in rows if is_too_long(row)]
        sendable = {build: [row for row in rows if not is_too_long(row)] for build, rows in by_build.items()}
        jobs.append(CacheJob(folder, files, sendable, skipped))
    return jobs


def sign_in(site: Site, credentials: dict):
    try:
        site.sign_in(credentials["email"], credentials["password"])
    except UploadError as err:
        if err.status == 401:
            raise UploadError("NPC-Texte: Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht "
                              "mehr. Bitte im Fenster ab- und neu anmelden.") from None
        raise


def send_cache(site: Site, job: CacheJob, info: dict) -> dict[str, int]:
    """Einen Cache senden, archivieren und erst dann löschen; gibt die Summen der Antworten zurück."""
    requests, answers = [], []
    for build, rows in job.by_build.items():  # ein Upload je Client-Build, wie die Website
        for start in range(0, len(rows), BROADCAST_BATCH):  # in Paketen unter dem Server-Limit
            request = {"lang": job.lang, "build": build, "texts": rows[start:start + BROADCAST_BATCH]}
            answers.append(site.post("/api/broadcast-text", request, job.label))
            requests.append(request)

    total = {key: sum(_count(a.get(key)) for a in answers) for key in ("texts", "added", "changed")}
    history.record("npc-texte",
                   {**info, "status": "ok",
                    "ergebnis": {"neu": total["added"], "aktualisiert": total["changed"]}},
                   payload={"gesendet": requests, "antwort": answers, "nicht_gesendet": job.too_long})
    for f in job.files:  # erst jetzt: das Archiv hat alles; WoW legt den Cache neu an
        f.unlink(missing_ok=True)
    return total


def upload_caches(site: Site, flavors: list[Path], credentials, test: bool, log: Log) -> Outcome:
    """NPC-Texte je Version und Sprache hochladen; ein Cache wird erst gelöscht, wenn er ganz
    gesendet und archiviert ist."""
    jobs = cache_jobs(flavors)
    if not jobs:
        return Outcome("NPC-Texte: keine neuen im Spiel-Cache.")
    if not test:
        if not credentials:
            return Outcome("NPC-Texte: nicht angemeldet – bitte im Fenster unter „Konto“ anmelden.\n"
                           "  Die Texte bleiben bis dahin im Spiel-Cache.", failed=True)
        sign_in(site, credentials)

    lines, sent, failed = [], False, False
    for job in jobs:
        note = ""
        if job.too_long:
            note = (f"\n  {len(job.too_long)} zu lang (über {MAX_TEXT_LENGTH} Zeichen), vom Server "
                    "nicht annehmbar – sie stehen im Archiv.")
        if test:
            login = "" if credentials else " Anmeldung fehlt noch."
            lines.append(f"{job.label}: würde {job.count} Texte senden.{login}{note}")
            continue

        log(f"{job.label}: sende {job.count} …")
        info = {"versionen": [flavor_name(job.flavor)], "sprache": job.lang, "builds": sorted(job.by_build),
                "anzahl": job.count, "zu_lang": len(job.too_long)}
        try:
            total = send_cache(site, job, info)
        except UploadError as err:  # nichts gelöscht; die übrigen Caches laufen weiter
            _record_failure("npc-texte", {**info, "fehler": str(err)})
            lines.append(f"{err}\n  Der Cache bleibt liegen und geht beim nächsten Mal erneut mit.")
            failed = True
            continue
        except OSError as err:  # beim Archivieren oder Löschen; gesendet ist schon
            message = f"{job.label}: Dateifehler ({err})."
            _record_failure("npc-texte", {**info, "fehler": message})
            lines.append(f"{message}\n  Was vom Cache noch da ist, geht beim nächsten Mal erneut mit.")
            failed = True
            continue
        lines.append(f"{job.label}: {total['texts']} gesendet, {total['added']} neu, "
                     f"{total['changed']} aktualisiert. Cache gelöscht.{note}")
        sent = True
    return Outcome("\n".join(lines), sent=sent, failed=failed)


# ---------------------------------------------------------------- Ablauf

PARTS = (("Gesammelte Zeilen", "zeilen", upload_contributions),
         ("NPC-Texte", "npc-texte", upload_caches))


def run(wow: Path, credentials: dict | None, test: bool = False, log: Log = print) -> Report:
    """Ein ganzer Durchgang. test: nur zeigen, was gesendet würde – nichts senden, löschen, archivieren."""
    flavors = spoken_flavors(wow)
    if not flavors:
        return Report("Keine WoW-Version mit Spoken gefunden.", [f"Gesucht in: {wow}"], failed=True)

    # Eine laufende Version schreibt ihre Dateien erst beim Ausloggen und würde Geleertes
    # wieder überschreiben: sie wird übersprungen, die anderen laufen normal. Auch der
    # Testlauf prüft das, damit er zeigt, was ein echter Upload jetzt senden würde.
    running = system.running_flavors()
    if running is None:
        return Report("WoW läuft noch.", ["Welche Version, ist nicht zu erkennen – bitte das Spiel "
                                          "erst komplett beenden."], failed=True)
    skipped = [f for f in flavors if f.name.lower() in running]
    flavors = [f for f in flavors if f not in skipped]
    if not flavors:
        return Report("WoW läuft noch.", ["Bitte das Spiel erst komplett beenden: WoW schreibt die "
                                          "Dateien erst beim Ausloggen und würde die geleerte Liste "
                                          "sonst wieder überschreiben."], failed=True)
    sections = ["Geprüft: " + ", ".join(flavor_name(f) for f in flavors)]
    sections += [f"{flavor_name(f)}: übersprungen, läuft gerade – beim nächsten Mal nach dem Beenden "
                 "dabei." for f in skipped]

    site, failed, sent = Site(), False, False
    for label, kind, part in PARTS:
        try:
            outcome = part(site, flavors, credentials, test, log)
        except Exception as err:  # auch ein Programmfehler in einem Teil soll den anderen nicht verschlucken
            message = str(err) if isinstance(err, UploadError) else f"{label}: unerwarteter Fehler ({err!r})."
            outcome = Outcome(f"{message}\n  Nichts gelöscht, beim nächsten Mal wird es erneut versucht.",
                              failed=True)
            if not test:
                _record_failure(kind, {"versionen": [flavor_name(f) for f in flavors], "fehler": message})
        failed |= outcome.failed
        sent |= outcome.sent
        sections.append(outcome.text)

    if test:
        head = "Testlauf – nichts gesendet, gelöscht oder archiviert."
    elif failed:
        head = "Nicht alles hat geklappt."
    elif sent:
        head = "Erfolgreich hochgeladen – danke!"
    else:
        head = "Nichts Neues zum Hochladen."
    return Report(head, sections, failed)


def _record_failure(kind: str, info: dict):
    """Einen Fehlschlag im Verlauf vermerken; scheitert auch das, steht er immer noch im Ergebnis."""
    try:
        history.record(kind, {"status": "fehler", **info})
    except OSError:
        pass


def _count(value) -> int:
    """Zahl aus einer Server-Antwort; alles andere zählt als 0, statt nach dem Upload abzustürzen."""
    return value if isinstance(value, int) else 0
