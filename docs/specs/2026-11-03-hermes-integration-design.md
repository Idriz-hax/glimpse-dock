# Hermes Integration Design

**Status:** Approved design; implementation plan and code are not started. Live validation is deferred until the user tests on a Hermes installation.

## Goal and boundary

Add the first real-agent adapter for Hermes without scraping terminal output or guessing at undocumented APIs. Hermes remains responsible for its runtime; Glimpse Dock remains the authority for state, widget validation, persistence, and ownership.

The baseline is the official Hermes Agent **v0.22.6** documentation, pinned to the published tag. This is a documentation target, not a claim about an installed Hermes version: no Hermes executable or `~/.hermes` profile is available in the development environment. The user will perform live validation on a separate Hermes machine. Record this limitation and provide a version/mode checklist; do not mark live acceptance complete until results are supplied.

Official references:

- [v0.22.6 Event Hooks](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/website/docs/user-guide/features/hooks.md)
- [v0.22.6 Plugins](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/website/docs/user-guide/features/plugins.md)
- [v0.22.6 plugin authoring guide](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/website/docs/developer-guide/plugins/index.md)
- [v0.22.6 release](https://github.com/NousResearch/hermes-agent/releases/tag/v0.22.6)

## Selected approach

Ship an opt-in Python Hermes plugin in the repository, installed as a user plugin under `~/.hermes/plugins/` and explicitly enabled using Hermes' plugin controls. It uses documented `ctx.register_hook()` callbacks and `ctx.register_tool()`; the documented plugin surface covers CLI and Gateway sessions. Do not use Gateway-only `HOOK.yaml` hooks, project-local plugins, terminal scraping, or add a separate MCP/bridge process.

The plugin posts allowlisted state and widget commands to Glimpse Dock's existing authenticated `POST /api/command` endpoint, using the owner-created agent bearer credential. No new listener or external service is introduced. Configure the API URL and credential outside the repository (environment or the target Hermes profile's documented secret/config mechanism); never log or commit the credential. Keep the integration local/loopback-only, consistent with Glimpse Dock's current deployment boundary. If Hermes and Glimpse Dock run on separate machines, remote access is not part of this milestone.

The registered `glimpse_widget` tool exposes structured widget create, update, visibility, and remove operations only. It never accepts or forwards an owner field. Glimpse Dock derives the principal from the bearer credential and enforces that it can mutate only its own widgets; content is validated by the existing strict protocol schemas. The plugin reports backend validation/authorization errors without claiming success. The credential retains the existing agent API permissions for activity/task commands; no new finer-grained credential class is introduced in this milestone.

## Data handling and event normalization

Send event names, allowlisted enums, opaque session/turn identifiers where useful, and tool names only. Never send prompts, assistant response text, conversation history, tool arguments/results, approval prompt text, or raw Hermes hook dictionaries. Do not infer progress percentages. Use generic task text rather than copying a user's message into Display state.

| Requested state/event | v0.22.6 mechanism | Support and mapping |
| --- | --- | --- |
| Task start | `pre_llm_call` | Supported: set a generic active task/thinking state; do not transmit the user message. |
| Task update | `pre_tool_call`, `post_tool_call` | Supported: map tool execution to `tool-use`, then return to `thinking`; include no arguments/results. |
| Tool start/complete | `pre_tool_call`, `post_tool_call` | Supported: state transitions only; tool name may be included as bounded, escaped metadata if the existing protocol/UI can display it safely. |
| Waiting | `on_human_input_request`, `on_human_input_resolved` | Supported for documented approval, clarify, and sudo waits; only map the event/outcome, never the prompt or answer. |
| Responding | `on_stream_start`, `on_stream_end` | Supported only when Hermes emits streaming hooks; no response text is sent. Non-streaming response-start timing is unsupported. |
| Task complete/fail/interrupted | `on_session_end`; `agent_loop_stopped` for an explicit stop | Supported when the documented finalization outcome is present; map successful completion to `completed`, reported failure to `error`, and explicit interruption to a neutral inactive state. Do not treat a retryable provider request error alone as a failed task. |
| Online/offline | No documented cross-surface plugin lifecycle event that proves process presence | Unsupported; do not show inferred online/offline. |
| Idle | No reliable event indicating a live Hermes process is idle | Unsupported; do not infer idle from a completed turn. |

Before implementation, recheck these contracts against the pinned v0.22.6 source where public docs leave field timing ambiguous. If any field/hook cannot be verified, mark it unverified and omit that mapping rather than guessing.

## Delivery, errors, and cleanup

Hook delivery is fail-open: use short request timeouts, catch/log transport and HTTP errors, and never block or fail the Hermes turn because Glimpse Dock is unavailable. Use fresh stateless HTTP requests, which naturally retry connectivity on the next event; do not replay stale activity events or persist a plugin-side queue. Retrying a widget command may reuse its request ID because Glimpse Dock already makes widget lifecycle operations idempotent. Do not blindly retry non-idempotent activity commands after an ambiguous timeout.

At documented turn finalization and interruption hooks, clear progress and finalize activity: explicit success becomes `completed`, explicit failure becomes `error`, and explicit interruption becomes `idle` (meaning the turn stopped, not proof that Hermes is online). Extend the activity transition graph to allow active states to transition to `idle`, so this cleanup is accepted by the existing command path. Document that an abrupt Hermes process exit may leave the last reported activity until another event or owner action; online/offline detection is explicitly out of scope. Report connection state through Hermes plugin logs/tool results and Glimpse Dock's existing API response; do not claim a new Admin health panel.

## Verification

- Fixture tests cover every supported hook-to-command mapping, allowlisted payload filtering, malformed/unknown callbacks, lifecycle cleanup, widget tool validation and backend error handling, and transport failure/recovery on a later event.
- Existing Glimpse Dock integration tests continue to verify agent ownership, widget schemas, persistence, and authorization.
- Manual validation is separate and required before claiming Milestone 5 acceptance: record exact Hermes version, CLI/Gateway mode, plugin discovery/enablement, each exercised hook, widget ownership, failure/recovery behavior, and unavailable capabilities. Test on the user's Hermes installation; no local live test is possible in the current environment.

## Non-goals

No Hermes installation in this development environment; no telemetry of user/model content; no terminal scraping; no arbitrary widgets; no LAN/TLS access; no Hermes process-health heartbeat or online/offline/idle simulation; no general Hermes control-plane commands through the Glimpse Dock tool.
