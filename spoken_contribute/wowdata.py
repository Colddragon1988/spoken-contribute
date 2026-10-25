"""Was in einer WoW-Installation für Spoken liegt: welche Versionen Spoken haben, die
gesammelten Zeilen in SpokenContributions.lua und die NPC-Texte im Spiel-Cache (DBCache.bin)."""
from __future__ import annotations

import os
import re
import struct
from pathlib import Path

# Anzeigenamen der Installationsordner; unbekannte Ordner zeigen ihren Namen.
FLAVOR_NAMES = {"_classic_era_": "Classic Era", "_forever_": "WoW Forever", "_classic_": "Classic",
                "_anniversary_": "Anniversary", "_ptr_": "PTR", "_classic_ptr_": "Classic PTR"}

# Sprachen, in denen es WoW-Clients gibt (lib/lang.ts); der Ordnername ist die Sprache.
CLIENT_LOCALES = {"enUS", "enGB", "deDE", "esES", "esMX", "frFR", "koKR", "ptBR", "ruRU",
                  "zhCN", "zhTW"}


def flavor_name(flavor: Path) -> str:
    """„Classic Era“ für _classic_era_ usw."""
    return FLAVOR_NAMES.get(flavor.name.lower(), flavor.name.strip("_"))


def spoken_flavors(wow: Path) -> list[Path]:
    """Installationsordner mit Spoken. Versionen ohne Spoken bleiben außen vor – so auch Retail,
    dessen neuere Build-Nummern auf dem Server die Classic-Texte verdrängen würden."""
    return [d for d in sorted(wow.glob("_*_")) if (d / "Interface/AddOns/Spoken").is_dir()]


# ---------------------------------------------------------------- SpokenContributions.lua

CONTRIBUTIONS = "SpokenContributions.lua"
LITERAL = re.compile(rb'"((?:[^"\\]|\\[\s\S])*)"')
SIMPLE_ESCAPES = {b"n": 10, b"r": 13, b"t": 9, b"a": 7, b"b": 8, b"f": 12, b"v": 11,
                  b"\\": 92, b'"': 34, b"'": 39, b"\n": 10}
SOURCE_LABELS = {"quests": "Quest- und Gesprächszeilen", "books": "Buchseiten", "readables": "Buchseiten"}


def decode_lua(body: bytes) -> str:
    """Lua-String-Literal entschlüsseln, genau wie decodeLuaString auf der Website."""
    out = bytearray()
    i = 0
    while i < len(body):
        if body[i] != 0x5C:  # kein Backslash
            out.append(body[i])
            i += 1
            continue
        digits = re.match(rb"\d{1,3}", body[i + 1:i + 4])
        if digits:  # \ddd: ein Byte, dezimal
            out.append(int(digits.group()) & 0xFF)
            i += 1 + len(digits.group())
        elif body[i + 1:i + 3] == b"\r\n":  # Backslash am Zeilenende (Windows-Zeilenende)
            out.append(10)
            i += 3
        elif body[i + 1:i + 2] in SIMPLE_ESCAPES:
            out.append(SIMPLE_ESCAPES[body[i + 1:i + 2]])
            i += 2
        else:  # unbekannte Folge: Backslash bleibt stehen
            out.append(0x5C)
            i += 1
    return out.decode("utf-8", errors="replace")


def backup_of(lua: Path) -> Path:
    """WoWs Sicherungskopie neben der Datei (vom vorletzten Speichern)."""
    return lua.with_name(lua.name + ".bak")


def contribution_files(flavor: Path) -> list[Path]:
    """Alle SpokenContributions.lua einer Version. Auch eine .bak ohne zugehörige .lua zählt:
    sie kann Zeilen enthalten, die sonst fehlen."""
    found = flavor.glob(f"WTF/Account/*/SavedVariables/{CONTRIBUTIONS}*")
    return sorted({f.with_name(CONTRIBUTIONS) for f in found
                   if f.name in (CONTRIBUTIONS, CONTRIBUTIONS + ".bak")})


def envelopes_in(path: Path) -> list[str]:
    """Alle "!SPOKEN…"-Umschläge in einer Datei; fehlt sie, keine."""
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return []
    return [decode_lua(m.group(1)) for m in LITERAL.finditer(data) if m.group(1).startswith(b"!SPOKEN")]


def collect_contributions(flavors: list[Path]) -> list[tuple[Path, Path, list[str]]]:
    """(Version, .lua, Umschläge aus .lua und .bak ohne Doppelte) je Datei, die es gibt."""
    stores = []
    for flavor in flavors:
        for lua in contribution_files(flavor):
            envelopes = envelopes_in(lua) + envelopes_in(backup_of(lua))
            stores.append((flavor, lua, list(dict.fromkeys(envelopes))))
    return stores


def parse_envelope(envelope: str) -> dict[str, str]:
    """Die Felder eines Umschlags, z. B. {"source": "quests", "title": …, "npc": …, "text": …}.
    Aufbau: Kopfzeile "!SPOKEN1 <Art>", dann "schlüssel=wert" oder "schlüssel<<" … ">>"."""
    first, *rest = envelope.split("\n")
    fields = {"source": first.split(" ", 1)[1] if " " in first else "?"}
    lines = iter(rest)
    for line in lines:
        if line.endswith("<<"):
            block = []
            for inner in lines:
                if inner == ">>":
                    break
                block.append(inner)
            fields.setdefault(line[:-2], "\n".join(block))
        elif "=" in line:
            key, value = line.split("=", 1)
            fields.setdefault(key, value)
    return fields


