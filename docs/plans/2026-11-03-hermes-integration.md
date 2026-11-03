# Hermes Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Hermes v0.22.6 through an opt-in Python plugin that reports privacy-preserving activity and submits agent-owned structured widget commands to Glimpse Dock.

**Architecture:** The plugin runs through Hermes' documented `ctx.register_hook()` and `ctx.register_tool()` surface for CLI and Gateway. It normalizes an allowlist of lifecycle events and sends existing protocol commands to the loopback Glimpse Dock API using an agent bearer token; backend validation and ownership remain authoritative. Live Hermes validation is deferred to the user's installation.

**Tech Stack:** Python standard library for the Hermes plugin/client/tests; existing TypeScript, Zod, Fastify, Vitest, and SQLite for Glimpse Dock.

---

## File map

- Create `integrations/hermes/glimpse_dock/plugin.yaml` — Hermes plugin manifest.
- Create `integrations/hermes/glimpse_dock/__init__.py` — register documented Hermes hooks and `glimpse_widget` tool.
- Create `integrations/hermes/glimpse_dock/adapter.py` — map allowlisted Hermes hook payloads to Glimpse Dock commands; track concurrent tool calls safely.
- Create `integrations/hermes/glimpse_dock/client.py` — loopback-only short-timeout HTTP client, command IDs, errors, and safe widget retry.
- Create `integrations/hermes/glimpse_dock/widget_tool.py` — validate the tool's action/arguments and translate only widget lifecycle operations.
- Create `integrations/hermes/tests/test_adapter.py`, `test_client.py`, `test_widget_tool.py`, and `test_plugin.py` — Python `unittest` fixtures; no Hermes installation required.
- Modify `src/shared/protocol.ts` and `tests/protocol.test.ts` — allow explicit active-to-idle cleanup transitions.
- Create `docs/integrations/hermes.md` — versioned capabilities, install/configuration, credential setup, privacy, troubleshooting, and user-run live test checklist.
- Modify `PROJECT.md` and `docs/plans/2026-10-29-glimpse-dock-roadmap.md` — record implementation and explicitly leave live verification pending.

## Task sequence

1. Add and test the active-to-idle transition required for explicit interruption cleanup.
2. Implement the stateful hook-to-command adapter and test every documented mapping plus privacy filtering.
3. Implement the safe HTTP client and widget tool with unit tests for validation, errors, retry/idempotency, and secrets handling.
4. Wire the Hermes plugin manifest/hooks/tool and test registration with fake Hermes context objects.
5. Write integration setup/live-validation docs, update project/roadmap status, run all checks, and commit the verified work.

## Implementation details

### Command mapping contract

`GlimpseDockClient` sends `{ "v": 1, "requestId": "<uuid>", "type": "<command>", "payload": { ... } }` as JSON to `<base-url>/api/command`, with `Authorization: Bearer <agent-token>` and no browser cookie/CSRF. Keep this mapping exact:

| Hermes callback | Glimpse Dock command(s) |
| --- | --- |
| `pre_llm_call` | `task.update`, `{ "task": "Hermes is processing a turn" }` |
| `pre_tool_call` | `state.set-activity`, `{ "activity": "tool-use" }`; store bounded opaque `tool_call_id` only |
| `post_tool_call` | `state.set-activity`, `{ "activity": "thinking" }` only when no tracked tool calls remain |
| `on_human_input_request` | `state.set-activity`, `{ "activity": "waiting" }` |
| `on_human_input_resolved` | `state.set-activity`, `{ "activity": "tool-use" }` if tools remain, otherwise `{ "activity": "thinking" }` |
| `on_stream_start` / `on_stream_end` | `state.set-activity`, `{ "activity": "responding" }` / `{ "activity": "thinking" }`; omit stream text |
| `on_session_end` with `completed is True` / `failed is True` | `state.set-activity`, `{ "activity": "completed" }` / `{ "activity": "error" }`; do not use `task.complete` because it would invent 100% progress |
| `on_session_end` with `interrupted is True` or `agent_loop_stopped` | `state.set-progress`, `{ "progress": null }`, then `state.set-activity`, `{ "activity": "idle" }` |

