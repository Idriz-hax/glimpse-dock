# Structured widgets (protocol v1)

Glimpse Dock widgets are stable, backend-owned slots for agent-authored structured content. The owner can inspect and manage all widgets. An agent can create widgets for its own identity and update, hide, or remove only its own. Demo widgets use the fixed `demo` identity when the demo adapter is enabled.

Widget content is untrusted data. Text is rendered as text, and visual scenes are constructed from allowlisted SVG primitives and theme colors. **Widgets do not execute HTML or JavaScript.** Arbitrary executable content is deferred until a separately isolated runtime and enforceable resource controls exist.

## Record

The state snapshot carries records in this shape:

```json
{
  "version": 1,
  "id": "build-status",
  "owner": "agent:opaque-server-issued-id",
  "title": "Build status",
  "content": { "kind": "status", "label": "Passing", "tone": "success" },
  "placement": "primary",
  "visible": true,
  "createdAt": 1793670000000,
  "updatedAt": 1793670000000,
  "expiresAt": null
}
```

`owner` is assigned by the server; it is not accepted in a create/update payload. Owners have identity `owner`; demo operations use `demo`; an agent identity is `agent:<agent_id>`, where `agent_id` is stable and issued by the server for its credential. `id` is globally unique, stable across updates, and matches `[A-Za-z0-9._-]{1,64}`. `title` is at most 256 characters. Timestamps are nonnegative safe-integer Unix epoch milliseconds. `updatedAt` advances on update and visibility changes. `expiresAt` is either `null` or a future timestamp no more than 30 days from command time; expired widgets are removed by startup and periodic backend cleanup.

## Content kinds and bounds

All command objects and content objects are strict: unknown fields are rejected. A widget content value is at most 4096 UTF-8 bytes after JSON serialization. Overall HTTP bodies and WebSocket frames are limited to 16 KiB. The API has a global rate limit of 120 requests per minute (setup, login, and display-code redemption are limited to 5 per minute). The state contains at most 32 widgets, of which at most 12 may be visible. A visual scene contains at most 64 primitives.

| Kind | Content |
| --- | --- |
| `text` | `{ "kind": "text", "text": string }`; text at most 4096 characters, subject to the 4 KiB serialized content limit |
| `status` | `{ "kind": "status", "label": string, "tone": "neutral"\|"info"\|"success"\|"warning"\|"error" }`; label at most 256 characters |
| `metric` | `{ "kind": "metric", "label": string, "value": string, "unit"?: string, "caption"?: string }`; label/value/caption at most 256 characters, unit at most 32 |
| `progress` | `{ "kind": "progress", "label": string, "value": number\|null }`; label at most 256 characters; value finite from 0 through 100; `null` means unknown, not zero |
| `visual` | `{ "kind": "visual", "primitives": [...] }`; text, rect, circle, and line primitives only, with coordinates from 0 through 100, size/line width from 0 through 20, at most 256 characters per primitive text, and colors from `cyan`, `mint`, `blue`, `purple`, `amber`, `muted`, `white` |

Visual primitive shapes:

```json
{"kind":"rect","x":8,"y":12,"width":84,"height":18,"color":"blue"}
{"kind":"circle","cx":50,"cy":50,"radius":18,"color":"mint"}
{"kind":"line","x1":8,"y1":78,"x2":92,"y2":28,"width":2,"color":"cyan"}
{"kind":"text","x":50,"y":54,"text":"OK","size":8,"color":"white"}
```

Values are validated and passed only to fixed DOM/SVG element and attribute names. A visual scene uses its own normalized 0–100 viewport; widgets do not choose arbitrary screen coordinates.

## Placement and expiry

`placement` is one of `primary`, `secondary`, or `notification`. These are fixed Display regions, not pixel coordinates. Within each region widgets are ordered by `createdAt`, then `id`. Hidden and expired records do not render. The Display shows a calm empty state when no slots render, caps the visible layout at 12 slots, and reports overflow. Notification widgets persist until hidden, removed, or expired; they are not transient toasts.

