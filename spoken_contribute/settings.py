"""Einstellungen (WoW-Ordner, automatischer Upload, Design) und die Anmeldung bei spoken.rusty.one.

Beides liegt beim Benutzer, nicht im Programm. Das Passwort steht im Schlüsselbund des Systems
(Windows-Anmeldeinformationsverwaltung, macOS-Schlüsselbund, KWallet oder GNOME-Schlüsselbund),
wenn das Python-Paket „keyring“ installiert ist und einen Schlüsselbund findet. Sonst steht es in
login.json, die nur der Benutzer lesen darf. Die E-Mail-Adresse steht immer in login.json.
„Abmelden“ löscht beides."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from . import system

SETTINGS = system.config_dir() / "settings.json"
LOGIN = system.config_dir() / "login.json"
KEYRING_SERVICE = "spoken-contribute"
THEMES = {"system": "Wie System", "hell": "Hell", "dunkel": "Dunkel"}


@dataclass
class Settings:
    wow_dir: str = ""
    auto_upload: bool = False
    theme: str = "system"  # ein Schlüssel aus THEMES


def _read_json(path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def load() -> Settings:
    """Gespeicherte Einstellungen; ist noch kein WoW-Ordner eingetragen, wird er gesucht."""
    data = _read_json(SETTINGS)
    settings = Settings(wow_dir=str(data.get("wow_dir") or ""),
                        auto_upload=data.get("auto_upload") is True,
                        theme=data.get("theme") if data.get("theme") in THEMES else "system")
    if not settings.wow_dir:
        found = system.find_wow()
        if found:
            settings.wow_dir = str(found)
            try:
                save(settings)
            except OSError:
                pass  # dann wird beim nächsten Start eben erneut gesucht
    return settings


def save(settings: Settings):
    system.write_file(SETTINGS, json.dumps(asdict(settings), ensure_ascii=False, indent=2))


# ---------------------------------------------------------------- Anmeldung

def _keyring():
    """Das Modul keyring, wenn es einen benutzbaren Schlüsselbund gibt; sonst None."""
    try:
        import keyring
        backend = keyring.get_keyring()
    except Exception:  # nicht installiert oder kaputt eingerichtet
        return None
    # Ohne echten Schlüsselbund liefert keyring einen Platzhalter mit Priorität 0.
    return keyring if getattr(backend, "priority", 0) > 0 else None


def account() -> str | None:
    """Die E-Mail-Adresse der Anmeldung, sonst None. Öffnet den Schlüsselbund nicht."""
    email = _read_json(LOGIN).get("email")
    return email if isinstance(email, str) and email else None


def password_in_keyring() -> bool:
    """Ob das Passwort der aktuellen Anmeldung im Schlüsselbund steht (statt in login.json)."""
    return account() is not None and not _read_json(LOGIN).get("password")


def credentials() -> dict | None:
    """{"email", "password"} der Anmeldung, None wenn nicht angemeldet. "password" ist None,
    wenn der Schlüsselbund es nicht herausgibt. Kann eine Entsperr-Abfrage des Schlüsselbunds
    auslösen – daher nicht im Fenster-Thread aufrufen."""
    data = _read_json(LOGIN)
    email = account()
    if not email:
        return None
    password = data.get("password")
    if not (isinstance(password, str) and password):
        password = _keyring_get(email)
    return {"email": email, "password": password}


def save_login(email: str, password: str):
    """Anmeldung speichern; das Passwort möglichst im Schlüsselbund."""
    delete_login()  # eine frühere Anmeldung samt Schlüsselbund-Eintrag entfernen
    if _keyring_set(email, password):
        _write_login(email, None)
    else:
        _write_login(email, password)


def move_password_to_keyring():
    """Ein Passwort, das noch in login.json steht (frühere Fassung oder damals kein
    Schlüsselbund), in den Schlüsselbund umziehen – sobald es einen gibt."""
    data = _read_json(LOGIN)
    email, password = account(), data.get("password")
    if email and isinstance(password, str) and password and _keyring_set(email, password):
        _write_login(email, None)


def delete_login():
    email = account()
    ring = _keyring() if email else None
    if ring:
        try:
            ring.delete_password(KEYRING_SERVICE, email)
        except Exception:
            pass  # gab es dort nicht
    LOGIN.unlink(missing_ok=True)


def _write_login(email: str, password: str | None):
    data = {"email": email}
    if password:
        data["password"] = password
    system.write_file(LOGIN, json.dumps(data, ensure_ascii=False), private=True)


def _keyring_get(email: str) -> str | None:
    ring = _keyring()
    if not ring:
        return None
    try:
        return ring.get_password(KEYRING_SERVICE, email)
    except Exception:  # gesperrt, abgelehnt oder Dienst nicht erreichbar
        return None


def _keyring_set(email: str, password: str) -> bool:
    """Passwort in den Schlüsselbund schreiben; True nur, wenn es nachweislich dort steht."""
    ring = _keyring()
    if not ring:
        return False
    try:
        ring.set_password(KEYRING_SERVICE, email, password)
        return ring.get_password(KEYRING_SERVICE, email) == password
    except Exception:
        return False