If outcome flags are absent, non-boolean, or contradictory, emit no final-state command. Ignore Hermes payload keys not listed above. Activity callbacks never send raw session identifiers to the API unless they are validated as bounded opaque IDs and actually needed for local concurrency tracking.

The widget tool accepts one strict object with `action` in `create | update | set_visibility | remove`; `create` takes `widget`, `update` takes `id` plus optional `title/content/placement/expiresAt`, `set_visibility` takes `id` and boolean `visible`, and `remove` takes `id`. Reject additional keys, especially `owner`. Translate `set_visibility` into `widget.set-visibility` and preserve the backend's structured error code.

### Task 1: Permit explicit interruption cleanup

**Files:** modify `src/shared/protocol.ts`, `tests/protocol.test.ts`.

- [ ] **Step 1: Add a failing transition test.** In the `canTransitionActivity` tests add:

```ts
it('allows explicit interruption cleanup to idle from active states', () => {
  for (const activity of ['thinking', 'tool-use', 'responding', 'waiting'] as const) {
    expect(canTransitionActivity(activity, 'idle')).toBe(true);
  }
  expect(canTransitionActivity('completed', 'idle')).toBe(true);
  expect(canTransitionActivity('error', 'idle')).toBe(true);
});
```

- [ ] **Step 2: Run the focused test and confirm failure.** Run `npm test -- --run tests/protocol.test.ts`; expect the new active-state assertions to fail.
- [ ] **Step 3: Allow the transition.** Add `'idle'` to the `thinking`, `'tool-use'`, `responding`, and `waiting` arrays in `ActivityTransitions`; do not change other transition edges.
- [ ] **Step 4: Re-run protocol and server tests.** Run `npm test -- --run tests/protocol.test.ts tests/server.test.ts`; expect all tests to pass.
- [ ] **Step 5: Commit.** Commit only the protocol and test changes as `feat: allow explicit activity cleanup`.

### Task 2: Normalize Hermes events

**Files:** create `integrations/hermes/glimpse_dock/adapter.py`, `integrations/hermes/tests/test_adapter.py`.

- [ ] **Step 1: Add table-driven failing tests** for `pre_llm_call`, `pre_tool_call`, `post_tool_call`, `on_human_input_request`, `on_human_input_resolved`, `on_stream_start`, `on_stream_end`, `on_session_end`, and `agent_loop_stopped`. Test `on_session_end` for exactly one true outcome flag (`completed`, `failed`, or `interrupted`), all flags false/missing, and contradictory flags. Each test passes a fixture with deliberately sensitive extra keys (`user_message`, `result`, `args`, `prompt`, `response`) and asserts that normalized commands do not contain those values. Test parallel tool IDs so one completion leaves activity at `tool-use` until the last outstanding call completes.
- [ ] **Step 2: Run `python3 -B -m unittest discover -s integrations/hermes/tests -p 'test_adapter.py' -v`** and confirm failure because the adapter module/functions do not exist; `-B` avoids repository `__pycache__` artifacts.
- [ ] **Step 3: Implement `HermesEventAdapter.handle(event_name, **kwargs)`** returning a list of `(command_type, payload)` pairs. Use generic task text on `pre_llm_call`; map tool start/last tool completion, human wait/resolution, and stream start/end to the existing activity enum; map final outcome only when documented boolean fields are present; explicit interruption maps to `idle` and clears progress. Return no command for malformed, unknown, or ambiguous payloads. Never copy raw hook dictionaries or message content.
- [ ] **Step 4: Track parallel tool calls by opaque `tool_call_id` under a lock.** Do not return to `thinking` while another known tool call remains active; remove the call ID on completion and clear it at turn finalization/interruption. Bound accepted IDs and ignore malformed IDs.
- [ ] **Step 5: Run adapter fixtures and commit** as `feat: normalize Hermes lifecycle hooks`.

