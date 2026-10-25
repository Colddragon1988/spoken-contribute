"""Das Fenster: WoW-Ordner, Konto bei spoken.rusty.one, automatischer Upload, Ergebnis und
der Verlauf aller Uploads.

Netzwerk und Dateiarbeit laufen in einem Hintergrund-Thread, damit das Fenster nicht einfriert;
Ergebnisse kommen über eine Warteschlange zurück in den Fenster-Thread (tkinter verlangt das)."""
from __future__ import annotations

import queue
import sys
import threading
import tkinter as tk
import traceback
import webbrowser
from pathlib import Path
from tkinter import filedialog, font, messagebox, ttk

from . import history, settings, system, upload
from .api import REGISTER, Site, UploadError
from .wowdata import flavor_name

TITLE = "Spoken – Beiträge hochladen"
ERROR_COLOR = "#b3261e"
LINK_COLOR = "#1a5fb4"
MUTED_COLOR = "#666666"
PAD = 10


def run_window() -> int:
    if system.WINDOWS:
        try:  # scharfe Schrift auf hochauflösenden Bildschirmen
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except (AttributeError, OSError):
            pass
    root = tk.Tk(className="spoken-contribute")
    if not (system.WINDOWS or system.MACOS):
        ttk.Style(root).theme_use("clam")  # das Linux-Standardthema von Tk wirkt sehr altmodisch
    App(root)
    root.mainloop()
    return 0


def place_over(window: tk.Toplevel, parent: tk.Misc):
    """Ein Dialogfenster mittig über sein Hauptfenster setzen."""
    window.update_idletasks()
    x = parent.winfo_rootx() + (parent.winfo_width() - window.winfo_reqwidth()) // 2
    y = parent.winfo_rooty() + (parent.winfo_height() - window.winfo_reqheight()) // 3
    window.geometry(f"+{max(x, 0)}+{max(y, 0)}")


def set_text(widget: tk.Text, text: str, *tags: str, append: bool = False):
    """Text in ein schreibgeschütztes Textfeld setzen oder anhängen."""
    widget.configure(state="normal")
    if not append:
        widget.delete("1.0", "end")
    widget.insert("end", text, tags)
    widget.see("end" if append else "1.0")
    widget.configure(state="disabled")


def text_box(parent: tk.Misc, **options) -> tk.Text:
    """Schreibgeschütztes Textfeld mit Bildlaufleiste; liegt in einem eigenen Rahmen."""
    frame = ttk.Frame(parent)
    frame.columnconfigure(0, weight=1)
    frame.rowconfigure(0, weight=1)
    box = tk.Text(frame, wrap="word", state="disabled", relief="flat", borderwidth=0,
                  highlightthickness=0, padx=8, pady=6, font="TkDefaultFont", **options)
    scroll = ttk.Scrollbar(frame, command=box.yview)
    box.configure(yscrollcommand=scroll.set)
    box.grid(row=0, column=0, sticky="nsew")
    scroll.grid(row=0, column=1, sticky="ns")
    box.frame = frame
    return box


