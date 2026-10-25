"""Die Website spoken.rusty.one: JSON-Anfragen, Anmeldung und verständliche Fehlermeldungen."""
from __future__ import annotations

import http.client
import http.cookiejar
import json
import platform
import urllib.error
import urllib.request

from . import VERSION, system

SITE = "https://spoken.rusty.one"
REGISTER = SITE + "/deDE/register"
TIMEOUT = 120  # Sekunden; ein Paket mit 5000 NPC-Texten braucht ein wenig


class UploadError(Exception):
    """Erwarteter Fehler mit fertiger Meldung für den Nutzer; status = HTTP-Code, falls einer."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class Site:
    """Verbindung zur Website. Nach sign_in schickt sie das Sitzungs-Cookie bei jeder weiteren
    Anfrage mit; die Sitzung lebt nur so lange wie das Objekt, also einen Upload-Durchgang."""

    def __init__(self):
        cookies = urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        self._opener = urllib.request.build_opener(cookies)
        self._headers = {"content-type": "application/json", "origin": SITE,
                         "user-agent": f"spoken-contribute/{VERSION} ({platform.system()})"}

    def post(self, path: str, payload, what: str) -> dict:
        """JSON senden und die JSON-Antwort zurückgeben; jeder Fehler wird zum UploadError."""
        request = urllib.request.Request(SITE + path, json.dumps(payload).encode(), self._headers,
                                         method="POST")
        try:
            with self._opener.open(request, timeout=TIMEOUT) as response:
                body = response.read()
        except urllib.error.HTTPError as err:
            raise UploadError(_http_message(what, err), err.code) from None
        except (urllib.error.URLError, http.client.HTTPException, OSError) as err:
            raise UploadError(f"{what}: keine Verbindung zu spoken.rusty.one ({_reason(err)}).") from None
        try:
            result = json.loads(body)
        except ValueError:
            result = None
        if not isinstance(result, dict):
            raise UploadError(f"{what}: unerwartete Antwort vom Server.")
        return result

    def sign_in(self, email: str, password: str) -> dict:
        """Anmelden; gibt die Benutzerdaten des Servers zurück."""
        try:
            result = self.post("/api/auth/sign-in/email", {"email": email, "password": password}, "Anmeldung")
        except UploadError as err:
            if err.status == 401:
                raise UploadError("Anmeldung abgelehnt – E-Mail oder Passwort stimmen nicht.", 401) from None
            raise
        user = result.get("user")
        return user if isinstance(user, dict) else {}


def _http_message(what: str, err: urllib.error.HTTPError) -> str:
    if err.code == 429:
        return f"{what}: zu viele Uploads in der letzten Stunde, bitte später erneut."
    if err.code == 401:  # die Sitzung fehlt oder wurde nicht angenommen
        return f"{what}: nicht angemeldet (Server-Fehler 401) – bitte im Fenster ab- und neu anmelden."
    detail = _server_detail(err)
    if detail:
        return f"{what}: Server-Fehler {err.code} – {detail}."
    return f"{what}: Server-Fehler {err.code}."


def _server_detail(err: urllib.error.HTTPError) -> str:
    """Die Fehlerbeschreibung aus der JSON-Antwort des Servers, sonst leer."""
    try:
        body = json.load(err)
        detail = body.get("error") or body.get("message") or ""
    except Exception:
        return ""
    return str(detail)[:200]


def _reason(err: Exception) -> str:
    reason = str(getattr(err, "reason", err))
    if system.MACOS and "CERTIFICATE_VERIFY_FAILED" in reason:
        reason += " – unter macOS einmal „Install Certificates.command“ im Python-Programmordner ausführen"
    return reason
