import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from glimpse_dock.client import GlimpseDockClient, GlimpseDockError


class ClientTests(unittest.TestCase):
    @patch("glimpse_dock.client.urlopen")
    def test_voice_state_exact_route_payload_and_bounded_timeout(self, open_url):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size=-1): return b'{"accepted":true,"status":"DISPATCHED"}'
        open_url.return_value = Response()
        client = GlimpseDockClient(token="secret")
        result = client.set_voice_state("listening")
        request, timeout = open_url.call_args.args[0], open_url.call_args.kwargs["timeout"]
        self.assertEqual(request.full_url, "http://127.0.0.1:4174/api/agent/voice-control")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")
        self.assertEqual(json.loads(request.data), {"state": "listening"})
        self.assertGreater(timeout, 1.5)
        self.assertLessEqual(timeout, 3)
        self.assertTrue(result["accepted"])

    @patch("glimpse_dock.client.urlopen")
    def test_voice_state_rejects_invalid_state_without_network(self, open_url):
        with self.assertRaises(GlimpseDockError):
            GlimpseDockClient(token="secret").set_voice_state("record")
        open_url.assert_not_called()

    def test_requires_token_and_rejects_unsafe_urls(self):
        with self.assertRaises(ValueError):
            GlimpseDockClient(token="")
        for url in ("https://127.0.0.1", "http://example.com", "http://u:p@127.0.0.1",
                    "http://127.0.0.1/?x=y", "http://127.0.0.1/#x"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                GlimpseDockClient(url=url, token="secret")
        self.assertEqual(GlimpseDockClient(url="http://127.0.0.1:9999", token="secret").url,
                         "http://127.0.0.1:9999")

    @patch("glimpse_dock.client.urlopen")
    def test_authenticated_post_and_json_result(self, open_url):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size=-1): return b'{"ok":true}'
        open_url.return_value = Response()
        client = GlimpseDockClient(token="secret")
        client.send_activity("state.set-activity", {"activity": "thinking"})
        req = open_url.call_args.args[0]
        self.assertEqual(req.full_url, "http://127.0.0.1:4174/api/command")
        self.assertEqual(req.get_header("Authorization"), "Bearer secret")
        self.assertEqual(json.loads(req.data)["type"], "state.set-activity")

    def test_default_timeout(self):
        self.assertEqual(GlimpseDockClient(token="secret").timeout, 0.75)

    @patch("glimpse_dock.client.urlopen", side_effect=HTTPError("x", 302, "Found", {}, None))
    def test_http_errors_do_not_leak_details(self, open_url):
        with self.assertRaises(Exception) as caught:
            GlimpseDockClient(token="secret").send_activity("state.set-activity", {"activity": "thinking"})
        self.assertNotIn("secret", str(caught.exception))
        self.assertNotIn("302", str(caught.exception))

    @patch("glimpse_dock.client.urlopen", side_effect=TimeoutError("secret body"))
    def test_activity_is_not_retried_and_error_is_generic(self, open_url):
        client = GlimpseDockClient(token="secret")
        with self.assertRaises(Exception) as caught:
            client.send_activity("task.update", {"task": "processing"})
        self.assertEqual(open_url.call_count, 1)
        self.assertNotIn("secret", str(caught.exception))

    @patch("glimpse_dock.client.urlopen")
    def test_widget_retries_connection_once_with_identical_request(self, open_url):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size=-1): return b'{"ok":true}'
        open_url.side_effect = [URLError("offline"), Response()]
        GlimpseDockClient(token="secret").send_widget("widget.remove", {"id": "x"}, "rid")
        self.assertEqual(open_url.call_count, 2)
        self.assertEqual(open_url.call_args_list[0].args[0].data, open_url.call_args_list[1].args[0].data)

    @patch("glimpse_dock.client.urlopen")
    def test_widget_rejects_oversized_nested_and_extreme_strings_before_network(self, open_url):
        client = GlimpseDockClient(token="secret")
        for payload in ({"value": "x" * 20000}, [[[[[[[[[[[[[[[[[[0]]]]]]]]]]]]]]]]]],
                        {"items": [str(i) for i in range(300)]}, [None] * 100000,
                        {str(i): i for i in range(100000)}):
            with self.subTest(payload_type=type(payload)), self.assertRaises(GlimpseDockError) as caught:
                client.send_widget("widget.add", payload)
            self.assertEqual(str(caught.exception), "INVALID_COMMAND")
        open_url.assert_not_called()

    @patch("glimpse_dock.client.urlopen")
    def test_valid_widget_body_within_limit_is_sent(self, open_url):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size=-1): return b'{"ok":true}'
        open_url.return_value = Response()
        GlimpseDockClient(token="secret").send_widget("widget.add", {"label": "ok"})
        self.assertLessEqual(len(open_url.call_args.args[0].data), 16384)


if __name__ == "__main__":
    unittest.main()
