"""Gemeinsames für die Tests: ein nachgebauter WoW-Ordner, ein vorgetäuschter Server und
abgeschottete Ordner für Einstellungen und Archiv – kein Test fasst echte Daten an oder
spricht mit spoken.rusty.one."""
from __future__ import annotations

import shutil
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from spoken_contribute import api, history, limits, settings, system  # noqa: E402

BROADCAST_TEXT = 0x021826BB


def envelope(n: int, source: str = "quests", text: str | None = None) -> str:
    """Ein Umschlag wie vom Addon; die Prüfsumme ist egal, der Server ist vorgetäuscht."""
    title = f"Quest {n}" if source == "quests" else f"Buch {n}"
    key = "title" if source == "quests" else "book"
    body = text if text is not None else f"Text {n} mit Ümläuten, \"Zitat\" und \\Backslash"
    return (f"!SPOKEN1 {source}\nquest={n}\nevent=progress\nnpc={n} Händler {n}\n{key}={title}\n"
            f"text<<\n{body}\n>>\nsum={n}\n")


def lua_string(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def contributions_lua(envelopes: list[str], crlf: bool = True, flags: bool = True) -> bytes:
    """Eine SpokenContributions.lua, wie WoW sie schreibt (unter Windows/Wine mit CRLF)."""
    lines = ["", "SpokenContributionsDB = {"]
    if flags:
        lines.append('["Enabled"] = true,')
    lines.append('["Lines"] = {')
    for i, env in enumerate(envelopes):
        lines += ["{", f'["key"] = "k{i}",', f'["envelope"] = {lua_string(env)},', "},"]
    lines.append("},")
    if flags:
        lines.append('["Introduced"] = false,')
    lines += ["}", ""]
    return ("\r\n" if crlf else "\n").join(lines).encode("utf-8")


def dbcache(build: int, rows: list[tuple[int, str, str]], status: int = 1, table: int = BROADCAST_TEXT) -> bytes:
    """Eine DBCache.bin mit BroadcastText-Einträgen (id, männlich, weiblich)."""
    data = b"XFTH" + struct.pack("<II", 1, build) + bytes(32)
    for rid, text, text1 in rows:
        row = text.encode() + b"\0" + text1.encode() + b"\0" + bytes(8)
        data += b"XFTH" + struct.pack("<IIIIIII", 0, 0, 0, table, rid, len(row), status) + row
    return data


class FakeKeyring:
    """Ersatz für das Modul keyring."""
    priority = 1

    def __init__(self):
        self.store = {}

    def get_password(self, service, user):
        return self.store.get((service, user))

    def set_password(self, service, user, password):
        self.store[(service, user)] = password

    def delete_password(self, service, user):
        self.store.pop((service, user))


class FakeServer:
    """Antwortet wie spoken.rusty.one; `fail` = {Pfad: [Fehler oder None, …]} je Aufruf."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.fail: dict[str, list] = {}
        self.on_post = None  # wird bei jedem Aufruf vor der Antwort ausgeführt

    def post(self, path, payload, what):
        self.calls.append((path, payload))
        if self.on_post:
            self.on_post(path, payload)
        planned = self.fail.get(path)
        if planned:
            error = planned.pop(0)
            if error:
                raise error
        if path == "/api/auth/sign-in/email":
            return {"user": {"email": payload["email"]}}
        if path == "/api/contributions/batch":
            n = len(payload["envelopes"])
            return {"ok": True, "accepted": n, "known": 1, "counted": n, "refused": {}}
        return {"texts": len(payload["texts"]), "added": len(payload["texts"]), "changed": 0}

    def paths(self) -> list[str]:
        return [path for path, _ in self.calls]


class Sandbox(unittest.TestCase):
    """Jeder Test bekommt eigene Ordner, einen WoW-Ordner und einen vorgetäuschten Server."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="spoken-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        data, config = self.tmp / "data", self.tmp / "config"
        self.server = FakeServer()
        self.running: set[str] | None = set()
        for patch in (mock.patch.object(settings, "SETTINGS", config / "settings.json"),
                      mock.patch.object(settings, "LOGIN", config / "login.json"),
                      mock.patch.object(settings, "_keyring", lambda: None),
                      mock.patch.object(history, "ROOT", data / "verlauf"),
                      mock.patch.object(limits, "FILE", data / "upload-zeiten.json"),
                      mock.patch.object(system, "data_dir", lambda: data),
                      mock.patch.object(system, "running_flavors", lambda: self.running),
                      mock.patch.object(api.Site, "post",
                                        lambda _site, path, payload, what: self.server.post(path, payload, what))):
            patch.start()
            self.addCleanup(patch.stop)
        self.wow = self.tmp / "World of Warcraft"
        self.credentials = {"email": "test@example.org", "password": "geheim"}

    def flavor(self, name: str = "_classic_era_", spoken: bool = True) -> Path:
        folder = self.wow / name
        (folder / "WTF").mkdir(parents=True, exist_ok=True)
        if spoken:
            (folder / "Interface/AddOns/Spoken").mkdir(parents=True, exist_ok=True)
        return folder

    def lua(self, flavor: Path, account: str = "ACC") -> Path:
        path = flavor / "WTF/Account" / account / "SavedVariables/SpokenContributions.lua"
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def cache(self, flavor: Path, lang: str = "deDE") -> Path:
        folder = flavor / "Cache/ADB" / lang
        folder.mkdir(parents=True, exist_ok=True)
        return folder / "DBCache.bin"