def wrapping_label(parent: tk.Misc, **options) -> ttk.Label:
    """Label, das seinen Text an die verfügbare Breite anpasst."""
    label = ttk.Label(parent, justify="left", **options)
    label.bind("<Configure>", lambda e: label.configure(wraplength=max(e.width - 4, 100)))
    return label


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.settings = settings.load()
        self.events: queue.Queue = queue.Queue()
        self.busy = False
        self.history_window: HistoryWindow | None = None

        root.title(TITLE)
        root.geometry("680x560")
        root.minsize(560, 460)
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.report_callback_exception = self.show_crash
        base = font.nametofont("TkDefaultFont")
        self.bold = base.copy()
        self.bold.configure(weight="bold")
        self.small = base.copy()
        size = base.cget("size")  # negativ = Pixel statt Punkte
        self.small.configure(size=size - 1 if size > 0 else size + 1)

        self.build()
        self.refresh_account()
        self.refresh_wow()
        root.after(50, self.poll)
        if self.settings.auto_upload:
            root.after(300, self.start_upload)

    # ------------------------------------------------------------ Aufbau

    def build(self):
        main = ttk.Frame(self.root, padding=PAD)
        main.pack(fill="both", expand=True)
        main.columnconfigure(0, weight=1)
        main.rowconfigure(3, weight=1)

        box = ttk.LabelFrame(main, text="World of Warcraft", padding=PAD)
        box.grid(row=0, column=0, sticky="ew")
        box.columnconfigure(0, weight=1)
        self.wow_var = tk.StringVar(value=self.settings.wow_dir)
        entry = ttk.Entry(box, textvariable=self.wow_var)
        entry.grid(row=0, column=0, sticky="ew")
        entry.bind("<Return>", lambda _e: self.set_wow(self.wow_var.get()))
        ttk.Button(box, text="Ändern …", command=self.choose_wow).grid(row=0, column=1, padx=(6, 0))
        ttk.Button(box, text="Suchen", command=self.search_wow).grid(row=0, column=2, padx=(6, 0))
        self.wow_status = wrapping_label(box)
        self.wow_status.grid(row=1, column=0, columnspan=3, sticky="ew", pady=(6, 0))

        box = ttk.LabelFrame(main, text="Konto bei spoken.rusty.one", padding=PAD)
        box.grid(row=1, column=0, sticky="ew", pady=(PAD, 0))
        box.columnconfigure(0, weight=1)
        self.account_label = ttk.Label(box)
        self.account_label.grid(row=0, column=0, sticky="w")
        self.account_button = ttk.Button(box, command=self.toggle_account)
        self.account_button.grid(row=0, column=1)
        hint = wrapping_label(box, font=self.small, foreground=MUTED_COLOR,
                              text="Nur für die NPC-Texte aus dem Spiel-Cache nötig – die gesammelten "
                                   "Zeilen gehen anonym hoch.")
        hint.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(4, 0))

        self.auto_var = tk.BooleanVar(value=self.settings.auto_upload)
        ttk.Checkbutton(main, text="Beim Start automatisch hochladen", variable=self.auto_var,
                        command=self.save_auto).grid(row=2, column=0, sticky="w", pady=(PAD, 0))

        box = ttk.LabelFrame(main, text="Ergebnis", padding=2)
        box.grid(row=3, column=0, sticky="nsew", pady=(PAD, 0))
        box.columnconfigure(0, weight=1)
        box.rowconfigure(0, weight=1)
        self.log = text_box(box, height=10)
        self.log.frame.grid(row=0, column=0, sticky="nsew")
        self.log.tag_configure("head", font=self.bold)
        self.log.tag_configure("error", foreground=ERROR_COLOR)
        self.log.tag_configure("muted", foreground=MUTED_COLOR)
        set_text(self.log, "„Jetzt hochladen“ sendet alles, was bereitliegt; „Testlauf“ zeigt nur, "
                           "was gesendet würde.", "muted")

        bar = ttk.Frame(main)
        bar.grid(row=4, column=0, sticky="ew", pady=(PAD, 0))
        bar.columnconfigure(2, weight=1)
        ttk.Button(bar, text="Verlauf …", command=self.show_history).grid(row=0, column=0)
        self.test_button = ttk.Button(bar, text="Testlauf", command=lambda: self.start_upload(test=True))
        self.test_button.grid(row=0, column=1, padx=(6, 0))
        self.progress = ttk.Progressbar(bar, mode="indeterminate", length=120)
        self.upload_button = ttk.Button(bar, text="Jetzt hochladen", command=self.start_upload,
                                        default="active")
        self.upload_button.grid(row=0, column=3)
        ttk.Button(bar, text="Schließen", command=self.close).grid(row=0, column=4, padx=(6, 0))

    # ------------------------------------------------------------ Hintergrundarbeit

    def background(self, work, done):
        """work() im Hintergrund ausführen, danach done(Ergebnis, Fehler) im Fenster-Thread."""
        def runner():
            try:
                result, error = work(), None
            except Exception as err:
                result, error = None, err
            self.events.put(lambda: done(result, error))
        threading.Thread(target=runner, daemon=True).start()

    def poll(self):
        """Erledigt, was die Hintergrund-Threads in die Warteschlange gelegt haben."""
        try:
            while True:
                callback = self.events.get_nowait()
                try:
                    callback()
                except Exception:
                    self.show_crash(*sys.exc_info())
        except queue.Empty:
            pass
        self.root.after(50, self.poll)

    def show_crash(self, kind, error, trace):
        traceback.print_exception(kind, error, trace)
        messagebox.showerror(TITLE, f"Unerwarteter Fehler:\n\n{error!r}", parent=self.root)

    # ------------------------------------------------------------ WoW-Ordner

    def wow_path(self) -> Path:
        return Path(self.wow_var.get().strip()).expanduser()

    def set_wow(self, text: str):
        chosen = Path(text.strip()).expanduser()
        path = system.wow_root(chosen) or chosen
        self.wow_var.set(str(path))
        self.settings.wow_dir = str(path)
        settings.save(self.settings)
        self.refresh_wow()

    def choose_wow(self):
        start = self.wow_path() if self.wow_path().is_dir() else Path.home()
        chosen = filedialog.askdirectory(parent=self.root, initialdir=str(start), mustexist=True,
                                         title="Ordner „World of Warcraft“ wählen")
        if chosen:
            self.set_wow(chosen)

    def search_wow(self):
        self.show_wow_status("Suche …")
        self.background(system.find_wow, self.found_wow)

    def found_wow(self, found: Path | None, error):
        if found:
            self.set_wow(str(found))
        else:
            self.show_wow_status("Kein World of Warcraft gefunden – bitte über „Ändern …“ auswählen.", error=True)

    def show_wow_status(self, text: str, error: bool = False):
        self.wow_status.configure(text=text, foreground=ERROR_COLOR if error else "")

    def refresh_wow(self):
        """Zeigt, in welchen Versionen Spoken steckt, was läuft und was bereitliegt."""
        wow = self.wow_path()
        if not system.is_wow_root(wow):
            self.show_wow_status("Hier liegt kein World of Warcraft – bitte über „Ändern …“ oder "
                                 "„Suchen“ den Ordner „World of Warcraft“ wählen.", error=True)
            return
        self.show_wow_status("Prüfe …")
        self.background(lambda: upload.overview(wow),
                        lambda result, error: self.show_overview(wow, result, error))

    def show_overview(self, wow: Path, overview: upload.Overview | None, error):
        if wow != self.wow_path():
            return  # inzwischen wurde ein anderer Ordner gewählt
        if error:
            self.show_wow_status(f"Fehler beim Prüfen: {error}", error=True)
            return
        if not overview.flavors:
            self.show_wow_status("Spoken ist in keiner WoW-Version in diesem Ordner installiert.", error=True)
            return
        names = []
        for flavor in overview.flavors:
            running = overview.running is None or flavor.name.lower() in overview.running
            names.append(flavor_name(flavor) + (" (läuft gerade)" if running else ""))
        if overview.running is None:
            names.append("ein WoW läuft, Version unklar")
        ready = [f"{overview.lines} gesammelte Zeilen"] if overview.lines else []
        ready += [f"{overview.texts} NPC-Texte im Cache"] if overview.texts else []
        self.show_wow_status(f"Spoken in: {', '.join(names)}\n"
                             f"Bereit: {' und '.join(ready) if ready else 'nichts Neues'}")

    # ------------------------------------------------------------ Konto

    def refresh_account(self):
        login = settings.load_login()
        if login:
            self.account_label.configure(text=f"Angemeldet als {login['email']}")
            self.account_button.configure(text="Abmelden")
        else:
            self.account_label.configure(text="Nicht angemeldet")
            self.account_button.configure(text="Anmelden …")

    def toggle_account(self):
        if not settings.load_login():
            LoginDialog(self)
        elif messagebox.askyesno("Abmelden", "Die Zugangsdaten von diesem Rechner löschen?\n\n"
                                 "Ohne Anmeldung bleiben die NPC-Texte im Spiel-Cache liegen, bis du "
                                 "dich wieder anmeldest.", parent=self.root):
            settings.delete_login()
            self.refresh_account()

    def save_auto(self):
        self.settings.auto_upload = self.auto_var.get()
        settings.save(self.settings)

    # ------------------------------------------------------------ Upload

    def start_upload(self, test: bool = False):
        if self.busy:
            return
        self.set_busy(True)
        set_text(self.log, ("Testlauf …" if test else "Lade hoch …") + "\n", "muted")
        wow, credentials = self.wow_path(), settings.load_login()

        def log(text: str):  # wird im Hintergrund-Thread aufgerufen
            self.events.put(lambda: set_text(self.log, text + "\n", "muted", append=True))

        self.background(lambda: upload.run(wow, credentials, test=test, log=log), self.upload_done)

    def upload_done(self, report: upload.Report | None, error):
        self.set_busy(False)
        if error:
            report = upload.Report("Unerwarteter Fehler.", [f"{error!r}", "Was nicht hochgeladen wurde, "
                                   "bleibt liegen und geht beim nächsten Mal mit."], failed=True)
        # Die Fortschrittszeilen weichen dem Ergebnis, das von oben lesbar sein soll.
        set_text(self.log, report.head + "\n", "head", *(["error"] if report.failed else []))
        set_text(self.log, "\n" + "\n\n".join(report.sections) + "\n", append=True)
        self.log.see("1.0")
        self.refresh_wow()
        if self.history_window:
            self.history_window.reload()

    def set_busy(self, busy: bool):
        self.busy = busy
        for button in (self.upload_button, self.test_button):
            button.state(["disabled"] if busy else ["!disabled"])
        if busy:
            self.progress.grid(row=0, column=2, sticky="e", padx=PAD)
            self.progress.start(12)
        else:
            self.progress.stop()
            self.progress.grid_remove()

    # ------------------------------------------------------------ Verlauf und Schließen

    def show_history(self):
        if self.history_window:
            self.history_window.deiconify()
            self.history_window.lift()
        else:
            self.history_window = HistoryWindow(self)

    def close(self):
        if self.busy:
            messagebox.showinfo(TITLE, "Der Upload läuft noch – bitte kurz warten.", parent=self.root)
            return
        self.root.destroy()


