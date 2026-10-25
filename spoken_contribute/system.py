"""Alles, was je Betriebssystem anders ist: wo Einstellungen und Archiv liegen, wo WoW
installiert ist, welche WoW-Versionen gerade laufen und wie man einen Ordner öffnet.

Unterstützt Windows, macOS und Linux (WoW über Wine/Proton mit Lutris, Bottles, Steam o. Ä.)."""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

APP = "spoken-contribute"
WINDOWS = sys.platform == "win32"
MACOS = sys.platform == "darwin"
WOW_FOLDER = "World of Warcraft"
# Unter Windows Hilfsprogramme ohne aufblitzendes Konsolenfenster starten.
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


# ---------------------------------------------------------------- eigene Ordner

def config_dir() -> Path:
    """Einstellungen und Zugangsdaten."""
    if WINDOWS:
        return Path(os.environ.get("APPDATA") or Path.home() / "AppData/Roaming") / APP
    if MACOS:
        return Path.home() / "Library/Application Support" / APP
    return Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / APP


def data_dir() -> Path:
    """Archiv der Uploads."""
    if WINDOWS:
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData/Local") / APP
    if MACOS:
        return Path.home() / "Library/Application Support" / APP
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / APP


def write_file(path: Path, text: str, private: bool = False):
    """Datei ganz oder gar nicht schreiben (erst daneben, dann ersetzen). private: nur der
    Benutzer darf sie lesen – unter Windows gilt das für seine Benutzerordner ohnehin."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700 if private else 0o777)
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600 if private else 0o666)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
        # Erst auf die Platte, dann ersetzen: sonst kann nach einem Stromausfall statt der
        # alten Datei eine leere dastehen – bei login.json wäre das Passwort weg.
        f.flush()
        os.fsync(f.fileno())
    if private and not WINDOWS:
        os.chmod(tmp, 0o600)  # falls die Datei schon mit anderen Rechten existierte
    os.replace(tmp, path)


def open_path(path: Path):
    """Ordner oder Datei im Dateimanager bzw. passenden Programm öffnen."""
    if WINDOWS:
        os.startfile(path)  # noqa: gibt es nur unter Windows
    else:
        subprocess.Popen(["open" if MACOS else "xdg-open", str(path)])


# ---------------------------------------------------------------- WoW finden

def is_wow_root(path: Path) -> bool:
    """Der WoW-Hauptordner enthält Versionsordner wie _classic_era_ oder _retail_."""
    try:
        return any(_is_flavor(folder) for folder in path.glob("_*_"))
    except OSError:
        return False


def _is_flavor(folder: Path) -> bool:
    """Ein Versionsordner hat WTF, Interface oder .flavor.info – das unterscheidet ihn von
    anderen Ordnern, die zufällig mit _ beginnen und enden."""
    markers = ("WTF", "Interface", ".flavor.info")
    return folder.is_dir() and any((folder / marker).exists() for marker in markers)


def wow_root(path: Path) -> Path | None:
    """Der WoW-Hauptordner zu einem gewählten Ordner: er selbst, der Unterordner
    „World of Warcraft“ oder ein übergeordneter (wenn z. B. _classic_era_ gewählt wurde)."""
    for candidate in (path, path / WOW_FOLDER, *path.parents):
        if is_wow_root(candidate):
            return candidate
    return None


def find_wow() -> Path | None:
    """WoW an den üblichen Orten suchen; eine Installation mit Spoken hat Vorrang."""
    roots = []
    for candidate in wow_candidates():
        for path in (candidate, candidate.parent):  # die Registry nennt einen Versionsordner
            if path not in roots and is_wow_root(path):
                roots.append(path)
    for root in roots:
        if any(root.glob("_*_/Interface/AddOns/Spoken")):
            return root
    return roots[0] if roots else None


def wow_candidates() -> list[Path]:
    """Die üblichen Installationsorte je System; ob dort wirklich WoW liegt, prüft find_wow."""
    if WINDOWS:
        drives = [f"{letter}:\\" for letter in "CDEFGHIJ" if os.path.isdir(f"{letter}:\\")]
        return _registry_wow() + [Path(drive, sub, WOW_FOLDER) for drive in drives
                                  for sub in ("Program Files (x86)", "Program Files", "Games", "Spiele", "")]
    if MACOS:
        return [Path("/Applications", WOW_FOLDER), Path.home() / "Applications" / WOW_FOLDER]
    return [prefix / "drive_c" / program_files / WOW_FOLDER
            for prefix in _wine_prefixes() for program_files in ("Program Files (x86)", "Program Files")]


def _registry_wow() -> list[Path]:
    """Was der Battle.net-Installer unter Windows einträgt (ein Versionsordner wie …\\_retail_\\)."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                            r"SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft") as key:
            return [Path(winreg.QueryValueEx(key, "InstallPath")[0])]
    except (ImportError, OSError):
        return []


