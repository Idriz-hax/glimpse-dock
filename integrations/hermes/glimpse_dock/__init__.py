"""Hermes plugin entry point for Glimpse Dock."""

import json
import logging
import os
import threading

from .adapter import HermesEventAdapter
from .client import GlimpseDockClient, GlimpseDockError
from .widget_tool import handle_widget

_LOG = logging.getLogger(__name__)
_HOOKS = (
    "pre_llm_call", "pre_tool_call", "post_tool_call",
    "on_human_input_request", "on_human_input_resolved",
    "on_stream_start", "on_stream_end", "on_session_end",
    "agent_loop_stopped",
)
_WIDGET_SCHEMA = {
    "name": "glimpse_widget",
    "description": "Create, update, show, hide, or remove a structured Glimpse Dock widget.",
    "parameters": {
    "type": "object",
    "$defs": {
        "color": {"type": "string", "enum": ["cyan", "mint", "blue", "purple", "amber", "muted", "white"]},
        "primitive": {"oneOf": [
            {"type": "object", "properties": {"kind": {"const": "text"}, "x": {"type": "number", "minimum": 0, "maximum": 100}, "y": {"type": "number", "minimum": 0, "maximum": 100}, "text": {"type": "string", "maxLength": 256}, "color": {"$ref": "#/$defs/color"}, "size": {"type": "number", "minimum": 0, "maximum": 20}}, "required": ["kind", "x", "y", "text", "color", "size"], "additionalProperties": False},
            {"type": "object", "properties": {"kind": {"const": "rect"}, "x": {"type": "number", "minimum": 0, "maximum": 100}, "y": {"type": "number", "minimum": 0, "maximum": 100}, "width": {"type": "number", "minimum": 0, "maximum": 100}, "height": {"type": "number", "minimum": 0, "maximum": 100}, "color": {"$ref": "#/$defs/color"}}, "required": ["kind", "x", "y", "width", "height", "color"], "additionalProperties": False},
            {"type": "object", "properties": {"kind": {"const": "circle"}, "cx": {"type": "number", "minimum": 0, "maximum": 100}, "cy": {"type": "number", "minimum": 0, "maximum": 100}, "radius": {"type": "number", "minimum": 0, "maximum": 100}, "color": {"$ref": "#/$defs/color"}}, "required": ["kind", "cx", "cy", "radius", "color"], "additionalProperties": False},
            {"type": "object", "properties": {"kind": {"const": "line"}, "x1": {"type": "number", "minimum": 0, "maximum": 100}, "y1": {"type": "number", "minimum": 0, "maximum": 100}, "x2": {"type": "number", "minimum": 0, "maximum": 100}, "y2": {"type": "number", "minimum": 0, "maximum": 100}, "color": {"$ref": "#/$defs/color"}, "width": {"type": "number", "minimum": 0, "maximum": 20}}, "required": ["kind", "x1", "y1", "x2", "y2", "color", "width"], "additionalProperties": False},
        ]},
        "content": {"oneOf": [
            {"type": "object", "properties": {"kind": {"const": "text"}, "text": {"type": "string", "maxLength": 4096}}, "required": ["kind", "text"], "additionalProperties": False},
            {"type": "object", "properties": {"kind": {"const": "status"}, "label": {"type": "string", "maxLength": 256}, "tone": {"type": "string", "enum": ["neutral", "info", "success", "warning", "error"]}}, "required": ["kind", "label", "tone"], "additionalProperties": False},
            {"type": "object", "properties": {"kind": {"const": "metric"}, "label": {"type": "string", "maxLength": 256}, "value": {"type": "string", "maxLength": 256}, "unit": {"type": "string", "maxLength": 32}, "caption": {"type": "string", "maxLength": 256}}, "required": ["kind", "label", "value"], "additionalProperties": False},
            {"type": "object", "properties": {"kind": {"const": "progress"}, "label": {"type": "string", "maxLength": 256}, "value": {"type": ["number", "null"], "minimum": 0, "maximum": 100}}, "required": ["kind", "label", "value"], "additionalProperties": False},
            {"type": "object", "properties": {"kind": {"const": "visual"}, "primitives": {"type": "array", "items": {"$ref": "#/$defs/primitive"}, "maxItems": 64}}, "required": ["kind", "primitives"], "additionalProperties": False},
        ]},
    },
    "properties": {
        "action": {"type": "string", "enum": ["create", "update", "set_visibility", "remove"]},
        "widget": {"type": "object", "additionalProperties": False,
                    "properties": {"version": {"type": "integer", "const": 1}, "id": {"type": "string", "maxLength": 64, "pattern": "^[A-Za-z0-9._-]+$"},
                                   "title": {"type": "string", "maxLength": 256}, "content": {"$ref": "#/$defs/content"},
                                   "placement": {"type": "string", "enum": ["primary", "secondary", "notification"]}, "expiresAt": {"type": ["integer", "null"], "minimum": 0, "maximum": 9007199254740991}},
                    "required": ["version", "id", "title", "content", "placement", "expiresAt"]},
        "id": {"type": "string", "maxLength": 64, "pattern": "^[A-Za-z0-9._-]+$"}, "title": {"type": "string", "maxLength": 256},
        "content": {"$ref": "#/$defs/content"}, "placement": {"type": "string", "enum": ["primary", "secondary", "notification"]},
        "expiresAt": {"type": ["integer", "null"], "minimum": 0, "maximum": 9007199254740991}, "visible": {"type": "boolean"},
    },
    "required": ["action"], "additionalProperties": False,
    },
}
_VOICE_SCHEMA = {
    "name": "glimpse_voice_control",
    "description": "Request listening or paused state in the opted-in owner display. Dispatch acknowledgement does not confirm microphone state.",
    "parameters": {"type": "object", "properties": {
        "state": {"type": "string", "enum": ["listening", "paused"]}},
        "required": ["state"], "additionalProperties": False},
}


