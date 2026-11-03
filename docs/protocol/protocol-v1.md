# Local protocol v1

The browser and local Fastify service exchange JSON over same-origin HTTP and WebSocket. The service is the authority; clients validate snapshots and state messages before rendering. Unknown fields and command types are rejected.

## State and events

`ProtocolStateSchema` in `src/shared/protocol.ts` bounds agent/task text, widgets (32), and activity history (40 entries). State includes `activity` (`idle`, `thinking`, `tool-use`, `responding`, `waiting`, `completed`, `error`), `displayStyle` (`quiet` or `ambient`), and `progress` (`0..100` or `null` when unknown). Missing activity/style fields in legacy persisted state default to `idle`/`quiet`; missing or cleared progress defaults to `null`.

A state envelope is `{ v: 1, type: "snapshot" | "state", revision, source: "demo" | "owner" | "agent", state }`. Revisions increase only after a SQLite transaction persists state/revision/activity. WebSocket `/api/stream` sends the current snapshot on connect and full state envelopes thereafter; clients reconnect with bounded backoff and obtain a fresh snapshot. WebSocket is read-only.

Activity transitions are validated by the backend. `idle` can remain idle or start thinking, wait, or error; active phases (`thinking`, `tool-use`, `responding`, `waiting`) can move among active phases or finish/error; `completed`/`error` remain terminal or start a new task through idle/thinking.

## Commands

Commands are strict `{ v: 1, requestId, type, payload }` objects. Current types are:

| Type | Payload | Permission / behavior |
| --- | --- | --- |
| `task.update` | `{ task: string }` | Owner or valid agent |
| `task.complete` | `{}` | Owner or valid agent; sets activity `completed`, progress `100` |
| `state.set-activity` | `{ activity: Activity }` | Owner or valid agent; transition must be allowed |
| `state.set-progress` | `{ progress: 0..100 | null }` | Owner or valid agent; `null` clears unknown progress |
| `display.set-style` | `{ style: "quiet" | "ambient" }` | Owner only |
| `metric.set-value` | `{ id: string (1–64 characters), value: integer }` | Target must be an existing metric widget; owner may update any widget, while an agent may update only its own |
| `demo.simulate` | `{}` | Owner, only when Demo is enabled; server scheduler uses same boundary |
| `demo.set-enabled` | `{ enabled: boolean }` | Owner, only when Demo is enabled |
| `demo.reset` | `{}` | Owner, only when Demo is enabled |
| `widget.create` | `{ widget: { version: 1, id, title, content, placement, expiresAt } }` | Server assigns owner and timestamps; owner can create for the workspace, an agent creates for itself |
| `widget.update` | `{ id, title?, content?, placement?, expiresAt? }` | Owner may update any widget; an agent may update only its own |
| `widget.set-visibility` | `{ id, visible }` | Owner may manage any widget; an agent may manage only its own |
| `widget.remove` | `{ id }` | Owner may remove any widget; an agent may remove only its own |

Owner commands POST to `/api/command` with the command plus a `csrf` field. Agent commands use the same endpoint and command object with `Authorization: Bearer <credential>`; agent requests do not use browser cookies or CSRF. Display sessions cannot mutate state. Commands are not retried automatically by the browser.

See [Structured widgets](../widgets/structured-widgets.md) for the complete v1 widget record, schemas and bounds, examples, identity rules, placement, expiry, and retry semantics.

## HTTP endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness response. |
| `GET /api/session` | Current role, CSRF value, `setupRequired`, and `demoEnabled`; unauthenticated callers receive no credentials. |
| `POST /api/setup` | First owner setup: `{ secret, password }`; bootstrap secret comes from process environment. |
| `POST /api/login` | Owner login: `{ password }`. |
| `POST /api/logout` | Revoke current session: `{ csrf }`. |
| `GET /api/state` | Authenticated full snapshot. |
| `POST /api/display/pair` | Owner creates a short-lived one-time pairing code: `{ csrf }`. |
| `POST /api/display/redeem` | Display redeems `{ code }` for a read-only session. |
| `GET /api/sessions` / `DELETE /api/sessions/:id` | Owner lists and revokes owner/display sessions; DELETE body contains `{ csrf }`. |
| `POST /api/agents` | Owner creates a random bearer credential; shown only once. |
| `DELETE /api/agents/:digest` | Owner revokes a credential by its stored digest identifier; body contains `{ csrf }`. |

Application error bodies carry an error code, a generic message, and a request ID. Schema details and limits are maintained in `src/shared/protocol.ts` and `server/server.ts`.

## Versioning boundary

Protocol v1 is local and not yet a public compatibility promise. Widget lifecycle commands have principal-scoped idempotency records; this does not add general event replay. Hermes integration and executable custom widget code remain out of scope.
