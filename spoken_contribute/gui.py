"""Das Fenster: WoW-Ordner, Konto bei spoken.rusty.one, automatischer Upload, Design, Ergebnis
und der Verlauf aller Uploads mit Suche und Statistik.

Netzwerk, Schlüsselbund und Dateiarbeit laufen in einem Hintergrund-Thread, damit das Fenster
nicht einfriert; Ergebnisse kommen über eine Warteschlange zurück in den Fenster-Thread
(tkinter verlangt, dass nur er die Widgets anfasst)."""
from __future__ import annotations

import queue
import sys
import threading
import tkinter as tk
import traceback
import webbrowser
from pathlib import Path
from tkinter import filedialog, font, messagebox, ttk

from . import history, limits, settings, system, theme, upload
from .api import REGISTER, Site, UploadError
from .wowdata import flavor_name

TITLE = "Spoken – Beiträge hochladen"
PAD = 10
THEME_CHECK_MS = 10_000  # so oft wird bei „Wie System“ nachgesehen, ob das System umgeschaltet hat


def run_window() -> int:
    if system.WINDOWS:
        try:  # scharfe Schrift auf hochauflösenden Bildschirmen
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except (AttributeError, OSError):
            pass
    root = tk.Tk(className="spoken-contribute")
    App(root)
    root.mainloop()
    return 0


