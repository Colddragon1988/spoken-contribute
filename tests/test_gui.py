"""Das Fenster: Design-Wechsel und Suche im Verlauf. Ohne Bildschirm (etwa unter Linux in der CI
ohne Xvfb) werden die Tests übersprungen."""
from __future__ import annotations

import gc
import time
import unittest
from unittest import mock

from helpers import Sandbox, envelope

from spoken_contribute import history, system, theme

try:
    import tkinter as tk
    from spoken_contribute import gui
except ImportError:  # tkinter fehlt
    tk = None


class Window(Sandbox):
    def setUp(self):
        super().setUp()
        if tk is None:
            self.skipTest("tkinter fehlt")
        try:
            self.root = tk.Tk()
        except tk.TclError as err:
            self.skipTest(f"kein Bildschirm ({err})")
        self.addCleanup(self.close_window)
        self.root.withdraw()
        # nicht das System fragen: in der CI gibt es kein Desktop-Design
        patch = mock.patch.object(system, "prefers_dark", lambda: False)
        patch.start()
        self.addCleanup(patch.stop)
        self.app = gui.App(self.root)

    def close_window(self):
        for job in self.root.tk.splitlist(self.root.tk.call("after", "info")):
            self.root.after_cancel(job)  # sonst meldet Tk beim nächsten Test „invalid command name“
        self.root.destroy()
        # Die StringVars des Hauptfensters jetzt abräumen, im Haupt-Thread. Sonst geschieht das
        # irgendwann in einem Hintergrund-Thread eines späteren Tests, und dort wartet jede
        # StringVar eine Sekunde auf eine mainloop, die es in Tests nicht gibt.
        gc.collect()

    def wait_for(self, condition, seconds: float = 5):
        """Ereignisse abarbeiten, bis condition() gilt – Hintergrund-Threads melden sich über poll."""
        deadline = time.monotonic() + seconds
        while not condition():
            if time.monotonic() > deadline:
                self.fail("Zeit abgelaufen")
            self.root.update()
            time.sleep(0.01)

    def test_late_answer_for_an_old_theme_setting_is_ignored(self):
        self.app.settings.theme = "dunkel"
        self.app.theme_chosen("dunkel", theme.DARK)
        self.app.theme_chosen("system", theme.LIGHT)  # die langsame Systemabfrage von vorhin
        self.assertEqual(self.app.palette, theme.DARK)

    def test_dropdown_list_follows_the_theme(self):
        window = gui.HistoryWindow(self.app)
        combobox = window.versions
        popdown = combobox.tk.call("ttk::combobox::PopdownWindow", combobox)
        self.app.palette = theme.DARK
        self.app.apply_theme()
        self.assertEqual(combobox.tk.call(f"{popdown}.f.l", "cget", "-background"), theme.DARK.field)

    def test_search_finds_text_in_the_sent_data(self):
        history.record("zeilen", {"status": "ok", "versionen": ["Classic Era"], "anzahl": 1},
                       payload={"gesendet": {"envelopes": [envelope(1)]}})
        texts = [{"id": i, "text": f"Seid gegrüßt {i}", "text1": ""} for i in range(3000)]
        history.record("npc-texte", {"status": "ok", "versionen": ["WoW Forever"], "anzahl": 3000},
                       payload={"gesendet": [{"lang": "deDE", "build": 1, "texts": texts}]})
        window = gui.HistoryWindow(self.app)
        self.assertEqual(len(window.shown), 2)

        window.search.insert(0, "gegrüßt 2999")
        window.apply_filter()  # kehrt sofort zurück, die Suche läuft im Hintergrund
        self.wait_for(lambda: len(window.shown) == 1)
        self.assertEqual(window.shown[0].info["art"], "npc-texte")

        window.search.delete(0, "end")
        window.search.insert(0, "seid")  # 3000 Treffer im Detailtext
        window.show_selected()
        self.assertEqual(len(window.detail.tag_ranges("match")) // 2, window.MAX_HIGHLIGHTS)


if __name__ == "__main__":
    unittest.main()
