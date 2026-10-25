"""Helles und dunkles Design. Grundlage ist das ttk-Thema „clam“, das sich auf Windows, macOS
und Linux gleich verhält und sich vollständig umfärben lässt."""
from __future__ import annotations

import tkinter as tk
from dataclasses import dataclass
from tkinter import ttk

from . import system


@dataclass(frozen=True)
class Palette:
    dark: bool
    background: str  # Fensterhintergrund
    field: str  # Eingabefelder, Textfelder, Tabellen
    text: str
    muted: str  # Hinweise und Fortschritt
    border: str
    button: str
    button_active: str
    selection: str
    selection_text: str
    error: str
    link: str
    match: str  # Suchtreffer im Verlauf
    chart_lines: str  # Diagramm: gesammelte Zeilen
    chart_texts: str  # Diagramm: NPC-Texte


LIGHT = Palette(dark=False, background="#f2f2f2", field="#ffffff", text="#1f1f1f", muted="#666666",
                border="#c3c3c3", button="#e4e4e4", button_active="#d6d6d6", selection="#3d6fb4",
                selection_text="#ffffff", error="#b3261e", link="#1a5fb4", match="#ffe28a",
                chart_lines="#3d6fb4", chart_texts="#d9822b")
DARK = Palette(dark=True, background="#1e1f22", field="#2b2d31", text="#e3e3e3", muted="#9a9a9a",
               border="#45474d", button="#35373c", button_active="#43454b", selection="#3f5f8f",
               selection_text="#ffffff", error="#ff8a80", link="#8ab4f8", match="#6b5a1e",
               chart_lines="#6f9fe0", chart_texts="#f0a050")


def choose(setting: str) -> Palette:
    """Die Farben zur Einstellung „system“, „hell“ oder „dunkel“."""
    if setting == "system":
        return DARK if system.prefers_dark() else LIGHT
    return DARK if setting == "dunkel" else LIGHT


def apply(root: tk.Tk, p: Palette):
    """ttk-Stile umfärben und alle vorhandenen Fenster nachziehen; neue Fenster erben die Farben."""
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure(".", background=p.background, foreground=p.text, fieldbackground=p.field,
                    bordercolor=p.border, lightcolor=p.background, darkcolor=p.background,
                    troughcolor=p.field, focuscolor=p.selection, insertcolor=p.text,
                    selectbackground=p.selection, selectforeground=p.selection_text)
    style.map(".", foreground=[("disabled", p.muted)])
    style.configure("TButton", background=p.button, lightcolor=p.button, darkcolor=p.button)
    style.map("TButton", background=[("disabled", p.background), ("pressed", p.selection),
                                     ("active", p.button_active)],
              lightcolor=[("active", p.button_active)], darkcolor=[("active", p.button_active)])
    style.configure("TEntry", fieldbackground=p.field, foreground=p.text)
    style.configure("TCombobox", fieldbackground=p.field, background=p.button, arrowcolor=p.text)
    style.map("TCombobox", fieldbackground=[("readonly", p.field)], foreground=[("readonly", p.text)],
              selectbackground=[("readonly", p.field)], selectforeground=[("readonly", p.text)])
    style.configure("TCheckbutton", indicatorbackground=p.field, indicatorforeground=p.text)
    style.map("TCheckbutton", background=[("active", p.background)],
              indicatorbackground=[("active", p.field)])
    style.configure("TScrollbar", background=p.button, arrowcolor=p.text, troughcolor=p.background)
    style.map("TScrollbar", background=[("active", p.button_active)])
    style.configure("Treeview", background=p.field, fieldbackground=p.field, foreground=p.text)
    style.map("Treeview", background=[("selected", p.selection)], foreground=[("selected", p.selection_text)])
    style.configure("Treeview.Heading", background=p.button, foreground=p.text)
    style.map("Treeview.Heading", background=[("active", p.button_active)])
    style.configure("TNotebook", background=p.background)
    style.configure("TNotebook.Tab", background=p.button, foreground=p.text)
    style.map("TNotebook.Tab", background=[("selected", p.background), ("active", p.button_active)])
    style.configure("TProgressbar", background=p.selection)
    style.configure("Sash", background=p.border)
    style.configure("Muted.TLabel", foreground=p.muted)
    style.configure("Error.TLabel", foreground=p.error)
    style.configure("Link.TLabel", foreground=p.link)

    # Künftige Klapplisten der Comboboxen (Optionsdatenbank von Tk); vorhandene färbt paint um.
    for option, value in (("*TCombobox*Listbox.background", p.field), ("*TCombobox*Listbox.foreground", p.text),
                          ("*TCombobox*Listbox.selectBackground", p.selection),
                          ("*TCombobox*Listbox.selectForeground", p.selection_text)):
        root.option_add(option, value)
    paint(root, p)


def paint(widget: tk.Misc, p: Palette):
    """Die klassischen Tk-Widgets in `widget` und darunter umfärben (Fenster, Textfelder,
    Zeichenflächen, Klapplisten); ttk-Widgets erledigt der Stil. Neue Fenster rufen das selbst auf."""
    if isinstance(widget, (tk.Tk, tk.Toplevel)):
        widget.configure(background=p.background)
        dark_title_bar(widget, p.dark)
    elif isinstance(widget, tk.Text):
        widget.configure(background=p.field, foreground=p.text, insertbackground=p.text,
                         selectbackground=p.selection, selectforeground=p.selection_text,
                         inactiveselectbackground=p.selection)
    elif isinstance(widget, tk.Canvas):
        widget.configure(background=p.field)
    elif isinstance(widget, ttk.Combobox):
        _paint_dropdown(widget, p)
    for child in widget.winfo_children():
        paint(child, p)


def _paint_dropdown(combobox: ttk.Combobox, p: Palette):
    """Die Klappliste einer Combobox legt Tk beim ersten Aufklappen an und färbt sie dann nach
    der Optionsdatenbank; danach folgt sie keinem Wechsel mehr. tkinter kennt sie nicht als
    Kind-Widget, also über Tcl: ttk::combobox::PopdownWindow liefert (und erzeugt) sie."""
    try:
        popdown = combobox.tk.call("ttk::combobox::PopdownWindow", combobox)
        combobox.tk.call(f"{popdown}.f.l", "configure", "-background", p.field, "-foreground", p.text,
                         "-selectbackground", p.selection, "-selectforeground", p.selection_text)
    except tk.TclError:
        pass  # andere Tk-Fassung mit anderem Aufbau: dann eben in den alten Farben


def dark_title_bar(window: tk.Misc, dark: bool):
    """Unter Windows die Titelleiste mitfärben; andere Systeme machen das selbst."""
    if not system.WINDOWS:
        return
    try:
        import ctypes
        window.update_idletasks()
        hwnd = ctypes.windll.user32.GetParent(window.winfo_id())
        value = ctypes.c_int(1 if dark else 0)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(value), ctypes.sizeof(value))
    except (AttributeError, OSError):
        pass  # ältere Windows-Versionen kennen das nicht