# ---------------------------------------------------------------- kleine Bausteine

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
    """Schreibgeschütztes Textfeld mit Bildlaufleiste; liegt in einem eigenen Rahmen (.frame)."""
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
        self.palette = theme.choose(self.settings.theme)

        root.title(TITLE)
        root.geometry("700x600")
        root.minsize(580, 480)
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.report_callback_exception = self.show_crash
        base = font.nametofont("TkDefaultFont")
        self.bold = base.copy()
        self.bold.configure(weight="bold")
        self.small = base.copy()
        size = base.cget("size")  # negativ = Pixel statt Punkte
        self.small.configure(size=size - 1 if size > 0 else size + 1)

        self.build()
        self.apply_theme()
        self.refresh_account()
        self.refresh_wow()
        root.after(50, self.poll)
        root.after(THEME_CHECK_MS, self.check_system_theme)
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
        self.account_hint = wrapping_label(box, font=self.small, style="Muted.TLabel")
        self.account_hint.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(4, 0))

        options = ttk.Frame(main)
        options.grid(row=2, column=0, sticky="ew", pady=(PAD, 0))
        self.auto_var = tk.BooleanVar(value=self.settings.auto_upload)
        ttk.Checkbutton(options, text="Beim Start automatisch hochladen", variable=self.auto_var,
                        command=self.save_auto).pack(side="left")
        self.theme_var = tk.StringVar(value=settings.THEMES[self.settings.theme])
        themes = ttk.Combobox(options, textvariable=self.theme_var, state="readonly", width=12,
                              values=list(settings.THEMES.values()))
        themes.bind("<<ComboboxSelected>>", lambda _e: self.change_theme())
        themes.pack(side="right")
        ttk.Label(options, text="Design:").pack(side="right", padx=(0, 6))

        box = ttk.LabelFrame(main, text="Ergebnis", padding=2)
        box.grid(row=3, column=0, sticky="nsew", pady=(PAD, 0))
        box.columnconfigure(0, weight=1)
        box.rowconfigure(0, weight=1)
        self.log = text_box(box, height=10)
        self.log.frame.grid(row=0, column=0, sticky="nsew")
        self.log.tag_configure("head", font=self.bold)
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

    # ------------------------------------------------------------ Design

    def apply_theme(self):
        theme.apply(self.root, self.palette)
        self.log.tag_configure("error", foreground=self.palette.error)
        self.log.tag_configure("muted", foreground=self.palette.muted)
        if self.history_window:
            self.history_window.restyle()

    def change_theme(self):
        labels = {label: key for key, label in settings.THEMES.items()}
        self.settings.theme = labels[self.theme_var.get()]
        settings.save(self.settings)
        self.background(lambda: theme.choose(self.settings.theme), self.theme_chosen)

    def check_system_theme(self):
        """Bei „Wie System“ einem Umschalten des Systems folgen (im Hintergrund nachgesehen)."""
        if self.settings.theme == "system":
            self.background(lambda: theme.choose("system"), self.theme_chosen)
        self.root.after(THEME_CHECK_MS, self.check_system_theme)

    def theme_chosen(self, palette: theme.Palette | None, error):
        if palette and palette != self.palette:
            self.palette = palette
            self.apply_theme()

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
        self.wow_status.configure(text=text, style="Error.TLabel" if error else "TLabel")

    def refresh_wow(self):
        """Zeigt, in welchen Versionen Spoken steckt, was läuft und was ein Upload jetzt senden würde."""
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
        names, running = [], []
        for flavor in overview.flavors:
            if overview.running is None or flavor.name.lower() in overview.running:
                running.append(flavor_name(flavor))
                names.append(flavor_name(flavor) + " (läuft gerade)")
            else:
                names.append(flavor_name(flavor))
        lines = [f"Spoken in: {', '.join(names)}"]
        if overview.running is None:
            lines.append("Ein WoW läuft, aber welche Version, ist nicht zu erkennen – bitte erst beenden.")
        else:
            ready = [f"{overview.lines} gesammelte Zeilen"] if overview.lines else []
            ready += [f"{overview.texts} NPC-Texte"] if overview.texts else []
            text = f"Bereit: {' und '.join(ready) if ready else 'nichts Neues'}"
            if running:
                text += f" (ohne {', '.join(running)} – wird beim Upload übersprungen)"
            lines.append(text)
        if overview.free_at:
            lines.append(f"Upload-Grenze erreicht ({limits.PER_HOUR} pro Stunde) – gesammelte Zeilen "
                         f"wieder ab {overview.free_at:%H:%M} Uhr.")
        elif overview.uploads_left < limits.PER_HOUR:
            lines.append(f"Noch {overview.uploads_left} von {limits.PER_HOUR} Uploads in dieser Stunde frei.")
        self.show_wow_status("\n".join(lines))

    # ------------------------------------------------------------ Konto

    def refresh_account(self):
        email = settings.account()
        if email:
            self.account_label.configure(text=f"Angemeldet als {email}")
            self.account_button.configure(text="Abmelden")
            where = ("im Schlüsselbund des Systems" if settings.password_in_keyring()
                     else "in einer Datei, die nur du lesen kannst (kein Schlüsselbund gefunden)")
            self.account_hint.configure(text=f"Das Passwort liegt {where}. Die Anmeldung ist nur für die "
                                             "NPC-Texte nötig – die gesammelten Zeilen gehen anonym hoch.")
        else:
            self.account_label.configure(text="Nicht angemeldet")
            self.account_button.configure(text="Anmelden …")
            self.account_hint.configure(text="Nur für die NPC-Texte aus dem Spiel-Cache nötig – die "
                                             "gesammelten Zeilen gehen anonym hoch.")

    def toggle_account(self):
        if not settings.account():
            LoginDialog(self)
            return
        if messagebox.askyesno("Abmelden", "Die Anmeldung von diesem Rechner löschen (auch aus dem "
                               "Schlüsselbund)?\n\nOhne Anmeldung bleiben die NPC-Texte im Spiel-Cache "
                               "liegen, bis du dich wieder anmeldest.", parent=self.root):
            self.background(settings.delete_login, lambda _result, _error: self.refresh_account())

    def save_auto(self):
        self.settings.auto_upload = self.auto_var.get()
        settings.save(self.settings)

    # ------------------------------------------------------------ Upload

    def start_upload(self, test: bool = False):
        if self.busy:
            return
        self.set_busy(True)
        set_text(self.log, ("Testlauf …" if test else "Lade hoch …") + "\n", "muted")
        wow = self.wow_path()

        def log(text: str):  # wird im Hintergrund-Thread aufgerufen
            self.events.put(lambda: set_text(self.log, text + "\n", "muted", append=True))

        def work():  # das Passwort erst hier holen: der Schlüsselbund kann nachfragen
            return upload.run(wow, settings.credentials(), test=test, log=log)

        self.background(work, self.upload_done)

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
        self.configure(background=app.palette.background)
        theme.dark_title_bar(self, app.palette.dark)

        body = ttk.Frame(self, padding=PAD * 1.5)
        body.pack(fill="both", expand=True)
        ttk.Label(body, wraplength=360, justify="left",
                  text="Die Anmeldung bleibt auf diesem Rechner: das Passwort im Schlüsselbund des "
                       "Systems, die E-Mail-Adresse in den Einstellungen.").grid(
            row=0, column=0, columnspan=2, sticky="w", pady=(0, PAD))
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
                         style="Link.TLabel", cursor="hand2", font=app.small)
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
            self.message.configure(text="Bitte E-Mail und Passwort eingeben.", style="Error.TLabel")
            return
        self.submit_button.state(["disabled"])
        self.message.configure(text="Prüfe die Anmeldung …", style="TLabel")

        def work():  # erst prüfen, dann speichern – beides darf dauern (Netz, Schlüsselbund)
            Site().sign_in(email, password)
            settings.save_login(email, password)

        self.app.background(work, lambda _result, error: self.done(error))

    def done(self, error):
        if not self.winfo_exists():
            self.app.refresh_account()
            return  # inzwischen geschlossen
        if error:
            text = str(error) if isinstance(error, UploadError) else f"Unerwarteter Fehler: {error!r}"
            self.message.configure(text=text, style="Error.TLabel")
            self.submit_button.state(["!disabled"])
            return
        self.app.refresh_account()
        self.destroy()