class LoginDialog(tk.Toplevel):
    """E-Mail und Passwort abfragen, bei der Website prüfen und erst dann speichern."""

    def __init__(self, app: App):
        super().__init__(app.root)
        self.app = app
        self.title("Bei spoken.rusty.one anmelden")
        self.transient(app.root)
        self.resizable(False, False)

        body = ttk.Frame(self, padding=PAD * 1.5)
        body.pack(fill="both", expand=True)
        ttk.Label(body, wraplength=360, justify="left",
                  text="Die Zugangsdaten werden nur auf diesem Rechner gespeichert, in einer Datei, "
                       "die nur du lesen kannst.").grid(row=0, column=0, columnspan=2, sticky="w",
                                                        pady=(0, PAD))
        ttk.Label(body, text="E-Mail").grid(row=1, column=0, sticky="w", padx=(0, 8))
        self.email = ttk.Entry(body, width=36)
        self.email.grid(row=1, column=1, sticky="ew")
        ttk.Label(body, text="Passwort").grid(row=2, column=0, sticky="w", padx=(0, 8), pady=(6, 0))
        self.password = ttk.Entry(body, width=36, show="•")
        self.password.grid(row=2, column=1, sticky="ew", pady=(6, 0))
        reveal = tk.BooleanVar()
        ttk.Checkbutton(body, text="Passwort anzeigen", variable=reveal,
                        command=lambda: self.password.configure(show="" if reveal.get() else "•")
                        ).grid(row=3, column=1, sticky="w", pady=(4, 0))
        self.message = ttk.Label(body, wraplength=360, justify="left")
        self.message.grid(row=4, column=0, columnspan=2, sticky="w", pady=(6, 0))
        link = ttk.Label(body, text="Noch kein Konto? Auf spoken.rusty.one registrieren",
                         foreground=LINK_COLOR, cursor="hand2", font=app.small)
        link.bind("<Button-1>", lambda _e: webbrowser.open(REGISTER))
        link.grid(row=5, column=0, columnspan=2, sticky="w", pady=(6, 0))

        bar = ttk.Frame(body)
        bar.grid(row=6, column=0, columnspan=2, sticky="e", pady=(PAD, 0))
        self.submit_button = ttk.Button(bar, text="Anmelden", command=self.submit, default="active")
        self.submit_button.pack(side="right")
        ttk.Button(bar, text="Abbrechen", command=self.destroy).pack(side="right", padx=(0, 6))

        self.bind("<Return>", lambda _e: self.submit())
        self.bind("<Escape>", lambda _e: self.destroy())
        place_over(self, app.root)
        self.email.focus_set()
        try:
            self.wait_visibility()
            self.grab_set()
        except tk.TclError:
            pass  # ohne Sperre des Hauptfensters geht es auch

    def submit(self):
        if self.submit_button.instate(["disabled"]):
            return  # die Prüfung läuft schon (Eingabetaste während des Wartens)
        email, password = self.email.get().strip(), self.password.get()
        if not email or not password:
            self.message.configure(text="Bitte E-Mail und Passwort eingeben.", foreground=ERROR_COLOR)
            return
        self.submit_button.state(["disabled"])
        self.message.configure(text="Prüfe die Anmeldung …", foreground="")
        self.app.background(lambda: Site().sign_in(email, password),
                            lambda _user, error: self.done(email, password, error))

    def done(self, email: str, password: str, error):
        if not self.winfo_exists():
            return  # inzwischen abgebrochen
        if error:
            text = str(error) if isinstance(error, UploadError) else f"Unerwarteter Fehler: {error!r}"
            self.message.configure(text=text, foreground=ERROR_COLOR)
            self.submit_button.state(["!disabled"])
            return
        settings.save_login(email, password)
        self.app.refresh_account()
        self.destroy()