`expiresAt: null` means no automatic expiry. If supplied, expiry must be after the current time and within 30 days. The backend performs cleanup at startup and every minute; cleanup persists the resulting state and broadcasts the new revision.

## Commands and ownership

Commands use `{ "v": 1, "requestId": string, "type": string, "payload": object }`; request IDs are 1–64 characters. Owner commands use the authenticated owner session, CSRF value, and same-loopback Origin checks. Agent commands use the same endpoint with a bearer credential; the server derives identity from that credential. Clients cannot select a widget owner.

### Create

```json
{"v":1,"requestId":"create-1","type":"widget.create","payload":{"widget":{"version":1,"id":"build-status","title":"Build status","content":{"kind":"status","label":"Passing","tone":"success"},"placement":"primary","expiresAt":null}}}
```

The server adds `owner`, `visible: true`, `createdAt`, and `updatedAt`. A duplicate ID returns `CONFLICT`; creation beyond the total/visible limit also conflicts.

### Update

```json
{"v":1,"requestId":"update-1","type":"widget.update","payload":{"id":"build-status","content":{"kind":"progress","label":"Build","value":72},"placement":"secondary"}}
```

Accepted fields are optional `title`, `content`, `placement`, and `expiresAt`; omitted fields are preserved. An empty patch is accepted and advances `updatedAt`. The ID and owner cannot be changed.

### Visibility and removal

```json
{"v":1,"requestId":"hide-1","type":"widget.set-visibility","payload":{"id":"build-status","visible":false}}
{"v":1,"requestId":"remove-1","type":"widget.remove","payload":{"id":"build-status"}}
```

The owner can mutate any widget. An agent can mutate only its own; missing IDs return `NOT_FOUND`, and cross-owner operations return `FORBIDDEN`. Rejected operations do not revise or broadcast state.

## Idempotency and errors

For `widget.create`, `widget.update`, `widget.set-visibility`, and `widget.remove`, `requestId` is an idempotency key scoped to the authenticated principal. Repeating the same principal, request ID, and command returns the original revision without a second state change or broadcast. Reusing that principal/request ID with a different command returns `CONFLICT`. The SQLite registry retains at most 1000 recent widget-command records globally; older keys may be pruned. Use a fresh request ID after a conflict. This behavior does not currently apply to unrelated command types such as `metric.set-value`.

Widget validation errors return `INVALID_INPUT` (HTTP 400); unauthorized operations return `FORBIDDEN` (403); absent IDs return `NOT_FOUND` (404); duplicate IDs, capacity failures, and idempotency mismatches return `CONFLICT` (409). Persistence failures return `PERSISTENCE_FAILED` (500). State is committed before the revision is broadcast.

Legacy `metric.set-value` remains supported for existing clients. It accepts `{ "id": string (1–64 characters), "value": integer (0–9,999,999) }`, requires an existing metric widget, and follows the same owner/agent ownership rules.

## Examples

Text:

```json
{"version":1,"id":"notice","title":"Deployment","content":{"kind":"text","text":"Release completed"},"placement":"notification","expiresAt":null}
```

Metric and progress:

```json
{"version":1,"id":"requests","title":"Requests","content":{"kind":"metric","label":"Requests","value":"1284","unit":"req","caption":"Today"},"placement":"secondary","expiresAt":null}
{"version":1,"id":"queue","title":"Queue","content":{"kind":"progress","label":"Processed","value":null},"placement":"primary","expiresAt":null}
```

Declarative visual:

```json
{"version":1,"id":"health-gauge","title":"Health","content":{"kind":"visual","primitives":[{"kind":"circle","cx":50,"cy":50,"radius":34,"color":"mint"},{"kind":"text","x":50,"y":54,"text":"OK","size":10,"color":"white"}]},"placement":"notification","expiresAt":null}
```
