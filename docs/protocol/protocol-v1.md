# Local protocol v1

The browser and local Fastify service exchange JSON over same-origin HTTP and WebSocket. The service is the authority; clients validate snapshots and state messages before rendering. Unknown fields and command types are rejected.

## State and events

`ProtocolStateSchema` in `src/shared/protocol.ts` bounds agent/task text, widgets (32), and activity (40 entries). A state envelope is `{ v: 1, type: "snapshot" | "state", revision, source: "demo" | "owner" | "agent", state }`. Revisions increase only after a SQLite transaction persists state/revision/activity. WebSocket `/api/stream` sends the current snapshot on connect and full state envelopes thereafter; clients reconnect with bounded backoff and obtain a fresh snapshot. WebSocket is read-only.

## Commands

Commands are strict `{ v: 1, requestId, type, payload }` objects. Current types are:

| Type | Payload | Permission / behavior |
| --- | --- | --- |
| `task.update` | `{ task: string }` | Owner or valid agent |
| `task.complete` | `{}` | Owner or valid agent |
| `state.set-progress` | `{ progress: 0..100 }` | Owner or valid agent |
| `metric.set-value` | `{ id: "tasks" | "tools", value: integer }` | Owner or valid agent; target must exist |
| `demo.simulate` | `{}` | Owner, only when Demo is enabled; server scheduler uses same boundary |
| `demo.set-enabled` | `{ enabled: boolean }` | Owner, only when Demo is enabled |
| `demo.reset` | `{}` | Owner, only when Demo is enabled |
| `demo.add-widget` | `{}` | Owner, only when Demo is enabled |

Owner commands POST to `/api/command` with the command plus a `csrf` field. Agent commands use the same endpoint and command object with `Authorization: Bearer <credential>`; agent requests do not use browser cookies or CSRF. Display sessions cannot mutate state. Commands are not retried automatically by the browser.

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

Protocol v1 is local and not yet a public compatibility promise. Hermes integration, idempotency keys, richer widget ownership/lifecycle commands, and event replay are later roadmap work.
