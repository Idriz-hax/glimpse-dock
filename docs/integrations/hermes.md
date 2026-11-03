# Hermes integration

**Status:** The opt-in plugin and fixture tests are implemented. Live validation is pending on a Hermes installation supplied by the user. Hermes is not installed in the development environment; **v0.22.6 is the documentation/source baseline, not a locally tested or installed version.**

## Verified surface and capability matrix

The plugin uses the official Python plugin API (`ctx.register_hook()` and `ctx.register_tool()`) documented for Hermes CLI and Gateway. The hook names and `PluginContext.register_tool` signature were checked against the official v0.22.6 source. Field behavior and version/provider compatibility still require the live test below. No terminal scraping, Gateway-only `HOOK.yaml` hook, or private runtime API is used.

Sources:

- [Event Hooks, Hermes v0.22.6](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/website/docs/user-guide/features/hooks.md)
- [Plugins, Hermes v0.22.6](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/website/docs/user-guide/features/plugins.md)
- [Plugin authoring guide, Hermes v0.22.6](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/website/docs/developer-guide/plugins/index.md)
- [Plugin API source, Hermes v0.22.6](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/hermes_cli/plugins.py)
- [Tool registry source, Hermes v0.22.6](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/tools/registry.py)

| Requested event/state | Status | Verified hook and behavior |
| --- | --- | --- |
| Online / offline | **Unsupported** | No registered plugin hook proves Hermes process presence. The integration does not synthesize a heartbeat. |
| Idle | **Unsupported as presence/status** | No reliable idle/presence event. An explicit `agent_loop_stopped` or unambiguous `interrupted: true` clears activity to `idle`; that means the turn stopped, not that Hermes is online or idle. |
| Task start | **Supported** | `pre_llm_call` sends generic task text, “Hermes is processing a turn”; message/history fields are ignored. |
| Task update | **Supported, minimal** | Tool lifecycle, human-input, and streaming hooks update activity only. No guessed progress percentage or conversation text is sent. |
| Tool start / complete | **Supported, state only** | `pre_tool_call` maps to `tool-use`; `post_tool_call` returns to `thinking` after the last tracked call. Bounded tool-call IDs are local-only; names, arguments, results, and errors are not sent. Tool-specific failure is not inferred. |
| Waiting for human input | **Supported** | `on_human_input_request` maps to `waiting`; `on_human_input_resolved` resumes `thinking` or `tool-use`. Prompt and response text are ignored. |
| Responding | **Stream-dependent** | `on_stream_start` / `on_stream_end` map to `responding` / `thinking` when those hooks fire. Stream/final response text is ignored. No non-streaming response-start signal is claimed. |
| Task complete / fail | **Supported when explicit** | `on_session_end` maps only one unambiguous boolean outcome: `completed: true` to `completed`, `failed: true` to `error`. Missing, non-boolean, or contradictory outcome flags produce no final-state command. |
| Interrupted turn | **Supported when explicit** | `agent_loop_stopped` or `interrupted: true` clears progress and sets `idle`. An abrupt process exit may leave the last reported state. |
| Widget create / update / show / hide / remove | **Supported, permission-scoped** | The `glimpse_widget` tool submits only structured widget lifecycle commands. The server derives the agent identity from its bearer credential, validates the protocol, and permits an agent to mutate only its own widgets. |

Only fixed activity labels, generic task text, and validated widget command fields are transmitted. Prompts, assistant responses, history, tool arguments/results, approval text, and raw Hermes hook dictionaries are never sent. Activity callbacks are serialized through normalization and delivery; activity events are not queued or replayed after a connection failure. Widget retries reuse the same request ID and exact body, relying on backend idempotency.

The tool schema describes the protocol’s structured content kinds. The backend remains authoritative for all value validation, UTF-8 content limits, authorization, ownership, and persistence. Hermes/provider acceptance of the schema’s JSON Schema constructs (`$defs`, `$ref`, `oneOf`) has not been tested through a live Hermes runtime; use the validation checklist and report any version/provider incompatibility.

## Requirements and local boundary