### Task 3: Add the authenticated client and widget tool

**Files:** create `integrations/hermes/glimpse_dock/client.py`, `widget_tool.py`, `integrations/hermes/tests/test_client.py`, and `test_widget_tool.py`.

- [ ] **Step 1: Write failing client tests** for default URL `http://127.0.0.1:4174`, missing bearer token, URL rejection (`https`, non-loopback host, URL userinfo, query/fragment), redirect refusal, JSON headers/body, structured HTTP errors, timeout/network failure, no secret in error text, and widget retry with the exact same request ID.
- [ ] **Step 2: Write failing widget-tool tests** for create, update, visibility, and remove command payloads; reject unknown fields and `owner`; pass backend 400/403/404/409 responses through as errors and never return a success result on failure.
- [ ] **Step 3: Run `python3 -B -m unittest discover -s integrations/hermes/tests -p 'test_client.py' -v`** and then the equivalent `test_widget_tool.py`; confirm both fail before implementation.
- [ ] **Step 4: Implement `GlimpseDockClient.send_activity(command_type, payload)`** with stdlib `urllib`, JSON request envelope, fresh UUID request ID, `Authorization: Bearer …`, 0.75-second timeout, and one attempt only. Validate the configured base URL is plain HTTP loopback (`localhost`, `127.0.0.1`, or `::1`) with no credentials/query/fragment; install a redirect handler that refuses all redirects so the bearer token cannot be forwarded to another host. Missing/invalid configuration returns a safe configuration error without raising into Hermes or logging the token/body.
- [ ] **Step 5: Implement `GlimpseDockClient.send_widget(command_type, payload, request_id=None)`** with the same transport and one retry only for timeout/connection failure, reusing the same request ID and exact body. Do not retry HTTP errors.
- [ ] **Step 6: Implement `handle_widget(params, client)`** for actions `create`, `update`, `set_visibility`, and `remove`. Construct only `widget.create`, `widget.update`, `widget.set-visibility`, or `widget.remove` payloads; never pass through arbitrary operation names or owner fields. Return a compact `{ok, error?}` result with the backend code and omit credentials/body details.
- [ ] **Step 7: Run both Python tests and commit** as `feat: add Hermes widget tool client`.

### Task 4: Wire the Hermes plugin

**Files:** create `integrations/hermes/glimpse_dock/plugin.yaml`, `__init__.py`, and `integrations/hermes/tests/test_plugin.py`.

- [ ] **Step 1: Add failing fake-context tests** asserting `register(ctx)` registers exactly the documented lifecycle hook names and one `glimpse_widget` tool; invoke callback fixtures and verify they use `HermesEventAdapter` and the client while always returning `None` to observer/control hooks.
- [ ] **Step 2: Run `python3 -B -m unittest discover -s integrations/hermes/tests -p 'test_plugin.py' -v`** and confirm the test fails before plugin files exist.
- [ ] **Step 3: Add `plugin.yaml`** with plugin name `glimpse-dock`, version `1.0.0`, and a description that states it reports metadata-only activity and provides structured widget management. Add no Python dependencies.
- [ ] **Step 4: Verify the pinned source before wiring.** At Hermes tag `v0.22.6`, check `VALID_HOOKS`, hook callback payloads, `PluginContext.register_tool`, and user-plugin discovery against the official docs linked in the design. If the tag contradicts the docs, mark that event/tool surface unverified and omit it; do not substitute guessed names.
- [ ] **Step 5: Implement `register(ctx)`** to instantiate the client from `GLIMPSE_DOCK_URL` (default `http://127.0.0.1:4174`) and `GLIMPSE_DOCK_AGENT_TOKEN`; register `pre_llm_call`, `pre_tool_call`, `post_tool_call`, `on_human_input_request`, `on_human_input_resolved`, `on_stream_start`, `on_stream_end`, `on_session_end`, and `agent_loop_stopped`, plus `glimpse_widget` using the documented Hermes `ctx.register_tool(name, toolset, schema, handler)` API.
- [ ] **Step 6: Keep hooks fail-open.** Catch transport/normalization exceptions, log only event name and generic error code, and return `None`; tool calls return structured failure instead. If the token is absent, still register hooks/tool so Hermes loads normally, but every callback/tool returns a clear `CONFIGURATION` error. Do not include user text, assistant text, args, results, prompts, or secrets in logs or API payloads.
- [ ] **Step 7: Run all Python plugin tests and commit** as `feat: add Hermes plugin hooks`.

