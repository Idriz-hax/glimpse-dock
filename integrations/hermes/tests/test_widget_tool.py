import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from glimpse_dock.widget_tool import handle_widget


class WidgetToolTests(unittest.TestCase):
    def setUp(self): self.client = Mock()

    def test_translates_actions(self):
        cases = [
            ({"action": "create", "widget": {"id": "a"}}, "widget.create", {"widget": {"id": "a"}}),
            ({"action": "update", "id": "a", "title": "t"}, "widget.update", {"id": "a", "title": "t"}),
            ({"action": "set_visibility", "id": "a", "visible": False}, "widget.set-visibility", {"id": "a", "visible": False}),
            ({"action": "remove", "id": "a"}, "widget.remove", {"id": "a"}),
        ]
        self.client.send_widget.return_value = {"ok": True}
        for params, name, payload in cases:
            with self.subTest(params=params):
                self.assertEqual(handle_widget(params, self.client), {"ok": True})
                self.assertEqual(self.client.send_widget.call_args.args[:2], (name, payload))

    def test_rejects_unknown_and_owner_fields(self):
        for params in ({"action": "remove", "id": "x", "owner": "owner"},
                       {"action": "remove", "id": "x", "extra": 1},
                       {"action": "unknown"},
                       {"action": "create", "widget": {"version": 1, "id": "x", "owner": "agent"}},
                       {"action": "create", "widget": {"version": 1, "id": "x", "unexpected": True}}):
            with self.subTest(params=params):
                self.client.reset_mock()
                self.assertFalse(handle_widget(params, self.client)["ok"])
                self.client.send_widget.assert_not_called()

    def test_backend_error_is_not_success(self):
        self.client.send_widget.side_effect = RuntimeError("FORBIDDEN")
        result = handle_widget({"action": "remove", "id": "x"}, self.client)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "FORBIDDEN")


if __name__ == "__main__":
    unittest.main()
