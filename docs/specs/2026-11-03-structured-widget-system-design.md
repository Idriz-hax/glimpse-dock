# Structured Widget System Design

## Goal

Implement roadmap Milestone 4 as an agent-facing system of stable, owned Display slots. Agents can create, update, hide, and remove structured content slots through the backend. The owner can inspect and manage every slot. The Display presents these slots in a restrained **Workbench** style.

This milestone supports flexible data-driven visuals, but does **not** execute agent-supplied HTML or JavaScript. Arbitrary code is deferred until Glimpse Dock can provide stronger runtime isolation and enforceable resource limits. This is a deliberate security boundary, not a claim that browser iframes alone are safe for arbitrary code.

## Slot model

Every widget is a strict, versioned record with a stable globally unique ID, server-derived owner, kind, title, content, placement hint, visibility, creation/update timestamps, and optional expiry. The client/agent never chooses or overrides the owner. Owners are `owner`, `demo`, or an opaque server-issued agent ID associated with the agent credential.

Version 1 structured kinds:

- **text:** bounded plain text.
- **status:** bounded label plus a small allowlisted tone/state.
- **metric:** bounded label, value, and optional unit.
- **progress:** label plus a validated `0..100` value or `null` for unknown; unknown is never shown as zero.
- **visual:** a bounded declarative scene made from a small allowlist of text, rectangle, circle, and line primitives, normalized to the widget's own viewport and using theme color tokens. Each primitive is rendered with DOM/SVG APIs, not inserted as markup. This permits agent-authored diagrams and gauges without arbitrary coordinates on the Display or executable content.

All schemas are strict and versioned. Initial limits are 32 total widgets, 12 visible widgets, at most 64 visual primitives per visual slot, and 4 KiB of text content per slot. The existing 16 KiB HTTP/WebSocket payload limits remain; commands exceeding them fail validation. Expiry is optional (`null` means no expiry); expired slots are removed by backend cleanup. Notification placement is persistent until hidden, removed, or expired—not a short-lived toast.

Existing persisted metric widgets with the exact legacy `{id,label,value,sub,tone}` shape and valid field types/tone are normalized to version 1 metric slots with safe defaults and owner ownership, preserving their IDs, labels, values, and supporting text. If legacy records exceed the 12-visible limit, preserve all records in order and normalize overflow records as hidden. Extra-key or malformed records are rejected rather than silently stripped or rendered. Existing non-widget state and revisions remain intact.

## Ownership, commands, and persistence

The backend remains authoritative. Add strict create, update, set-visibility, and remove widget commands. Create uses the caller's stable widget ID; updates preserve it. Owner may inspect/manage all slots. Agents may mutate only slots whose server-derived owner matches their credential identity. Demo operations are available only with the demo adapter enabled, use the fixed demo identity, and exercise the same widget validation/mutation path. A duplicate ID owned by another principal is a conflict, not an overwrite.

Persist agent identity alongside each hashed credential, adding a migration that assigns stable opaque IDs to existing agent credentials. Persist widget state using the current backend-owned SQLite state transaction. Widget mutation `requestId` is an idempotency key scoped to the principal: same ID and same command returns its prior result without a second revision/broadcast; reuse with a different command returns a structured conflict. Store bounded idempotency records in SQLite and prune old records.

Validation, permission, missing-ID, duplicate-ID, size, expiry, and persistence failures return existing structured protocol errors with no partial state change. Accepted mutations persist before revision increment and WebSocket broadcast. Updates never recreate a slot or require a Display reload.

## Display and Admin behavior

The Display groups slots into fixed `primary`, `secondary`, and `notification` placement regions; these are hints, not arbitrary screen coordinates. Multiple slots flow deterministically within a region. Only visible, non-expired slots render. The existing agent activity/status presentation remains separate from agent-authored slots. Empty regions are omitted; if there are no visible slots, an explicit calm empty state appears. During a connection outage, existing content may remain visible but the established disconnected status remains unmistakable; accepted updates refresh slots without reload.

The Workbench direction uses restrained dark surfaces, clear slot labels and ownership context in Admin, and readable, compact slot content on Display. Admin → Widgets provides an inspection list, visibility/remove controls, and explicit test-widget controls for creating/updating representative structured kinds. Owner actions use the existing authenticated command flow and backend-confirmed state; errors do not optimistically claim success.

## Security and future custom code

Widget content is untrusted. Render all text with `textContent`/escaping; render visuals only by constructing allowlisted SVG/DOM nodes from validated numeric coordinates and theme tokens. Never use `innerHTML`, `eval`, or dynamic script execution for widget content. Bound item counts, lengths, request sizes, expiry values, and visible widget count. Keep same-origin authentication, CSRF/Origin, role/ownership, rate-limit, persistence, and broadcast boundaries.

Arbitrary HTML/JavaScript remains explicitly out of scope. A later custom-code milestone must design and independently security-review a separately isolated, killable runtime with enforceable network and CPU/memory controls before enabling agent-authored executable content. An iframe/opaque origin alone is not sufficient to promise no network navigation or protection from resource exhaustion.

## Verification

Add protocol and service tests for each schema/kind, malformed and oversized payloads, stable IDs, create/update/hide/remove, owner versus agent versus demo ownership, duplicate and cross-owner IDs, idempotent retries/conflicts, expiry cleanup, and persistence/restart/broadcast. Test legacy metric normalization and unchanged state on rejected commands. Add renderer tests for all kinds, visibility, no-data/unknown-progress states, output escaping, placement ordering, and visual primitive limits. Browser-check Admin controls and Display at desktop and narrow sizes; verify keyboard semantics and no arbitrary widget markup/script execution. Run `npm test`, `npm run build`, and the security review before marking the milestone complete.

## Non-goals

- Executable HTML/JavaScript, arbitrary markup/SVG, network-connected widgets, or host-action bridges.
- Charts, arbitrary display coordinates, a drag/drop layout editor, widget marketplace, or multiple active-agent selector.
- Hermes integration; Demo remains explicitly simulated.
