"""Privacy-preserving normalization of Hermes lifecycle hooks."""

import re
import threading
import uuid


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
        self._turn_id = None

    def _activity(self, name, turn_id=None):
        turn_id = self._turn_id if turn_id is None else turn_id
        payload = {"activity": name}
        if turn_id is not None:
            payload["turnId"] = turn_id
        return [("state.set-activity", payload)]

    def _interrupted(self, turn_id):
        return [("state.set-progress", {"progress": None}), *self._activity("idle", turn_id)]

    def handle(self, event_name, **kwargs):
        if event_name == "pre_llm_call":
            with self._lock:
                self._turn_id = uuid.uuid4().hex
                turn_id = self._turn_id
                self._tool_calls.clear()
            return [("task.update", {"task": "Hermes is processing a turn", "turnId": turn_id, "startTurn": True})]
        if event_name == "pre_tool_call":
            call_id = kwargs.get("tool_call_id")
            if not isinstance(call_id, str) or not self._TOOL_ID.fullmatch(call_id):
                return []
            with self._lock:
                turn_id = self._turn_id
                if turn_id is None or call_id not in self._tool_calls and len(self._tool_calls) >= self._MAX_ACTIVE_TOOL_CALLS:
                    return []
                self._tool_calls.add(call_id)
            category = self._TOOL_CATEGORIES.get(kwargs.get("tool_name"))
            task = {"task": "Hermes is using a tool", "turnId": turn_id}
            if category:
                task["toolCategory"] = category
            action = {"shell": "Used shell tool", "code": "Used code tool", "search": "Used search tool"}.get(category, "Used a tool")
            return [("task.update", task), ("state.set-latest-action", {"turnId": turn_id, "text": action}), *self._activity("tool-use", turn_id)]
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
                turn_id = self._turn_id
                self._turn_id = None
                self._tool_calls.clear()
            return self._interrupted(turn_id) if turn_id else []
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
                turn_id = self._turn_id
                self._turn_id = None
                self._tool_calls.clear()
            if turn_id is None:
                return []
            if outcome == "interrupted":
                return self._interrupted(turn_id)
            return self._activity("completed" if outcome == "completed" else "error", turn_id)
        return []
