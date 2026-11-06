import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from glimpse_dock.adapter import HermesEventAdapter


class HermesEventAdapterTests(unittest.TestCase):
    def setUp(self):
        self.adapter = HermesEventAdapter()

    def test_documented_event_mappings_filter_sensitive_fields(self):
        sensitive = {key: "DO-NOT-SEND" for key in
                     ("user_message", "result", "args", "prompt", "response")}
        cases = (
            ("pre_llm_call", {}, [("task.update", {"task": "Hermes is processing a turn"})]),
            ("pre_tool_call", {"tool_call_id": "opaque-1"}, [("task.update", {"task": "Hermes is using a tool"}), ("state.set-activity", {"activity": "tool-use"})]),
            ("post_tool_call", {"tool_call_id": "opaque-1"}, [("state.set-activity", {"activity": "thinking"})]),
            ("on_human_input_request", {}, [("state.set-activity", {"activity": "waiting"})]),
            ("on_human_input_resolved", {}, [("state.set-activity", {"activity": "thinking"})]),
            ("on_stream_start", {}, [("state.set-activity", {"activity": "responding"})]),
            ("on_stream_end", {}, [("state.set-activity", {"activity": "thinking"})]),
            ("on_session_end", {"completed": True}, [("state.set-activity", {"activity": "completed"})]),
            ("on_session_end", {"failed": True}, [("state.set-activity", {"activity": "error"})]),
            ("on_session_end", {"interrupted": True}, [
                ("state.set-progress", {"progress": None}),
                ("state.set-activity", {"activity": "idle"}),
            ]),
            ("agent_loop_stopped", {}, [
                ("state.set-progress", {"progress": None}),
                ("state.set-activity", {"activity": "idle"}),
            ]),
        )
        for event, kwargs, expected in cases:
            with self.subTest(event=event, kwargs=kwargs):
                self.assertEqual(self.adapter.handle(event, **(sensitive | kwargs)), expected)

    def test_tool_call_ids_track_parallel_work_and_clear_at_finalization(self):
        self.assertEqual(self.adapter.handle("pre_tool_call", tool_call_id="a"),
                         [("task.update", {"task": "Hermes is using a tool"}), ("state.set-activity", {"activity": "tool-use"})])
        self.adapter.handle("pre_tool_call", tool_call_id="b")
        self.assertEqual(self.adapter.handle("post_tool_call", tool_call_id="a"), [])
        self.assertEqual(self.adapter.handle("post_tool_call", tool_call_id="b"),
                         [("state.set-activity", {"activity": "thinking"})])
        self.adapter.handle("pre_tool_call", tool_call_id="a")
        self.adapter.handle("on_session_end", completed=True)
        self.assertEqual(self.adapter.handle("post_tool_call", tool_call_id="a"), [])

    def test_malformed_unknown_and_ambiguous_inputs_emit_nothing(self):
        for flags in ({}, {"completed": False, "failed": False},
                      {"completed": True, "failed": True},
                      {"completed": 1}, {"completed": True, "failed": False, "interrupted": True}):
            with self.subTest(flags=flags):
                self.assertEqual(self.adapter.handle("on_session_end", **flags), [])
        for event, kwargs in (("unknown", {}), ("pre_tool_call", {}),
                              ("pre_tool_call", {"tool_call_id": "x" * 129}),
                              ("post_tool_call", {"tool_call_id": []})):
            with self.subTest(event=event, kwargs=kwargs):
                self.assertEqual(self.adapter.handle(event, **kwargs), [])

    def test_invalid_tool_id_does_not_create_a_tracked_call(self):
        self.adapter.handle("pre_tool_call", tool_call_id="bad id")
        self.assertEqual(self.adapter.handle("post_tool_call", tool_call_id="bad id"), [])

    def test_active_tool_call_cap_refuses_new_ids_but_existing_calls_complete(self):
        cap = self.adapter._MAX_ACTIVE_TOOL_CALLS
        for index in range(cap):
            self.adapter.handle("pre_tool_call", tool_call_id=f"call-{index}")
        self.assertEqual(len(self.adapter._tool_calls), cap)
        self.assertEqual(self.adapter.handle("pre_tool_call", tool_call_id="overflow"), [])
        self.assertEqual(len(self.adapter._tool_calls), cap)
        self.assertEqual(self.adapter.handle("pre_tool_call", tool_call_id="call-0"),
                         [("task.update", {"task": "Hermes is using a tool"}), ("state.set-activity", {"activity": "tool-use"})])
        self.assertEqual(len(self.adapter._tool_calls), cap)
        self.assertEqual(self.adapter.handle("post_tool_call", tool_call_id="call-0"), [])
        self.assertEqual(len(self.adapter._tool_calls), cap - 1)

    def test_recognized_tool_names_emit_only_allowlisted_category(self):
        for tool_name, category in (("terminal", "shell"), ("python", "code"), ("search_files", "search")):
            with self.subTest(tool_name=tool_name):
                commands = self.adapter.handle("pre_tool_call", tool_call_id=tool_name,
                                               tool_name=tool_name, args="private", result="private")
                self.assertEqual(commands, [
                    ("task.update", {"task": "Hermes is using a tool", "toolCategory": category}),
                    ("state.set-activity", {"activity": "tool-use"}),
                ])

    def test_unknown_tool_name_omits_category(self):
        self.assertEqual(self.adapter.handle("pre_tool_call", tool_call_id="unknown",
                                             tool_name="unrecognized", args="private"),
                         [("task.update", {"task": "Hermes is using a tool"}),
                          ("state.set-activity", {"activity": "tool-use"})])


if __name__ == "__main__":
    unittest.main()