# Wo Lutris, Bottles, Steam (Proton) und Wine selbst ihre Präfixe anlegen.
WINE_PREFIXES = ("Games/*", ".wine", ".local/share/wineprefixes/*",
                 ".local/share/lutris/prefixes/*",
                 ".local/share/bottles/bottles/*",
                 ".var/app/com.usebottles.bottles/data/bottles/bottles/*",
                 ".steam/steam/steamapps/compatdata/*/pfx",
                 ".local/share/Steam/steamapps/compatdata/*/pfx",
                 ".var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/compatdata/*/pfx")


def _wine_prefixes() -> list[Path]:
    """Alle Wine-Präfixe des Benutzers, ohne Doppelte; WINEPREFIX zuerst."""
    found = [Path(os.environ["WINEPREFIX"])] if os.environ.get("WINEPREFIX") else []
    for pattern in WINE_PREFIXES:
        found += sorted(Path.home().glob(pattern))
    return list(dict.fromkeys(found))


# ---------------------------------------------------------------- laufende WoW-Versionen

# Das Spiel selbst: Wow.exe, WowClassic.exe … (Windows, Wine) oder
# „World of Warcraft Classic.app/Contents/MacOS/…“ (macOS) – nicht Launcher oder Sprachchat-Helfer.
GAME = re.compile(r"(?:^|[\\/])(wow[a-z0-9-]*\.exe|World of Warcraft[^/]*\.app/Contents/MacOS/[^/]+)$", re.I)
NOT_THE_GAME = re.compile(r"voiceproxy|launcher", re.I)
FLAVOR = re.compile(r"[\\/](_[a-z0-9_]+_)(?=[\\/])", re.I)


def running_flavors() -> set[str] | None:
    """Ordnernamen der laufenden WoW-Clients, z. B. {"_forever_"}. None heißt: ein WoW läuft,
    aber aus welchem Ordner, ist nicht zu erkennen."""
    found = set()
    for program in _running_programs():
        game = GAME.search(program)
        if not game or NOT_THE_GAME.search(game.group(1)):
            continue
        folders = FLAVOR.findall(program)
        if not folders:
            return None
        found.add(folders[-1].lower())
    return found


def _running_programs() -> list[str]:
    """Programmpfade aller laufenden Prozesse – nur das Programm, nicht seine Argumente: WoW
    startet z. B. mit -launcherlogin, und ein Editor kann „Wow.exe“ in seiner Zeile haben."""
    if WINDOWS:
        return _output(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                        "Get-CimInstance Win32_Process | ForEach-Object "
                        "{ if ($_.ExecutablePath) { $_.ExecutablePath } else { $_.Name } }"])
    if MACOS:
        return _output(["ps", "-axo", "comm="])
    programs = []
    for cmdline in Path("/proc").glob("[0-9]*/cmdline"):  # unter Wine steht hier der Windows-Pfad
        try:
            programs.append(cmdline.read_bytes().split(b"\0")[0].decode(errors="replace"))
        except OSError:
            continue  # inzwischen beendet
    return programs


# ---------------------------------------------------------------- helles oder dunkles Design

def prefers_dark() -> bool:
    """Ob das System auf dunkles Design gestellt ist."""
    if WINDOWS:
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") as key:
                return winreg.QueryValueEx(key, "AppsUseLightTheme")[0] == 0
        except OSError:
            return False
    if MACOS:
        return _output(["defaults", "read", "-g", "AppleInterfaceStyle"], timeout=3) == ["Dark"]
    # Linux: die Desktop-Einstellung über das XDG-Portal (KDE, GNOME u. a.): 1 = dunkel …
    answer = _output(["gdbus", "call", "--session", "--dest", "org.freedesktop.portal.Desktop",
                      "--object-path", "/org/freedesktop/portal/desktop",
                      "--method", "org.freedesktop.portal.Settings.Read",
                      "org.freedesktop.appearance", "color-scheme"], timeout=3)
    if answer:
        return "uint32 1" in answer[0]
    # … ohne Portal die GNOME-Einstellung
    answer = _output(["gsettings", "get", "org.gnome.desktop.interface", "color-scheme"], timeout=3)
    return bool(answer) and "dark" in answer[0]


def _output(command: list[str], timeout: float = 30) -> list[str]:
    """Die nicht leeren Ausgabezeilen eines Hilfsprogramms; fehlt es oder scheitert es, keine."""
    try:
        # errors="replace": PowerShell gibt Pfade mit Umlauten in der Konsolen-Codepage aus,
        # die nicht zu Pythons Vorgabe passen muss – das darf nicht zum Absturz führen.
        result = subprocess.run(command, capture_output=True, text=True, errors="replace",
                                timeout=timeout, creationflags=NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]
