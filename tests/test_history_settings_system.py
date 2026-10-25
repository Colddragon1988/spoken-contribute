"""Verlauf, Anmeldung und das Betriebssystem-Spezifische."""
from __future__ import annotations

import contextlib
import io
import json
import os
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

from helpers import FakeKeyring, Sandbox, contributions_lua, envelope

from spoken_contribute import history, main, settings, system


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
        history.record("zeilen", {"status": "fehler", "versionen": ["Classic Era"], "fehler": "Server-Fehler 500"},
                       when=now + timedelta(seconds=1))  # eigene Sekunde, sonst ist die Reihenfolge offen
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

    def test_entry_without_time_zone_or_broken_is_still_sortable(self):
        history.record("zeilen", {"status": "ok", "anzahl": 1})
        for name, info in (("ohne-zone", {"zeit": "2026-10-20T10:00:00", "art": "zeilen"}),
                           ("liste", ["kein", "dict"]), ("ohne-zeit", {"art": "zeilen"})):
            folder = history.ROOT / name
            folder.mkdir()
            (folder / history.INFO).write_text(json.dumps(info), encoding="utf-8")
        found = history.entries()
        self.assertEqual(len(found), 2)
        self.assertEqual(found[-1].folder.name, "ohne-zone")

    def test_old_archive_is_migrated(self):
        old = system.data_dir() / "2026-10-24_17-23-10_classic_era_ACC_SpokenContributions.lua"
        old.parent.mkdir(parents=True)
        old.write_bytes(contributions_lua([envelope(1)]))
        history.migrate_old_archive()
        [entry] = history.entries()
        self.assertEqual(entry.payload()["gesendet"]["envelopes"], [envelope(1)])
        self.assertFalse(old.exists())


    def test_old_archive_with_impossible_time_stays_put(self):
        good = system.data_dir() / "2026-10-24_17-23-10_ACC_SpokenContributions.lua"
        bad = system.data_dir() / "2026-13-45_17-23-10_ACC_SpokenContributions.lua"
        good.parent.mkdir(parents=True)
        for path in (good, bad):
            path.write_bytes(contributions_lua([envelope(1)]))
        history.migrate_old_archive()
        self.assertEqual(len(history.entries()), 1)
        self.assertFalse(good.exists())
        self.assertTrue(bad.exists())


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
            self.assertTrue(settings.delete_login())
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

    def test_password_stays_in_file_while_keyring_is_locked(self):
        settings.save_login("a@b.c", "geheim")  # ohne Schlüsselbund: in der Datei
        ring = FakeKeyring()
        ring.locked = True
        with mock.patch.object(settings, "_keyring", lambda: ring):
            settings.move_password_to_keyring()
        self.assertEqual(settings.credentials()["password"], "geheim")

    def test_password_stays_in_file_when_keyring_loses_it(self):
        settings.save_login("a@b.c", "geheim")
        ring = FakeKeyring()
        ring.set_password = lambda *_args: None  # meldet Erfolg, speichert aber nichts
        with mock.patch.object(settings, "_keyring", lambda: ring):
            settings.move_password_to_keyring()
        self.assertEqual(settings.credentials()["password"], "geheim")

    def test_password_survives_when_login_file_cannot_be_rewritten(self):
        settings.save_login("a@b.c", "geheim")
        ring = FakeKeyring()
        with mock.patch.object(settings, "_keyring", lambda: ring), \
                mock.patch.object(system, "write_file", side_effect=OSError("schreibgeschützt")):
            with self.assertRaises(OSError):
                settings.move_password_to_keyring()
        self.assertIn("geheim", settings.LOGIN.read_text(encoding="utf-8"))

    def test_logout_with_locked_keyring_reports_the_leftover(self):
        ring = FakeKeyring()
        with mock.patch.object(settings, "_keyring", lambda: ring):
            settings.save_login("a@b.c", "geheim")
            ring.locked = True
            self.assertFalse(settings.delete_login())
        self.assertIsNone(settings.account())  # abgemeldet ist man trotzdem

    def test_logout_without_keyring_entry_is_clean(self):
        settings.save_login("a@b.c", "geheim")  # Passwort in der Datei
        self.assertTrue(settings.delete_login())
        self.assertFalse(settings.LOGIN.exists())

    def test_new_account_replaces_the_old_keyring_entry(self):
        ring = FakeKeyring()
        with mock.patch.object(settings, "_keyring", lambda: ring):
            settings.save_login("alt@b.c", "eins")
            settings.save_login("neu@b.c", "zwei")
            self.assertEqual(list(ring.store), [(settings.KEYRING_SERVICE, "neu@b.c")])
            self.assertEqual(settings.credentials(), {"email": "neu@b.c", "password": "zwei"})

    def test_locked_keyring_gives_no_password(self):
        ring = FakeKeyring()
        with mock.patch.object(settings, "_keyring", lambda: ring):
            settings.save_login("a@b.c", "geheim")
            ring.store.clear()
            self.assertEqual(settings.credentials(), {"email": "a@b.c", "password": None})


class CommandLine(Sandbox):
    def run_main(self, *args: str) -> int:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return main.main(list(args))

    def test_test_run_changes_nothing(self):
        """--test verspricht, nichts zu verändern: auch kein Archiv-Umzug und kein Passwort-Umzug."""
        old = system.data_dir() / "2026-10-24_17-23-10_ACC_SpokenContributions.lua"
        old.parent.mkdir(parents=True)
        old.write_bytes(contributions_lua([envelope(1)]))
        settings.save_login("a@b.c", "geheim")
        ring = FakeKeyring()
        with mock.patch.object(settings, "_keyring", lambda: ring):
            self.assertEqual(self.run_main("--test"), 1)  # kein WoW-Ordner eingetragen
        self.assertTrue(old.exists())
        self.assertEqual(ring.store, {})

    def test_unknown_argument(self):
        self.assertEqual(self.run_main("--gibts-nicht"), 2)
        self.assertEqual(self.run_main("--help"), 0)


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
