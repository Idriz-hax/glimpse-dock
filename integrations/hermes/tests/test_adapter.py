import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from glimpse_dock.adapter import HermesEventAdapter


class HermesEventAdapterTests(unittest.TestCase):
    def setUp(self):
        self.adapter = HermesEventAdapter()

    def start(self):
        commands = self.adapter.handle("pre_llm_call", user_message="private")
        self.assertEqual(commands[0][0], "task.update")
        self.assertEqual(commands[0][1]["task"], "Hermes is processing a turn")
        self.assertTrue(commands[0][1]["startTurn"])
        turn_id = commands[0][1]["turnId"]
        self.assertEqual(len(turn_id), 32)
        return turn_id

    def test_pre_llm_allocates_turn_id_reused_on_tool_and_activity_events(self):
        turn_id = self.start()
        self.assertEqual(self.adapter.handle("pre_tool_call", tool_call_id="c1", tool_name="terminal", args="private"), [
            ("task.update", {"task": "Hermes is using a tool", "toolCategory": "shell", "turnId": turn_id}),
            ("state.set-latest-action", {"turnId": turn_id, "text": "Used shell tool"}),
            ("state.set-activity", {"activity": "tool-use", "turnId": turn_id}),
        ])
        self.assertEqual(self.adapter.handle("post_tool_call", tool_call_id="c1"), [("state.set-activity", {"activity": "thinking", "turnId": turn_id})])
        self.assertEqual(self.adapter.handle("on_stream_start"), [("state.set-activity", {"activity": "responding", "turnId": turn_id})])

    def test_tool_categories_are_normalized_and_arbitrary_kwargs_never_escape(self):
        turn_id = self.start()
        for tool_name, category, text in (("python", "code", "Used code tool"), ("search_files", "search", "Used search tool"), ("unknown", None, "Used a tool")):
            with self.subTest(tool_name=tool_name):
                commands = self.adapter.handle("pre_tool_call", tool_call_id=tool_name, tool_name=tool_name, args="SECRET", result="SECRET", prompt="SECRET", arbitrary="SECRET")
                self.assertEqual(commands[0][1]["turnId"], turn_id)
                self.assertEqual(commands[1], ("state.set-latest-action", {"turnId": turn_id, "text": text}))
                self.assertNotIn("SECRET", repr(commands))
                self.adapter.handle("post_tool_call", tool_call_id=tool_name)

    def test_new_start_uses_fresh_id_and_rejects_no_turn_tool_call(self):
        self.assertEqual(self.adapter.handle("pre_tool_call", tool_call_id="before"), [])
        first = self.start()
        second = self.start()
        self.assertNotEqual(first, second)

    def test_terminal_and_interruption_tag_transition_then_clear_turn_id(self):
        turn_id = self.start()
        self.assertEqual(self.adapter.handle("on_session_end", completed=True), [("state.set-activity", {"activity": "completed", "turnId": turn_id})])
        self.assertEqual(self.adapter.handle("on_stream_start"), [("state.set-activity", {"activity": "responding"})])
        next_id = self.start()
        self.assertEqual(self.adapter.handle("agent_loop_stopped"), [
            ("state.set-progress", {"progress": None}),
            ("state.set-activity", {"activity": "idle", "turnId": next_id}),
        ])
        self.assertEqual(self.adapter.handle("on_stream_end"), [("state.set-activity", {"activity": "thinking"})])

    def test_invalid_and_ambiguous_events_do_not_emit(self):
        self.start()
        self.assertEqual(self.adapter.handle("on_session_end"), [])
        self.assertEqual(self.adapter.handle("on_session_end", completed=True, failed=True), [])
        self.assertEqual(self.adapter.handle("pre_tool_call", tool_call_id="bad id"), [])


if __name__ == "__main__":
    unittest.main()
