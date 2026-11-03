"""Strict translation of Hermes widget-tool arguments to protocol commands."""
from .client import GlimpseDockError


def handle_widget(params, client):
    if not isinstance(params, dict) or not isinstance(params.get("action"), str):
        return {"ok": False, "error": "INVALID_ARGUMENTS"}
    action = params["action"]
    keys = {
        "create": {"action", "widget"},
        "update": {"action", "id", "title", "content", "placement", "expiresAt"},
        "set_visibility": {"action", "id", "visible"},
        "remove": {"action", "id"},
    }
    if action not in keys or set(params) - keys[action]:
        return {"ok": False, "error": "INVALID_ARGUMENTS"}
    payload = {k: v for k, v in params.items() if k != "action"}
    required = {"create": {"widget"}, "update": {"id"},
                "set_visibility": {"id", "visible"}, "remove": {"id"}}[action]
    if not required <= payload.keys():
        return {"ok": False, "error": "INVALID_ARGUMENTS"}
    if action == "create" and (
            not isinstance(payload["widget"], dict)
            or set(payload["widget"]) - {"version", "id", "title", "content", "placement", "expiresAt"}):
        return {"ok": False, "error": "INVALID_ARGUMENTS"}
    command = {"create": "widget.create", "update": "widget.update",
               "set_visibility": "widget.set-visibility", "remove": "widget.remove"}[action]
    try:
        return client.send_widget(command, payload)
    except GlimpseDockError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        code = str(exc)
        return {"ok": False, "error": code if code in {"BAD_REQUEST", "FORBIDDEN", "NOT_FOUND", "CONFLICT"} else "COMMAND_FAILED"}