class HistoryWindow(tk.Toplevel):
    """Alle archivierten Uploads: Tabelle mit Suche und Filtern, darunter alles zum gewählten
    Upload; auf der zweiten Seite die Statistik mit einem Diagramm der letzten 30 Tage."""

    COLUMNS = (("zeit", "Zeitpunkt", 150, False), ("art", "Art", 150, False),
               ("version", "Version", 170, False), ("anzahl", "Anzahl", 70, False),
               ("ergebnis", "Ergebnis", 220, True))
    ALL = "Alle"
    KINDS = {ALL: None, "Gesammelte Zeilen": "zeilen", "NPC-Texte": "npc-texte", "Fehlgeschlagen": "fehler"}
    CHART_DAYS = 30

    def __init__(self, app: App):
        super().__init__(app.root)
        self.app = app
        self.entries: list[history.Entry] = []  # alle
        self.shown: list[history.Entry] = []  # nach Suche und Filtern
        self.search_cache: dict[Path, str] = {}
        self.search_job = None
        self.title("Spoken – Verlauf der Uploads")
        self.geometry("900x640")
        self.minsize(640, 440)
        self.protocol("WM_DELETE_WINDOW", self.close)
        self.configure(background=app.palette.background)
        theme.dark_title_bar(self, app.palette.dark)

        body = ttk.Frame(self, padding=PAD)
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)
        self.build_filters(body)

        self.pages = ttk.Notebook(body)
        self.pages.grid(row=1, column=0, sticky="nsew", pady=(6, 0))
        self.pages.add(self.build_list_page(self.pages), text="Uploads")
        self.pages.add(self.build_statistics_page(self.pages), text="Statistik")

        bar = ttk.Frame(body)
        bar.grid(row=2, column=0, sticky="ew", pady=(PAD, 0))
        self.open_button = ttk.Button(bar, text="Ordner dieses Uploads öffnen", command=self.open_selected)
        self.open_button.pack(side="left")
        ttk.Button(bar, text="Archiv öffnen", command=self.open_archive).pack(side="left", padx=(6, 0))
        ttk.Button(bar, text="Schließen", command=self.close).pack(side="right")
        self.bind("<Escape>", lambda _e: self.close())
        theme.apply(app.root, app.palette)  # die neuen Textfelder und die Zeichenfläche einfärben
        self.restyle()
        self.reload()

    # ------------------------------------------------------------ Aufbau

    def build_filters(self, parent: tk.Misc):
        bar = ttk.Frame(parent)
        bar.grid(row=0, column=0, sticky="ew")
        bar.columnconfigure(1, weight=1)
        ttk.Label(bar, text="Suchen:").grid(row=0, column=0, padx=(0, 6))
        self.search_var = tk.StringVar()
        search = ttk.Entry(bar, textvariable=self.search_var)
        search.grid(row=0, column=1, sticky="ew")
        search.bind("<KeyRelease>", lambda _e: self.schedule_filter())
        ttk.Label(bar, text="Art:").grid(row=0, column=2, padx=(PAD, 6))
        self.kind_var = tk.StringVar(value=self.ALL)
        kinds = ttk.Combobox(bar, textvariable=self.kind_var, values=list(self.KINDS), state="readonly",
                             width=17)
        kinds.grid(row=0, column=3)
        kinds.bind("<<ComboboxSelected>>", lambda _e: self.apply_filter())
        ttk.Label(bar, text="Version:").grid(row=0, column=4, padx=(PAD, 6))
        self.version_var = tk.StringVar(value=self.ALL)
        self.versions = ttk.Combobox(bar, textvariable=self.version_var, state="readonly", width=14)
        self.versions.grid(row=0, column=5)
        self.versions.bind("<<ComboboxSelected>>", lambda _e: self.apply_filter())
        self.summary = wrapping_label(bar, style="Muted.TLabel")
        self.summary.grid(row=1, column=0, columnspan=6, sticky="ew", pady=(6, 0))

    def build_list_page(self, parent: tk.Misc) -> ttk.Frame:
        page = ttk.Frame(parent, padding=(0, 6, 0, 0))
        page.columnconfigure(0, weight=1)
        page.rowconfigure(0, weight=1)
        panes = ttk.Panedwindow(page, orient="vertical")
        panes.grid(row=0, column=0, sticky="nsew")
        table = ttk.Frame(panes)
        table.columnconfigure(0, weight=1)
        table.rowconfigure(0, weight=1)
        self.tree = ttk.Treeview(table, columns=[c[0] for c in self.COLUMNS], show="headings",
                                 selectmode="browse", height=8)
        for key, title, width, stretch in self.COLUMNS:
            self.tree.heading(key, text=title, anchor="w")
            self.tree.column(key, width=width, stretch=stretch, anchor="e" if key == "anzahl" else "w")
        self.tree.bind("<<TreeviewSelect>>", lambda _e: self.show_selected())
        scroll = ttk.Scrollbar(table, command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        scroll.grid(row=0, column=1, sticky="ns")
        self.detail = text_box(panes)
        self.detail.tag_configure("head", font=self.app.bold)
        panes.add(table, weight=1)
        panes.add(self.detail.frame, weight=2)
        return page

    def build_statistics_page(self, parent: tk.Misc) -> ttk.Frame:
        page = ttk.Frame(parent, padding=(0, 6, 0, 0))
        page.columnconfigure(0, weight=1)
        page.rowconfigure(1, weight=1)
        self.stats_text = text_box(page, height=7)
        self.stats_text.tag_configure("head", font=self.app.bold)
        self.stats_text.frame.grid(row=0, column=0, sticky="ew")
        self.chart = tk.Canvas(page, highlightthickness=0, height=220)
        self.chart.grid(row=1, column=0, sticky="nsew", pady=(6, 0))
        self.chart.bind("<Configure>", lambda _e: self.draw_chart())
        return page

    def restyle(self):
        """Farben, die nicht über den ttk-Stil laufen (Tabellen-Markierungen, Treffer, Diagramm)."""
        p = self.app.palette
        self.tree.tag_configure("fehler", foreground=p.error)
        self.detail.tag_configure("match", background=p.match)
        self.draw_chart()

    # ------------------------------------------------------------ Daten und Filter

    def reload(self):
        self.entries = history.entries()
        self.search_cache.clear()
        versions = sorted({v for e in self.entries for v in e.info.get("versionen", [])})
        self.versions.configure(values=[self.ALL, *versions])
        if self.version_var.get() not in (self.ALL, *versions):
            self.version_var.set(self.ALL)
        self.apply_filter()

    def schedule_filter(self):
        """Beim Tippen erst kurz warten, damit nicht nach jedem Buchstaben gesucht wird."""
        if self.search_job:
            self.after_cancel(self.search_job)
        self.search_job = self.after(250, self.apply_filter)

    def matches(self, entry: history.Entry) -> bool:
        kind = self.KINDS[self.kind_var.get()]
        if kind == "fehler" and not entry.failed:
            return False
        if kind not in (None, "fehler") and (entry.info.get("art") != kind or entry.failed):
            return False
        version = self.version_var.get()
        if version != self.ALL and version not in entry.info.get("versionen", []):
            return False
        query = self.search_var.get().strip().casefold()
        if not query:
            return True
        if entry.folder not in self.search_cache:
            self.search_cache[entry.folder] = history.search_text(entry)
        return query in self.search_cache[entry.folder]

    def apply_filter(self):
        self.search_job = None
        self.shown = [e for e in self.entries if self.matches(e)]
        self.tree.delete(*self.tree.get_children())
        for i, entry in enumerate(self.shown):
            self.tree.insert("", "end", iid=str(i), values=history.row(entry),
                             tags=("fehler",) if entry.failed else ())
        if not self.entries:
            text = "Noch keine Uploads archiviert."
        elif not self.shown:
            text = "Keine Uploads passen zu Suche und Filter."
        else:
            text = history.totals(self.shown)
            if len(self.shown) != len(self.entries):
                text += f"   (gefiltert: {len(self.shown)} von {len(self.entries)})"
        self.summary.configure(text=text)
        if self.shown:
            self.tree.selection_set("0")
            self.tree.focus("0")
        else:
            self.open_button.state(["disabled"])
            set_text(self.detail, "")
        self.show_statistics()

    def selected(self) -> history.Entry | None:
        chosen = self.tree.selection()
        return self.shown[int(chosen[0])] if chosen else None

    def show_selected(self):
        entry = self.selected()
        if not entry:
            return
        self.open_button.state(["!disabled"])
        head, _, rest = history.details(entry).partition("\n")
        set_text(self.detail, head + "\n", "head")
        set_text(self.detail, rest, append=True)
        self.highlight(self.search_var.get().strip())

    def highlight(self, query: str):
        """Suchtreffer im Detailtext markieren und zum ersten springen."""
        self.detail.tag_remove("match", "1.0", "end")
        first, start = None, "1.0"
        while query:
            start = self.detail.search(query, start, "end", nocase=True)
            if not start:
                break
            end = f"{start}+{len(query)}c"
            self.detail.tag_add("match", start, end)
            first = first or start
            start = end
        self.detail.see(first or "1.0")

    # ------------------------------------------------------------ Statistik

    def show_statistics(self):
        s = history.statistics(self.shown)
        head = "Statistik" + (" (gefiltert)" if len(self.shown) != len(self.entries) else "")
        lines = [f"{s.uploads} Uploads" + (f", {s.failed} fehlgeschlagen" if s.failed else "")]
        if s.first:
            lines[0] += f" – vom {s.first.astimezone():%d.%m.%Y} bis {s.last.astimezone():%d.%m.%Y}"
        lines.append(f"Gesammelte Zeilen: {s.lines} gesendet, {s.lines_new} neu für das Projekt, "
                     f"{s.lines_known} schon bekannt")
        lines.append(f"NPC-Texte: {s.texts} gesendet, {s.texts_new} neu, {s.texts_changed} aktualisiert")
        for version, (line_count, text_count) in sorted(s.per_version.items()):
            lines.append(f"    {version}: {line_count} Zeilen, {text_count} NPC-Texte")
        set_text(self.stats_text, head + "\n", "head")
        set_text(self.stats_text, "\n".join(lines), append=True)
        self.stats_text.see("1.0")
        self.draw_chart()

    def draw_chart(self):
        """Gestapelte Balken je Tag: gesammelte Zeilen und NPC-Texte der letzten 30 Tage."""
        canvas, p, small = self.chart, self.app.palette, self.app.small
        canvas.delete("all")
        width, height = canvas.winfo_width(), canvas.winfo_height()
        if width < 100 or height < 80:
            return  # noch nicht sichtbar
        days = history.daily(self.shown, self.CHART_DAYS)
        peak = max(lines + texts for _, lines, texts in days) or 1
        left, right, top, bottom = 44, 12, 34, height - 24
        step = (width - left - right) / len(days)
        bar = max(step * 0.7, 1)

        canvas.create_text(left, 8, anchor="nw", fill=p.text, font=small,
                           text=f"Gesendet pro Tag, letzte {self.CHART_DAYS} Tage")
        x = width - right  # Legende von rechts nach links, Breite nach der Schrift bemessen
        for color, label in ((p.chart_texts, "NPC-Texte"), (p.chart_lines, "Gesammelte Zeilen")):
            x -= small.measure(label) + 14
            canvas.create_rectangle(x, 10, x + 10, 20, fill=color, outline="")
            canvas.create_text(x + 14, 15, anchor="w", fill=p.text, font=small, text=label)
            x -= 16
        canvas.create_line(left, bottom, width - right, bottom, fill=p.border)
        canvas.create_text(left - 6, top, anchor="e", fill=p.muted, font=small, text=str(peak))
        canvas.create_text(left - 6, bottom, anchor="e", fill=p.muted, font=small, text="0")
        for i, (day, lines, texts) in enumerate(days):
            x, y = left + i * step + (step - bar) / 2, bottom
            for value, color in ((lines, p.chart_lines), (texts, p.chart_texts)):
                if value:
                    h = (bottom - top) * value / peak
                    canvas.create_rectangle(x, y - h, x + bar, y, fill=color, outline="")
                    y -= h
            if i % 5 == 0 or i == len(days) - 1:
                canvas.create_text(x + bar / 2, bottom + 4, anchor="n", fill=p.muted, font=small,
                                   text=f"{day:%d.%m.}")

    # ------------------------------------------------------------ Knöpfe

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
