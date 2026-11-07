import json
import os
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from glimpse_dock import register, _HOOKS


class Context:
    def __init__(self):
        self.hooks = {}
        self.tools = []

    def register_hook(self, name, callback):
        self.hooks[name] = callback

    def register_tool(self, name, toolset, schema, handler):
        self.tools.append((name, toolset, schema, handler))


class PluginTests(unittest.TestCase):
    def test_registration_and_callbacks_send_only_adapter_commands(self):
        ctx = Context()
        with patch.dict(os.environ, {"GLIMPSE_DOCK_AGENT_TOKEN": "test-token"}):
            with patch("glimpse_dock.GlimpseDockClient") as client_type:
                client = client_type.return_value
                client.send_widget.return_value = {"ok": True}
                register(ctx)
        self.assertEqual(set(ctx.hooks), set(_HOOKS))
        self.assertEqual(len(ctx.tools), 1)
        name, toolset, schema, handler = ctx.tools[0]
        self.assertEqual(name, "glimpse_widget")
        self.assertEqual(schema["name"], "glimpse_widget")
        self.assertTrue(schema["description"])
        self.assertEqual(set(schema), {"name", "description", "parameters"})
        self.assertTrue(schema["parameters"]["additionalProperties"] is False)
        client.send_activity.assert_not_called()
        self.assertIsNone(ctx.hooks["pre_llm_call"](prompt="sensitive"))
        client.send_activity.assert_called_once()
        command, payload = client.send_activity.call_args.args
        self.assertEqual(command, "task.update")
        self.assertEqual(payload["task"], "Hermes is processing a turn")
        self.assertTrue(payload["startTurn"])
        self.assertEqual(len(payload["turnId"]), 32)
        self.assertTrue(json.loads(handler({"action": "remove", "id": "x"}))["ok"])

    def test_missing_token_registers_and_callbacks_fail_open(self):
        ctx = Context()
        with patch.dict(os.environ, {}, clear=True):
            register(ctx)
        self.assertEqual(set(ctx.hooks), set(_HOOKS))
        self.assertIsNone(ctx.hooks["on_stream_start"]())
        self.assertEqual(json.loads(ctx.tools[0][3]({"action": "remove", "id": "x"})),
                         {"ok": False, "error": "CONFIGURATION"})

    def test_client_failure_returns_json_command_failed(self):
        ctx = Context()
        with patch.dict(os.environ, {"GLIMPSE_DOCK_AGENT_TOKEN": "token"}), \
                patch("glimpse_dock.GlimpseDockClient") as client_type:
            client_type.return_value.send_widget.side_effect = RuntimeError("failure")
            register(ctx)
        result = json.loads(ctx.tools[0][3]({"action": "remove", "id": "x"}))
        self.assertEqual(result, {"ok": False, "error": "COMMAND_FAILED"})

    def test_entire_callback_sequence_is_serialized(self):
        ctx = Context()
        with patch.dict(os.environ, {"GLIMPSE_DOCK_AGENT_TOKEN": "token"}), \
                patch("glimpse_dock.GlimpseDockClient") as client_type:
            client = client_type.return_value
            entered_first = threading.Event()
            release_first = threading.Event()
            second_entered = threading.Event()
            calls = 0
            guard = threading.Lock()
            def send(*args):
                nonlocal calls
                with guard:
                    calls += 1
                    current = calls
                if current == 1:
                    entered_first.set()
                    self.assertTrue(release_first.wait(2))
                else:
                    second_entered.set()
            client.send_activity.side_effect = send
            register(ctx)
        first = threading.Thread(target=ctx.hooks["pre_llm_call"])
        second = threading.Thread(target=ctx.hooks["pre_llm_call"])
        first.start()
        self.assertTrue(entered_first.wait(2))
        second.start()
        self.assertFalse(second_entered.wait(0.1))
        release_first.set()
        first.join(2)
        second.join(2)
        self.assertFalse(first.is_alive() or second.is_alive())
        self.assertTrue(second_entered.is_set())

    def test_widget_schema_accepts_structured_status_and_null_expiry_but_rejects_owner(self):
        ctx = Context()
        with patch.dict(os.environ, {"GLIMPSE_DOCK_AGENT_TOKEN": "token"}), \
                patch("glimpse_dock.GlimpseDockClient"):
            register(ctx)
        tool_schema = ctx.tools[0][2]
        self.assertEqual(set(tool_schema), {"name", "description", "parameters"})
        self.assertEqual(tool_schema["name"], "glimpse_widget")
        self.assertTrue(tool_schema["description"])
        schema = tool_schema["parameters"]
        widget_schema = schema["properties"]["widget"]
        widget = widget_schema["properties"]
        self.assertEqual(widget["expiresAt"]["type"], ["integer", "null"])
        self.assertEqual(widget_schema["required"], ["version", "id", "title", "content", "placement", "expiresAt"])
        self.assertEqual(widget["id"]["maxLength"], 64)
        self.assertEqual(widget["id"]["pattern"], "^[A-Za-z0-9._-]+$")
        self.assertEqual(widget["title"]["maxLength"], 256)
        self.assertEqual(widget["expiresAt"]["maximum"], 9007199254740991)
        status = widget["content"]["$ref"]
        self.assertEqual(status, "#/$defs/content")
        content = schema["$defs"]["content"]["oneOf"]
        status_schema = next(item for item in content if item["properties"]["kind"].get("const") == "status")
        self.assertEqual(status_schema["properties"]["tone"]["enum"], ["neutral", "info", "success", "warning", "error"])
        self.assertFalse(schema["additionalProperties"])
        self.assertFalse(widget_schema["additionalProperties"])
        self.assertNotIn("owner", widget)

    def test_transport_failure_is_swallowed(self):
        ctx = Context()
        with patch.dict(os.environ, {"GLIMPSE_DOCK_AGENT_TOKEN": "token"}), \
                patch("glimpse_dock.GlimpseDockClient") as client_type:
            client_type.return_value.send_activity.side_effect = RuntimeError("private text")
            register(ctx)
        self.assertIsNone(ctx.hooks["pre_llm_call"]())

    def test_later_event_recovers_after_timeout(self):
        ctx = Context()
        with patch.dict(os.environ, {"GLIMPSE_DOCK_AGENT_TOKEN": "token"}), \
                patch("glimpse_dock.GlimpseDockClient") as client_type:
            client = client_type.return_value
            client.send_activity.side_effect = [TimeoutError(), None]
            register(ctx)
        callback = ctx.hooks["pre_llm_call"]
        self.assertIsNone(callback())
        self.assertIsNone(callback())
        self.assertEqual(client.send_activity.call_count, 2)


if __name__ == "__main__":
    unittest.main()