- Glimpse Dock and Hermes must run on the **same machine**. The backend is loopback-only; remote/LAN Hermes access is unsupported.
- The server must be listening on loopback at the configured URL. Default: `http://127.0.0.1:4174`; set `GLIMPSE_DOCK_URL` if the server uses a different loopback port.
- Use a dedicated Glimpse Dock agent credential, not an owner session cookie or password. `GLIMPSE_DOCK_AGENT_TOKEN` is read by the Hermes process and must not be committed or written into the plugin manifest.
- The credential carries the existing agent API permissions (activity/task commands and agent-owned widget operations); this milestone does not add a narrower widget-only credential.
- Python standard library only; no Python package installation is required.

## Create a dedicated agent credential

Start Glimpse Dock and complete owner setup first. The following Python 3 snippet prompts for the owner password without echoing it, uses an in-memory cookie jar, posts to the owner-authenticated agent endpoint, and stores the returned one-time secret in a user-only file. It does not print the secret. Run it in a trusted local terminal; do not enable shell tracing.

```sh
python3 - <<'PY'
import getpass
import http.cookiejar
import json
import os
from pathlib import Path
from urllib.request import HTTPCookieProcessor, Request, build_opener

base = "http://127.0.0.1:4174"  # change only to another loopback URL/port
opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

def post(path, payload):
    request = Request(
        base + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Origin": base},
        method="POST",
    )
    with opener.open(request, timeout=3) as response:
        return json.load(response)

login = post("/api/login", {"password": getpass.getpass("Owner password: ")})
agent = post("/api/agents", {"csrf": login["csrf"]})
token_file = Path.home() / ".config/glimpse-dock/hermes-agent-token"
token_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(token_file.parent, 0o700)
token_file.write_text(agent["secret"] + "\n")
os.chmod(token_file, 0o600)
print(f"Created agent {agent['id']}; secret saved to {token_file} (mode 0600).")
PY
```

In the same shell that will launch Hermes, load the secret without printing it:

```sh
export GLIMPSE_DOCK_URL=http://127.0.0.1:4174
export GLIMPSE_DOCK_AGENT_TOKEN="$(python3 -c 'from pathlib import Path; print(Path.home().joinpath(".config/glimpse-dock/hermes-agent-token").read_text().strip())')"
```

For a Gateway or service-managed Hermes process, configure these variables in that process’s secure environment/secret manager and restart it; an interactive-shell export does not update an already-running service. Do not paste the token into logs, issue reports, shared shell history, or repository files. If the credential file is exposed, revoke that credential and create a replacement.

To revoke the saved agent credential, run this owner-authenticated Python request while the service is available; the endpoint expects the SHA-256 digest of the secret, not the returned agent ID:

```sh
python3 - <<'PY'
import getpass
import hashlib
import http.cookiejar
import json
from pathlib import Path
from urllib.request import HTTPCookieProcessor, Request, build_opener

base = "http://127.0.0.1:4174"
opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
def post(path, payload):
    req = Request(base + path, data=json.dumps(payload).encode(),
                  headers={"Content-Type": "application/json", "Origin": base}, method="POST")
    with opener.open(req, timeout=3) as response: return json.load(response)

login = post("/api/login", {"password": getpass.getpass("Owner password: ")})
token_file = Path.home() / ".config/glimpse-dock/hermes-agent-token"
token = token_file.read_text().strip()
digest = hashlib.sha256(token.encode()).hexdigest()
req = Request(base + "/api/agents/" + digest,
              data=json.dumps({"csrf": login["csrf"]}).encode(),
              headers={"Content-Type": "application/json", "Origin": base}, method="DELETE")
with opener.open(req, timeout=3): pass
token_file.unlink()
print("Agent credential revoked and local token file deleted.")
PY
unset GLIMPSE_DOCK_AGENT_TOKEN
```

## Install and enable

From the Glimpse Dock checkout containing this integration:

```sh
mkdir -p "$HOME/.hermes/plugins/glimpse-dock"
cp -R integrations/hermes/glimpse_dock/. "$HOME/.hermes/plugins/glimpse-dock/"
hermes plugins validate "$HOME/.hermes/plugins/glimpse-dock"
hermes plugins doctor glimpse-dock
hermes plugins enable glimpse-dock
```