### Task 5: Document setup and validation boundary

**Files:** create `docs/integrations/hermes.md`; modify `PROJECT.md` and `docs/plans/2026-10-29-glimpse-dock-roadmap.md`.

- [ ] **Step 1: Document pinned sources and scope.** Link the official v0.22.6 hook, plugin, and authoring docs; state that this is a docs target, not the locally installed version. Include the capability matrix and explicitly mark online/offline/idle and non-streaming response-start as unsupported.
- [ ] **Step 2: Document secure setup.** Explain the loopback-only URL and `GLIMPSE_DOCK_AGENT_TOKEN`; show the `/api/login` then owner-authenticated `/api/agents` requests (including cookie, CSRF, and same-loopback Origin requirements) and explain the returned secret is shown once, belongs in the Hermes process environment, is not committed, and must not be pasted into logs. Show `export GLIMPSE_DOCK_URL=http://127.0.0.1:4174`, setting the token without echoing it, copying the checked-in plugin into `~/.hermes/plugins/glimpse-dock/`, enabling it with `hermes plugins enable glimpse-dock`, and restarting the Hermes runtime. State that the plugin is installed at user scope (not project-local) so CLI/Gateway sessions can discover it.
- [ ] **Step 3: Add the user-run live checklist.** Instruct the user to record `hermes --version` and whether using CLI/Gateway; verify plugin discovery and enablement; observe task start, tool start/complete, human wait/resolution, streaming response when enabled, completion/failure/interruption; create/update/hide/remove a widget and confirm it is owned by the generated agent ID; stop Glimpse Dock temporarily and confirm Hermes remains usable, logs a generic failure, and resumes delivery on a later event. Include troubleshooting for missing URL/token, 401/403, unsupported hook/version, and the loopback-only constraint.
- [ ] **Step 4: Update project inventory** to list the Hermes plugin/docs and clarify live integration verification is pending; do not imply Hermes is locally installed or fully validated.
- [ ] **Step 5: Update roadmap Milestone 5** with status “Implementation ready; live validation pending” and retain the acceptance criterion as incomplete until the user reports results.
- [ ] **Step 6: Review the docs against code and commit** as `docs: add Hermes integration setup guide`.

### Task 6: Final verification

**Files:** no new files; verify repository and live-test status.

- [ ] **Step 1: Run focused Python tests:** `python3 -B -m unittest discover -s integrations/hermes/tests -v`; expect all tests pass without an installed Hermes package.
- [ ] **Step 2: Run focused TypeScript tests:** `npm test -- --run tests/protocol.test.ts tests/server.test.ts`; expect all pass.
- [ ] **Step 3: Run full checks:** `npm test`, `npm run build`, and `git diff --check`; expect test suite and build to pass and no whitespace errors.
- [ ] **Step 4: Verify no credentials or local profile files were added.** Inspect `git status --short` and the final diff; preserve unrelated untracked `.superpowers/` and SQLite files.
- [ ] **Step 5: Report limitation accurately:** local implementation/tests do not prove Hermes plugin discovery or hook behavior. Milestone 5 remains pending live validation on the user's Hermes installation; provide the exact docs path and checklist.
