"""Small authenticated client for the local Glimpse Dock command API."""
import http.client
import json
import socket
import urllib.error
import urllib.parse
import urllib.request
import uuid

_MAX_BODY_BYTES = 16384
_MAX_JSON_NODES = 256
_MAX_JSON_DEPTH = 16


def _check_widget_payload(value):
    """Bound traversal and string size before JSON serialization allocates output."""
    pending = [(value, 0)]
    nodes = 0
    string_chars = 0
    while pending:
        item, depth = pending.pop()
        nodes += 1
        if nodes > _MAX_JSON_NODES or depth > _MAX_JSON_DEPTH:
            raise GlimpseDockError("INVALID_COMMAND")
        if isinstance(item, str):
            string_chars += len(item)
            if string_chars > _MAX_BODY_BYTES:
                raise GlimpseDockError("INVALID_COMMAND")
        elif isinstance(item, dict):
            if len(pending) + (len(item) * 2) > _MAX_JSON_NODES - nodes:
                raise GlimpseDockError("INVALID_COMMAND")
            for key, child in item.items():
                pending.append((key, depth + 1))
                pending.append((child, depth + 1))
        elif isinstance(item, (list, tuple)):
            if len(pending) + len(item) > _MAX_JSON_NODES - nodes:
                raise GlimpseDockError("INVALID_COMMAND")
            for child in item:
                pending.append((child, depth + 1))


class GlimpseDockError(Exception):
    """A generic transport or backend failure safe to show to the agent."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def urlopen(request, timeout):
    return urllib.request.build_opener(_NoRedirect).open(request, timeout=timeout)


class GlimpseDockClient:
    def __init__(self, url="http://127.0.0.1:4174", token=None, timeout=0.75):
        if not isinstance(token, str) or not token:
            raise ValueError("A bearer token is required")
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
                or parsed.username is not None or parsed.password is not None
                or parsed.query or parsed.fragment):
            raise ValueError("URL must be plain HTTP on loopback")
        self.url = url.rstrip("/")
        self.token = token
        self.timeout = min(float(timeout), 3.0)

    def _send(self, command_type, payload, request_id=None, body=None):
        envelope = {"v": 1, "requestId": request_id or str(uuid.uuid4()),
                    "type": command_type, "payload": payload}
        data = body if body is not None else json.dumps(envelope, separators=(",", ":")).encode()
        req = urllib.request.Request(self.url + "/api/command", data=data, method="POST",
                                     headers={"Authorization": "Bearer " + self.token,
                                              "Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=self.timeout) as response:
                raw = response.read(16385)
                result = json.loads(raw)
        except urllib.error.HTTPError as exc:
            try:
                error = json.loads(exc.read(16385)).get("error", {})
                code = error.get("code") if isinstance(error, dict) else None
            except Exception:
                code = None
            raise GlimpseDockError(code if isinstance(code, str) else "HTTP_ERROR") from None
        except (urllib.error.URLError, TimeoutError, socket.timeout, OSError, http.client.HTTPException):
            raise GlimpseDockError("CONNECTION_ERROR") from None
        except (ValueError, TypeError):
            raise GlimpseDockError("INVALID_RESPONSE") from None
        if not isinstance(result, dict) or result.get("ok") is False:
            error = result.get("error", {}) if isinstance(result, dict) else {}
            code = error.get("code") if isinstance(error, dict) else None
            raise GlimpseDockError(code if isinstance(code, str) else "COMMAND_FAILED")
        return result

    def send_activity(self, command_type, payload):
        return self._send(command_type, payload)

    def send_widget(self, command_type, payload, request_id=None):
        _check_widget_payload(payload)
        envelope = {"v": 1, "requestId": request_id or str(uuid.uuid4()),
                    "type": command_type, "payload": payload}
        body = json.dumps(envelope, separators=(",", ":")).encode()
        if len(body) > _MAX_BODY_BYTES:
            raise GlimpseDockError("INVALID_COMMAND")
        try:
            return self._send(command_type, payload, envelope["requestId"], body)
        except GlimpseDockError as exc:
            if str(exc) != "CONNECTION_ERROR":
                raise
        try:
            return self._send(command_type, payload, envelope["requestId"], body)
        except GlimpseDockError as exc:
            raise exc