def summarize(envelopes: list[str]) -> tuple[str, list[str]]:
    """("12 Quest- und Gesprächszeilen, 3 Buchseiten", [Titel der Quests und Bücher])."""
    counts, titles = {}, []
    for envelope in envelopes:
        fields = parse_envelope(envelope)
        counts[fields["source"]] = counts.get(fields["source"], 0) + 1
        title = fields.get("title") or fields.get("book")
        if title and title not in titles:
            titles.append(title)
    kinds = ", ".join(f"{n} {SOURCE_LABELS.get(source, source)}" for source, n in counts.items())
    return kinds, titles


def cleared(text: str) -> str:
    """Die Datei ohne gesammelte Zeilen; die Schalter Enabled/Introduced bleiben erhalten.
    WoW schreibt die Datei unter Windows und Wine mit Windows-Zeilenenden, daher das optionale \\r."""
    keep = re.findall(r'^(\["(?:Enabled|Introduced)"\] = (?:true|false),)\r?$', text, re.M)
    return "\nSpokenContributionsDB = {\n" + "".join(k + "\n" for k in keep) + '["Lines"] = {\n},\n}\n'


def clear_contributions(files: list[Path], sent: set[str]) -> list[Path]:
    """Die gesammelten Zeilen aus den .lua-Dateien entfernen und WoWs .bak-Kopien löschen.

    Die Dateien werden dafür noch einmal gelesen. Steht darin inzwischen ein Umschlag, der
    nicht gesendet wurde, bleiben .lua und .bak unberührt – lieber einmal doppelt senden als
    etwas verlieren. Ergebnis: die Dateien, die deshalb liegen geblieben sind."""
    kept = []
    for lua in files:
        if not set(envelopes_in(lua) + envelopes_in(backup_of(lua))) <= sent:
            kept.append(lua)
            continue
        if lua.exists():
            # Erst in eine Nachbardatei schreiben und dann ersetzen: bricht etwas ab, bleibt
            # die alte Datei vollständig statt halb geschrieben.
            tmp = lua.with_name(lua.name + ".spoken-tmp")
            tmp.write_bytes(cleared(lua.read_text(encoding="utf-8", errors="replace")).encode("utf-8"))
            os.replace(tmp, lua)
        backup_of(lua).unlink(missing_ok=True)
    return kept


# ---------------------------------------------------------------- DBCache.bin

# Aufbau (wie lib/broadcast/cache.ts auf der Website): 44 Byte Dateikopf mit MAGIC am Anfang
# und der Build-Nummer bei Byte 8, dann Einträge aus 32 Byte Kopf (MAGIC; bei Byte 16
# Tabelle, Zeilen-ID, Länge, Status) und den Daten. BroadcastText-Daten beginnen mit zwei
# nullterminierten Texten (männlich, weiblich); nur Status 1 ist ein gültiger Eintrag.
MAGIC = 0x48544658  # "XFTH"
BROADCAST_TEXT = 0x021826BB
FILE_HEADER, ENTRY_HEADER = 44, 32


def cache_folders(flavors: list[Path]) -> list[Path]:
    """Cache/ADB/<Sprache> aller Versionen, z. B. …/_classic_era_/Cache/ADB/deDE."""
    return [d for flavor in flavors for d in sorted(flavor.glob("Cache/ADB/*")) if d.name in CLIENT_LOCALES]


def cache_files(folder: Path) -> list[Path]:
    """DBCache.bin und die Zwischenstände, die WoW daneben ablegt (DBCache.bin1652.tmp …)."""
    return sorted(folder.glob("DBCache.bin*"))


def parse_cache(path: Path) -> tuple[int, dict[int, dict]]:
    """(Build, {ID: Zeile}) der BroadcastText-Einträge einer DBCache-Datei."""
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return 0, {}
    if len(data) < FILE_HEADER or struct.unpack_from("<I", data, 0)[0] != MAGIC:
        return 0, {}
    build = struct.unpack_from("<I", data, 8)[0]
    texts, pos = {}, FILE_HEADER
    while pos + ENTRY_HEADER <= len(data):
        if struct.unpack_from("<I", data, pos)[0] != MAGIC:
            break  # während des Schreibens abgebrochen; alles davor ist vollständig
        table, rid, size, status = struct.unpack_from("<IIII", data, pos + 16)
        start, pos = pos + ENTRY_HEADER, pos + ENTRY_HEADER + size
        if pos > len(data):
            break
        if table != BROADCAST_TEXT or status != 1:
            continue
        end = data.find(b"\0", start, pos)
        end1 = data.find(b"\0", end + 1, pos) if end >= 0 else -1
        if end < 0 or end1 < 0:
            continue
        text = data[start:end].decode("utf-8", errors="replace")
        text1 = data[end + 1:end1].decode("utf-8", errors="replace")
        if text or text1:
            texts[rid] = {"id": rid, "text": text, "text1": text1}
    return build, texts


def newest_texts(files: list[Path]) -> dict[int, list[dict]]:
    """{Build: Zeilen} über alle Dateien einer Sprache; je ID gewinnt der neueste Build."""
    newest: dict[int, tuple[int, dict]] = {}
    for f in files:
        build, texts = parse_cache(f)
        for rid, row in texts.items():
            if rid not in newest or build >= newest[rid][0]:
                newest[rid] = (build, row)
    by_build: dict[int, list[dict]] = {}
    for build, row in newest.values():
        by_build.setdefault(build, []).append(row)
    return by_build