class HistoryWindow(tk.Toplevel):
    """Alle archivierten Uploads als Tabelle; darunter alles zum gewählten Upload."""

    COLUMNS = (("zeit", "Zeitpunkt", 150, False), ("art", "Art", 150, False),
               ("version", "Version", 170, False), ("anzahl", "Anzahl", 70, False),
               ("ergebnis", "Ergebnis", 220, True))

    def __init__(self, app: App):
        super().__init__(app.root)
        self.app = app
        self.entries: list[history.Entry] = []
        self.title("Spoken – Verlauf der Uploads")
        self.geometry("860x600")
        self.minsize(600, 400)
        self.protocol("WM_DELETE_WINDOW", self.close)

        body = ttk.Frame(self, padding=PAD)
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)
        self.summary = wrapping_label(body)
        self.summary.grid(row=0, column=0, sticky="ew", pady=(0, 6))

        panes = ttk.Panedwindow(body, orient="vertical")
        panes.grid(row=1, column=0, sticky="nsew")
        table = ttk.Frame(panes)
        table.columnconfigure(0, weight=1)
        table.rowconfigure(0, weight=1)
        self.tree = ttk.Treeview(table, columns=[c[0] for c in self.COLUMNS], show="headings",
                                 selectmode="browse", height=8)
        for key, title, width, stretch in self.COLUMNS:
            self.tree.heading(key, text=title, anchor="w")
            self.tree.column(key, width=width, stretch=stretch, anchor="e" if key == "anzahl" else "w")
        self.tree.tag_configure("fehler", foreground=ERROR_COLOR)
        self.tree.bind("<<TreeviewSelect>>", lambda _e: self.show_selected())
        scroll = ttk.Scrollbar(table, command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        scroll.grid(row=0, column=1, sticky="ns")
        self.detail = text_box(panes)
        self.detail.tag_configure("head", font=app.bold)
        panes.add(table, weight=1)
        panes.add(self.detail.frame, weight=2)

        bar = ttk.Frame(body)
        bar.grid(row=2, column=0, sticky="ew", pady=(PAD, 0))
        self.open_button = ttk.Button(bar, text="Ordner dieses Uploads öffnen", command=self.open_selected)
        self.open_button.pack(side="left")
        ttk.Button(bar, text="Archiv öffnen", command=self.open_archive).pack(side="left", padx=(6, 0))
        ttk.Button(bar, text="Schließen", command=self.close).pack(side="right")
        self.bind("<Escape>", lambda _e: self.close())
        self.reload()

    def reload(self):
        self.entries = history.entries()
        self.tree.delete(*self.tree.get_children())
        for i, entry in enumerate(self.entries):
            self.tree.insert("", "end", iid=str(i), values=history.row(entry),
                             tags=("fehler",) if entry.failed else ())
        self.summary.configure(text=history.totals(self.entries) if self.entries else "")
        if self.entries:
            self.tree.selection_set("0")
            self.tree.focus("0")
        else:
            self.open_button.state(["disabled"])
            set_text(self.detail, "Noch keine Uploads archiviert.")

    def selected(self) -> history.Entry | None:
        chosen = self.tree.selection()
        return self.entries[int(chosen[0])] if chosen else None

    def show_selected(self):
        entry = self.selected()
        if not entry:
            return
        self.open_button.state(["!disabled"])
        head, _, rest = history.details(entry).partition("\n")
        set_text(self.detail, head + "\n", "head")
        set_text(self.detail, rest, append=True)
        self.detail.see("1.0")

    def open_selected(self):
        entry = self.selected()
        if entry:
            system.open_path(entry.folder)

    def open_archive(self):
        history.ROOT.mkdir(parents=True, exist_ok=True)
        system.open_path(history.ROOT)

    def close(self):
        self.app.history_window = None
        self.destroy()