The plugin is installed at user scope under `~/.hermes/plugins/`, which is the documented discovery location for CLI and Gateway. Enablement/reload details can vary by Hermes release; restart the CLI/Gateway process after setting its environment and enabling the plugin. Confirm discovery with `hermes plugins list` and inspect plugin diagnostics if available. The plugin remains opt-in; no Hermes home files are modified automatically by Glimpse Dock.

## User-run live validation checklist

Record the exact `hermes --version`, operating system, CLI or Gateway mode, provider/model, and whether streaming is enabled. The v0.22.6 documentation target is not a substitute for the installed version. Run CLI and Gateway checks separately if both are in use.

1. Confirm Glimpse Dock is reachable at the loopback URL and Hermes has the token in its process environment. Verify the plugin is discovered, validates, and is enabled; note any schema/tool-registration warnings.
2. Start a harmless turn and confirm generic task activity appears. Confirm no prompt/response text or tool arguments/results appear in Glimpse Dock state or Hermes logs.
3. Exercise a tool call; observe `tool-use` then `thinking`. Exercise a human-input/approval wait if available; observe `waiting` and resumption without any approval text being transmitted.
4. If streaming is enabled, observe `responding` during output. Test successful completion, an explicit failure, and an explicit interruption; record any outcome that remains ambiguous or unsupported. Do not interpret `idle` after interruption as process presence.
5. Use `glimpse_widget` to create a status widget, update it, show/hide it, and remove it. Confirm the widget appears on Display, its owner is the new agent identity, backend errors are reported as failures, and attempts to manage another principal’s widget are rejected.
6. In a safe test run only, briefly stop Glimpse Dock while Hermes remains active. Confirm Hermes continues, the plugin logs only a generic failure, no stale activity events replay after recovery, and a later new event sends successfully. Check that widget retry does not duplicate a mutation.
7. Report exact observed hooks/commands, missing events, logs (redacted of all secrets/user content), and any plugin doctor/runtime/schema issues. Do not mark live acceptance complete until these results are recorded.

## Troubleshooting

- **Plugin not found/disabled:** ensure the directory is exactly `~/.hermes/plugins/glimpse-dock/` and contains `plugin.yaml` plus `__init__.py`; run `hermes plugins validate` and `hermes plugins doctor`, enable it, and restart Hermes.
- **`CONFIGURATION` from the widget tool or generic hook log:** set `GLIMPSE_DOCK_AGENT_TOKEN` in the Hermes process environment. For Gateway, update the service environment and restart it.
- **`UNAUTHENTICATED` (HTTP 401):** token missing, mistyped, or no longer valid. Create a replacement agent credential and restart Hermes with it.
- **`FORBIDDEN` (HTTP 403):** credential may be revoked, or the command is not authorized for that agent/widget owner. Use an agent-owned widget and verify the token source; do not switch to an owner cookie.
- **`INVALID_COMMAND` / `INVALID_INPUT` (HTTP 400):** inspect the structured widget fields and protocol examples in `docs/widgets/structured-widgets.md`; the backend rejects invalid values even when Hermes accepts the tool arguments.
- **Connection failure:** confirm Glimpse Dock is running and bound to loopback, then set `GLIMPSE_DOCK_URL` to its actual loopback port. LAN/remote URLs are intentionally rejected.
- **No online/offline/idle signal:** this is unsupported by design. A turn interruption can clear to `idle`, but no process heartbeat is implemented.
- **No `responding` signal:** stream hooks are stream-dependent; non-streaming response-start is unsupported.
- **Hermes rejects the tool schema or a hook name:** record the exact Hermes version and diagnostic. The plugin API names were verified against v0.22.6 source, but no live Hermes/plugin-doctor/provider validation has yet been performed. Do not work around this with private APIs or terminal scraping; report the incompatibility for a documented follow-up.

## Automated tests and limits

Run local adapter/client/plugin fixtures without installing Hermes:

```sh
python3 -B -m unittest discover -s integrations/hermes/tests -v
```

These tests verify event normalization, privacy filtering, tool ownership/error handling, request bounds/retries, plugin registration, and fail-open recovery using fixtures. They do **not** prove plugin discovery, actual hook firing, JSON Schema keyword/provider support, CLI/Gateway compatibility, or behavior on a real Hermes installation. Those remain pending the live checklist above.
