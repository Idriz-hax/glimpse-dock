"""Privacy-preserving normalization of Hermes lifecycle hooks."""

import re
import threading


class HermesEventAdapter:
    _TOOL_ID = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z", re.ASCII)
    _MAX_ACTIVE_TOOL_CALLS = 128
    _TOOL_CATEGORIES = {
        "terminal": "shell", "shell": "shell", "execute": "shell",
        "python": "code", "edit_file": "code", "read_file": "code",
        "search_files": "search", "search": "search", "web_search": "search",
    }

    def __init__(self):
        self._lock = threading.Lock()
        self._tool_calls = set()

    @staticmethod
    def _activity(name):
        return [("state.set-activity", {"activity": name})]

    @staticmethod
    def _interrupted():
        return [("state.set-progress", {"progress": None}),
                ("state.set-activity", {"activity": "idle"})]

    def handle(self, event_name, **kwargs):
        if event_name == "pre_llm_call":
            return [("task.update", {"task": "Hermes is processing a turn"})]
        if event_name == "pre_tool_call":
            call_id = kwargs.get("tool_call_id")
            if not isinstance(call_id, str) or not self._TOOL_ID.fullmatch(call_id):
                return []
            with self._lock:
                if call_id not in self._tool_calls and len(self._tool_calls) >= self._MAX_ACTIVE_TOOL_CALLS:
                    return []
                self._tool_calls.add(call_id)
            category = self._TOOL_CATEGORIES.get(kwargs.get("tool_name"))
            task = {"task": "Hermes is using a tool"}
            if category:
                task["toolCategory"] = category
            return [("task.update", task), *self._activity("tool-use")]
        if event_name == "post_tool_call":
            call_id = kwargs.get("tool_call_id")
            if not isinstance(call_id, str) or not self._TOOL_ID.fullmatch(call_id):
                return []
            with self._lock:
                if call_id not in self._tool_calls:
                    return []
                self._tool_calls.remove(call_id)
                return [] if self._tool_calls else self._activity("thinking")
        if event_name == "on_human_input_request":
            return self._activity("waiting")
        if event_name == "on_human_input_resolved":
            with self._lock:
                activity = "tool-use" if self._tool_calls else "thinking"
            return self._activity(activity)
        if event_name == "on_stream_start":
            return self._activity("responding")
        if event_name == "on_stream_end":
            return self._activity("thinking")
        if event_name == "agent_loop_stopped":
            with self._lock:
                self._tool_calls.clear()
            return self._interrupted()
        if event_name == "on_session_end":
            flags = ("completed", "failed", "interrupted")
            values = [kwargs.get(key) for key in flags]
            if any(type(kwargs[key]) is not bool for key in flags if key in kwargs):
                return []
            active = [key for key, value in zip(flags, values) if value is True]
            if len(active) != 1:
                return []
            outcome = active[0]
            with self._lock:
                self._tool_calls.clear()
            if outcome == "interrupted":
                return self._interrupted()
            return self._activity("completed" if outcome == "completed" else "error")
        return []
