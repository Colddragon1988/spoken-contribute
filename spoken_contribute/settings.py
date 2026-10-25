"""Einstellungen (WoW-Ordner, automatischer Upload) und die Zugangsdaten für spoken.rusty.one.

Beides liegt im Einstellungsordner des Benutzers, nicht im Programm. Die Zugangsdaten stehen
in einer eigenen Datei, die nur der Benutzer lesen darf; „Abmelden“ löscht sie."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from . import system

SETTINGS = system.config_dir() / "settings.json"
LOGIN = system.config_dir() / "login.json"


@dataclass
class Settings:
    wow_dir: str = ""
    auto_upload: bool = False


def _read_json(path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def load() -> Settings:
    """Gespeicherte Einstellungen; ist noch kein WoW-Ordner eingetragen, wird er gesucht."""
    data = _read_json(SETTINGS)
    settings = Settings(wow_dir=str(data.get("wow_dir") or ""), auto_upload=data.get("auto_upload") is True)
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


def load_login() -> dict | None:
    """{"email", "password"} oder None, wenn nicht angemeldet."""
    data = _read_json(LOGIN)
    if all(isinstance(data.get(key), str) and data[key] for key in ("email", "password")):
        return {"email": data["email"], "password": data["password"]}
    return None


def save_login(email: str, password: str):
    system.write_file(LOGIN, json.dumps({"email": email, "password": password}, ensure_ascii=False),
                      private=True)


def delete_login():
    LOGIN.unlink(missing_ok=True)
