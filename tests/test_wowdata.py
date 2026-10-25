"""Lesen und Leeren der WoW-Dateien."""
from __future__ import annotations

import unittest

from helpers import Sandbox, contributions_lua, dbcache, envelope

from spoken_contribute import wowdata


class DecodeLua(unittest.TestCase):
    def test_escapes(self):
        self.assertEqual(wowdata.decode_lua(rb'a\nb\"c\\d\065\228'), 'a\nb"c\\dA�')
        self.assertEqual(wowdata.decode_lua(b"x\\\r\ny"), "x\ny")  # Backslash vor Windows-Zeilenende

    def test_utf8_bytes_as_decimal_escapes(self):
        self.assertEqual(wowdata.decode_lua(rb"\195\164"), "ä")


class Contributions(Sandbox):
    def test_envelopes_survive_the_lua_file_bit_exact(self):
        originals = [envelope(1), envelope(2, "books"), envelope(3, text="Zeile 1\nZeile 2 \\n kein Umbruch")]
        lua = self.lua(self.flavor())
        lua.write_bytes(contributions_lua(originals))
        self.assertEqual(wowdata.envelopes_in(lua), originals)

    def test_lua_and_bak_are_merged_without_duplicates(self):
        flavor = self.flavor()
        lua = self.lua(flavor)
        lua.write_bytes(contributions_lua([envelope(1), envelope(2)]))
        wowdata.backup_of(lua).write_bytes(contributions_lua([envelope(2), envelope(3)]))
        [(_, path, envelopes)] = wowdata.collect_contributions([flavor])
        self.assertEqual(path, lua)
        self.assertEqual(envelopes, [envelope(1), envelope(2), envelope(3)])

    def test_bak_without_lua_counts(self):
        flavor = self.flavor()
        lua = self.lua(flavor)
        wowdata.backup_of(lua).write_bytes(contributions_lua([envelope(7)]))
        self.assertEqual(wowdata.collect_contributions([flavor])[0][2], [envelope(7)])

    def test_clearing_keeps_flags_with_crlf(self):
        lua = self.lua(self.flavor())
        lua.write_bytes(contributions_lua([envelope(1)], crlf=True))
        wowdata.backup_of(lua).write_bytes(contributions_lua([envelope(1)]))
        self.assertEqual(wowdata.clear_contributions([lua], {envelope(1)}), [])
        text = lua.read_text(encoding="utf-8")
        self.assertIn('["Enabled"] = true,', text)
        self.assertIn('["Introduced"] = false,', text)
        self.assertEqual(wowdata.envelopes_in(lua), [])
        self.assertFalse(wowdata.backup_of(lua).exists())

    def test_file_with_unsent_lines_is_not_cleared(self):
        lua = self.lua(self.flavor())
        lua.write_bytes(contributions_lua([envelope(1), envelope(2)]))
        self.assertEqual(wowdata.clear_contributions([lua], {envelope(1)}), [lua])
        self.assertEqual(len(wowdata.envelopes_in(lua)), 2)

    def test_parse_envelope_and_summary(self):
        fields = wowdata.parse_envelope(envelope(5))
        self.assertEqual((fields["source"], fields["title"], fields["event"]), ("quests", "Quest 5", "progress"))
        self.assertTrue(fields["text"].startswith("Text 5"))
        kinds, titles = wowdata.summarize([envelope(1), envelope(2, "books")])
        self.assertEqual(kinds, "1 Quest- und Gesprächszeilen, 1 Buchseiten")
        self.assertEqual(titles, ["Quest 1", "Buch 2"])


class Cache(Sandbox):
    def test_reads_only_live_broadcast_texts(self):
        path = self.cache(self.flavor())
        data = dbcache(70003, [(1, "Hallo", "Hallo"), (2, "Er", "Sie")])
        data += dbcache(70003, [(3, "gelöscht", "")], status=2)[44:]
        data += dbcache(70003, [(4, "andere Tabelle", "")], table=0x12345678)[44:]
        path.write_bytes(data)
        build, texts = wowdata.parse_cache(path)
        self.assertEqual(build, 70003)
        self.assertEqual(sorted(texts), [1, 2])
        self.assertEqual(texts[2], {"id": 2, "text": "Er", "text1": "Sie"})

    def test_broken_files_do_not_crash(self):
        path = self.cache(self.flavor())
        for data in (b"", b"kaputt", dbcache(1, [(1, "a", "b")])[:-5], b"XFTH" + bytes(60)):
            path.write_bytes(data)
            wowdata.parse_cache(path)

    def test_newest_build_wins(self):
        folder = self.cache(self.flavor()).parent
        (folder / "DBCache.bin").write_bytes(dbcache(70003, [(1, "neu", "")]))
        (folder / "DBCache.bin1652.tmp").write_bytes(dbcache(60000, [(1, "alt", ""), (2, "nur alt", "")]))
        by_build = wowdata.newest_texts(wowdata.cache_files(folder))
        self.assertEqual([r["text"] for r in by_build[70003]], ["neu"])
        self.assertEqual([r["text"] for r in by_build[60000]], ["nur alt"])


if __name__ == "__main__":
    unittest.main()
