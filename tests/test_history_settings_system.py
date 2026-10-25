"""Verlauf, Anmeldung und das Betriebssystem-Spezifische."""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

from helpers import FakeKeyring, Sandbox, contributions_lua, envelope

from spoken_contribute import history, settings, system


class History(Sandbox):
    def test_entries_newest_first_with_search_and_statistics(self):
        now = datetime.now().astimezone()
        history.record("zeilen", {"status": "ok", "versionen": ["Classic Era"], "anzahl": 2,
                                  "ergebnis": {"neu": 1, "bekannt": 1}},
                       payload={"gesendet": {"envelopes": [envelope(1), envelope(2)]}},
                       when=now - timedelta(days=1))
        history.record("npc-texte", {"status": "ok", "versionen": ["WoW Forever"], "sprache": "deDE",
                                     "anzahl": 1, "ergebnis": {"neu": 1, "aktualisiert": 0}},
                       payload={"gesendet": [{"lang": "deDE", "build": 1,
                                              "texts": [{"id": 9, "text": "Seid gegrüßt", "text1": ""}]}]},
                       when=now)
        history.record("zeilen", {"status": "fehler", "versionen": ["Classic Era"], "fehler": "Server-Fehler 500"})
        entries = history.entries()
        self.assertEqual([e.info["art"] for e in entries], ["zeilen", "npc-texte", "zeilen"])
        self.assertIn("quest 2", history.search_text(entries[2]))
        self.assertIn("seid gegrüßt".casefold(), history.search_text(entries[1]))

        stats = history.statistics(entries)
        self.assertEqual((stats.uploads, stats.failed, stats.lines, stats.texts), (2, 1, 2, 1))
        self.assertEqual(stats.per_version, {"Classic Era": [2, 0], "WoW Forever": [0, 1]})
        days = history.daily(entries, 30)
        self.assertEqual(len(days), 30)
        self.assertEqual(days[-1][1:], (0, 1))
        self.assertEqual(days[-2][1:], (2, 0))

    def test_old_archive_is_migrated(self):
        old = system.data_dir() / "2026-10-24_17-23-10_classic_era_ACC_SpokenContributions.lua"
        old.parent.mkdir(parents=True)
        old.write_bytes(contributions_lua([envelope(1)]))
        history.migrate_old_archive()
        [entry] = history.entries()
        self.assertEqual(entry.payload()["gesendet"]["envelopes"], [envelope(1)])
        self.assertFalse(old.exists())


class Login(Sandbox):
    def test_without_keyring_the_password_is_in_a_private_file(self):
        settings.save_login("a@b.c", "geheim")
        self.assertEqual(settings.credentials(), {"email": "a@b.c", "password": "geheim"})
        self.assertFalse(settings.password_in_keyring())
        if os.name == "posix":
            self.assertEqual(settings.LOGIN.stat().st_mode & 0o777, 0o600)

    def test_with_keyring_the_file_has_no_password(self):
        ring = FakeKeyring()
        with mock.patch.object(settings, "_keyring", lambda: ring):
            settings.save_login("a@b.c", "geheim")
            self.assertNotIn("geheim", settings.LOGIN.read_text(encoding="utf-8"))
            self.assertTrue(settings.password_in_keyring())
            self.assertEqual(settings.credentials()["password"], "geheim")
            settings.delete_login()
            self.assertEqual(ring.store, {})
            self.assertIsNone(settings.credentials())

    def test_old_password_moves_into_keyring(self):
        with mock.patch.object(settings, "_keyring", lambda: None):
            settings.save_login("a@b.c", "geheim")  # frühere Fassung: Passwort in der Datei
        ring = FakeKeyring()
        with mock.patch.object(settings, "_keyring", lambda: ring):
            settings.move_password_to_keyring()
            self.assertNotIn("geheim", settings.LOGIN.read_text(encoding="utf-8"))
            self.assertEqual(settings.credentials()["password"], "geheim")

    def test_locked_keyring_gives_no_password(self):
        ring = FakeKeyring()
        with mock.patch.object(settings, "_keyring", lambda: ring):
            settings.save_login("a@b.c", "geheim")
            ring.store.clear()
            self.assertEqual(settings.credentials(), {"email": "a@b.c", "password": None})


class RunningGame(unittest.TestCase):
    def flavors_for(self, program: str):
        with mock.patch.object(system, "_running_programs", return_value=[program]):
            return system.running_flavors()

    def test_paths_of_all_systems(self):
        cases = {
            r"C:\Program Files (x86)\World of Warcraft\_classic_era_\WoWClassic.exe": {"_classic_era_"},
            r"Z:\home\x\Games\World of Warcraft\_forever_\Wow.exe": {"_forever_"},
            "/Applications/World of Warcraft/_classic_era_/World of Warcraft Classic.app/Contents/MacOS/"
            "World of Warcraft Classic": {"_classic_era_"},
            r"C:\Program Files (x86)\World of Warcraft\_retail_\WowVoiceProxy.exe": set(),
            "/Applications/World of Warcraft/World of Warcraft Launcher.app/Contents/MacOS/"
            "World of Warcraft Launcher": set(),
            "/usr/bin/kate": set(),
            "Wow.exe": None,  # das Spiel läuft, aber der Ordner ist unbekannt
        }
        for program, expected in cases.items():
            with self.subTest(program=program):
                self.assertEqual(self.flavors_for(program), expected)


class WowFolder(Sandbox):
    def test_wow_root_from_inside_and_above(self):
        flavor = self.flavor()
        self.assertEqual(system.wow_root(flavor / "Interface/AddOns"), self.wow)
        self.assertEqual(system.wow_root(self.wow.parent), self.wow)
        self.assertIsNone(system.wow_root(Path(self.tmp / "leer")))


if __name__ == "__main__":
    unittest.main()
