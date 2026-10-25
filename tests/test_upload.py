"""Ganze Upload-Durchgänge gegen einen vorgetäuschten Server."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta

from helpers import Sandbox, contributions_lua, dbcache, envelope

from spoken_contribute import history, limits, upload, wowdata
from spoken_contribute.api import UploadError

BATCH = "/api/contributions/batch"
TEXTS = "/api/broadcast-text"


class Contributions(Sandbox):
    def setUp(self):
        super().setUp()
        self.lua = self.lua(self.flavor())

    def run_upload(self, **options):
        return upload.run(self.wow, self.credentials, log=lambda _text: None, **options)

    def test_success_sends_archives_and_clears(self):
        envelopes = [envelope(i) for i in range(3)]
        self.lua.write_bytes(contributions_lua(envelopes))
        report = self.run_upload()
        self.assertFalse(report.failed, report.text())
        [(path, payload)] = self.server.calls
        self.assertEqual(path, BATCH)
        self.assertEqual(payload["envelopes"], envelopes)
        self.assertEqual(wowdata.envelopes_in(self.lua), [])
        [entry] = history.entries()
        self.assertEqual(entry.payload()["gesendet"]["envelopes"], envelopes)
        self.assertEqual(entry.info["ergebnis"], {"neu": 2, "bekannt": 1, "abgelehnt": 0})
        self.assertEqual(wowdata.envelopes_in(entry.folder / "originale/classic_era/ACC/SpokenContributions.lua"),
                         envelopes)
        self.assertEqual(self.run_upload().head, "Nichts Neues zum Hochladen.")

    def test_server_error_keeps_everything(self):
        self.lua.write_bytes(contributions_lua([envelope(1)]))
        self.server.fail[BATCH] = [UploadError("Gesammelte Zeilen: Server-Fehler 500.", 500)]
        report = self.run_upload()
        self.assertTrue(report.failed)
        self.assertEqual(wowdata.envelopes_in(self.lua), [envelope(1)])
        self.assertTrue(history.entries()[0].failed)

    def test_more_than_2000_lines_go_in_several_uploads(self):
        self.lua.write_bytes(contributions_lua([envelope(i) for i in range(1500)]))
        wowdata.backup_of(self.lua).write_bytes(contributions_lua([envelope(i) for i in range(1000, 2500)]))
        report = self.run_upload()
        self.assertFalse(report.failed, report.text())
        self.assertEqual([len(p["envelopes"]) for _, p in self.server.calls], [2000, 500])
        self.assertEqual(wowdata.envelopes_in(self.lua), [])

    def test_failure_in_second_upload_clears_nothing(self):
        self.lua.write_bytes(contributions_lua([envelope(i) for i in range(2500)]))
        self.server.fail[BATCH] = [None, UploadError("Gesammelte Zeilen: Server-Fehler 502.", 502)]
        self.assertTrue(self.run_upload().failed)
        self.assertEqual(len(wowdata.envelopes_in(self.lua)), 2500)

    def test_lines_added_during_upload_are_kept(self):
        self.lua.write_bytes(contributions_lua([envelope(1)]))

        def game_writes(path, _payload):
            if path == BATCH:
                self.lua.write_bytes(contributions_lua([envelope(1), envelope(2)]))

        self.server.on_post = game_writes
        report = self.run_upload()
        self.assertIn("verändert", report.text())
        self.assertEqual(len(wowdata.envelopes_in(self.lua)), 2)

    def test_dry_run_changes_nothing(self):
        self.lua.write_bytes(contributions_lua([envelope(1)]))
        report = self.run_upload(test=True)
        self.assertIn("würde", report.text())
        self.assertEqual(self.server.calls, [])
        self.assertEqual(history.entries(), [])
        self.assertEqual(wowdata.envelopes_in(self.lua), [envelope(1)])


class RateLimit(Sandbox):
    def setUp(self):
        super().setUp()
        self.lua = self.lua(self.flavor())
        self.lua.write_bytes(contributions_lua([envelope(1)]))

    def test_uploads_are_counted(self):
        upload.run(self.wow, None, log=lambda _t: None)
        self.assertEqual(limits.remaining(), limits.PER_HOUR - 1)

    def test_full_hour_blocks_without_asking_the_server(self):
        for _ in range(limits.PER_HOUR):
            limits.note_upload()
        report = upload.run(self.wow, None, log=lambda _t: None)
        self.assertTrue(report.failed)
        self.assertIn("Upload-Grenze erreicht", report.text())
        self.assertEqual(self.server.calls, [])
        self.assertEqual(wowdata.envelopes_in(self.lua), [envelope(1)])
        self.assertIsNotNone(limits.free_at())

    def test_429_marks_the_hour_as_full(self):
        self.server.fail[BATCH] = [UploadError("zu viele", 429)]
        upload.run(self.wow, None, log=lambda _t: None)
        self.assertEqual(limits.remaining(), 0)

    def test_old_uploads_expire(self):
        old = datetime.now().astimezone() - timedelta(hours=2)
        limits._save([old] * limits.PER_HOUR)
        self.assertEqual(limits.remaining(), limits.PER_HOUR)


class NpcTexts(Sandbox):
    def setUp(self):
        super().setUp()
        self.era, self.forever = self.flavor("_classic_era_"), self.flavor("_forever_")
        self.cache(self.era).write_bytes(dbcache(70003, [(1, "Hallo", ""), (2, "x" * 4001, "")]))
        self.cache(self.forever).write_bytes(dbcache(60000, [(3, "Moin", "")]))

    def test_success_archives_and_deletes_cache(self):
        report = upload.run(self.wow, self.credentials, log=lambda _t: None)
        self.assertFalse(report.failed, report.text())
        self.assertEqual(self.server.paths(), ["/api/auth/sign-in/email", TEXTS, TEXTS])
        self.assertFalse(self.cache(self.era).exists())
        sent = [p["texts"] for path, p in self.server.calls if path == TEXTS]
        self.assertEqual(sent, [[{"id": 1, "text": "Hallo", "text1": ""}], [{"id": 3, "text": "Moin", "text1": ""}]])
        era = next(e for e in history.entries() if e.info["versionen"] == ["Classic Era"])
        self.assertEqual(era.info["zu_lang"], 1)
        self.assertEqual(len(era.payload()["nicht_gesendet"]), 1)  # zu lang, aber nicht verloren

    def test_failure_in_one_version_keeps_its_cache(self):
        self.server.fail[TEXTS] = [None, UploadError("NPC-Texte: Server-Fehler 500.", 500)]
        report = upload.run(self.wow, self.credentials, log=lambda _t: None)
        self.assertTrue(report.failed)
        self.assertFalse(self.cache(self.era).exists())
        self.assertTrue(self.cache(self.forever).exists())

    def test_not_logged_in_keeps_cache(self):
        report = upload.run(self.wow, None, log=lambda _t: None)
        self.assertIn("nicht angemeldet", report.text())
        self.assertTrue(self.cache(self.era).exists())

    def test_password_missing_from_keyring_keeps_cache(self):
        report = upload.run(self.wow, {"email": "a@b.c", "password": None}, log=lambda _t: None)
        self.assertIn("Schlüsselbund", report.text())
        self.assertTrue(self.cache(self.era).exists())

    def test_rejected_login(self):
        self.server.fail["/api/auth/sign-in/email"] = [UploadError("Anmeldung abgelehnt", 401)]
        report = upload.run(self.wow, self.credentials, log=lambda _t: None)
        self.assertIn("ab- und neu anmelden", report.text())
        self.assertTrue(self.cache(self.era).exists())


class RunningGame(Sandbox):
    def setUp(self):
        super().setUp()
        self.era, self.forever = self.flavor("_classic_era_"), self.flavor("_forever_")
        self.lua(self.era).write_bytes(contributions_lua([envelope(1)]))
        self.lua(self.forever).write_bytes(contributions_lua([envelope(2), envelope(3)]))

    def test_running_version_is_skipped(self):
        self.running = {"_classic_era_"}
        report = upload.run(self.wow, None, log=lambda _t: None)
        self.assertIn("Classic Era: übersprungen", report.text())
        self.assertEqual(self.server.calls[0][1]["envelopes"], [envelope(2), envelope(3)])
        self.assertEqual(wowdata.envelopes_in(self.lua(self.era)), [envelope(1)])

    def test_unknown_running_version_stops(self):
        self.running = None
        self.assertTrue(upload.run(self.wow, None, log=lambda _t: None).failed)
        self.assertEqual(self.server.calls, [])

    def test_overview_leaves_out_running_versions(self):
        self.running = {"_classic_era_"}
        overview = upload.overview(self.wow)
        self.assertEqual(overview.lines, 2)
        self.assertEqual(len(overview.flavors), 2)


if __name__ == "__main__":
    unittest.main()