def register(ctx):
    adapter = HermesEventAdapter()
    token = os.environ.get("GLIMPSE_DOCK_AGENT_TOKEN")
    try:
        client = GlimpseDockClient(os.environ.get("GLIMPSE_DOCK_URL", "http://127.0.0.1:4174"), token)
        configuration_error = None
    except Exception:
        client = None
        configuration_error = "CONFIGURATION"
    lock = threading.Lock()

    def hook(event_name):
        def callback(**kwargs):
            try:
                if client is None:
                    raise GlimpseDockError(configuration_error)
                # Adapter state changes and resulting commands must remain ordered across hooks.
                with lock:
                    commands = adapter.handle(event_name, **kwargs)
                    for command_type, payload in commands:
                        client.send_activity(command_type, payload)
            except Exception as exc:
                code = str(exc) if str(exc) in {"CONFIGURATION", "CONNECTION_ERROR"} else "ERROR"
                _LOG.warning("Glimpse Dock hook %s failed: %s", event_name, code)
            return None
        return callback

    for name in _HOOKS:
        ctx.register_hook(name, hook(name))

    def widget_handler(params):
        if client is None:
            return json.dumps({"ok": False, "error": "CONFIGURATION"}, default=str)
        try:
            return json.dumps(handle_widget(params, client), default=str)
        except Exception:
            return json.dumps({"ok": False, "error": "COMMAND_FAILED"}, default=str)

    ctx.register_tool("glimpse_widget", "glimpse_dock", _WIDGET_SCHEMA, widget_handler)

    def voice_handler(params):
        if not isinstance(params, dict) or set(params) != {"state"} or params["state"] not in ("listening", "paused"):
            return json.dumps({"accepted": False, "error": "INVALID_COMMAND"})
        if client is None:
            return json.dumps({"accepted": False, "error": "CONFIGURATION"})
        try:
            return json.dumps(client.set_voice_state(params["state"]))
        except GlimpseDockError as exc:
            code = str(exc)
            return json.dumps({"accepted": False, "error": code if code in {
                "NO_OWNER_DISPLAY", "CONTROL_BUSY", "DENIED", "TIMEOUT", "DISCONNECTED",
                "CONFIGURATION", "CONNECTION_ERROR", "HTTP_ERROR"} else "REQUEST_FAILED"})
        except Exception:
            return json.dumps({"accepted": False, "error": "REQUEST_FAILED"})

    ctx.register_tool("glimpse_voice_control", "glimpse_dock", _VOICE_SCHEMA, voice_handler)
