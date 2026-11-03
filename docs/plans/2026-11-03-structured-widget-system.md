# Structured Widget System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backend-authoritative system of stable, agent-owned structured Display slots with safe declarative visuals and Workbench Admin/Display surfaces.

**Architecture:** Extend the existing protocol state with versioned widget records and normalize legacy metrics when reading persisted state. Keep CRUD and ownership rules in a focused backend widget service; SQLite remains the persistence authority, and WebSocket broadcasts happen only after successful transactions. Render structured content through validated DOM/SVG primitives—never executable widget HTML/JS. Custom code execution is explicitly deferred.

**Tech Stack:** TypeScript, Zod, Fastify, SQLite, Vitest, existing Vite frontend and CSS.

---

## File map

- `src/shared/protocol.ts`: strict versioned widget schemas, payload bounds, and widget command variants.
- `src/demo-state.ts`: typed `Widget` union and legacy-independent initial state.
- `server/widgets.ts` (new): pure create/update/visibility/remove and expiry operations with ownership checks.
- `server/server.ts`: agent-ID migration, idempotency storage, command authorization, transactional persistence/broadcast integration.
- `src/display/widgets.ts` (new): safe structured slot renderers and visual primitive construction.
- `src/display/view.ts`, `src/display.css`: placement regions, empty state, and Workbench presentation.
- `src/admin/view.ts`, `src/main.ts`: owner inspection, visibility/remove and test-widget controls using existing backend-confirmed flow.
- `tests/protocol.test.ts`, `tests/widgets.test.ts` (new), existing server/persistence/demo tests, `tests/display-view.test.ts`, `tests/admin-view.test.ts`: schemas, service, security, lifecycle, and UI coverage.
- `docs/protocol/protocol-v1.md`, `docs/widgets/` (new), `PROJECT.md`: actual commands, ownership, limits, examples, and milestone status.

## Task outline

1. Define widget protocol schemas and parse-time normalization for legacy metric records.
2. Implement a pure widget service and focused lifecycle/ownership/expiry tests.
3. Add stable agent identity and idempotent, transactional widget commands in the backend.
4. Render safe structured widgets in fixed placement regions on the Display.
5. Add Admin inspection and explicit test-widget controls.
6. Document protocol/limits, run full tests/build/security and manual responsive/accessibility checks.

---

### Task 1: Protocol schemas and legacy compatibility

**Files:** modify `src/shared/protocol.ts`, `src/demo-state.ts`, `tests/protocol.test.ts`, and `tests/demo-state.test.ts`.

- [ ] **Step 1: Add failing protocol tests.** Cover strict version `1`, all five kinds, bad kinds/tones/placements, progress `null` versus bounded numeric, >64 visual primitives, text length >4096, and legacy `{id,label,value,sub,tone}` normalization preserving ID and visible text. Legacy records normalize as owner-owned metric slots, secondary placement, visible, no expiry, timestamps `0`.
- [ ] **Step 2: Run `npm test -- --run tests/protocol.test.ts tests/demo-state.test.ts`.** Confirm the new cases fail because widget fields/commands are not yet defined.
- [ ] **Step 3: Define version 1 schemas** in `src/shared/protocol.ts`. Use a strict content union:

```ts
const WidgetContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().max(4096) }).strict(),
  z.object({ kind: z.literal('status'), label: z.string().max(256), tone: z.enum(['neutral','info','success','warning','error']) }).strict(),
  z.object({ kind: z.literal('metric'), label: z.string().max(256), value: z.string().max(256), unit: z.string().max(32).optional(), caption: z.string().max(256).optional() }).strict(),
  z.object({ kind: z.literal('progress'), label: z.string().max(256), value: ProgressSchema.nullable() }).strict(),
  z.object({ kind: z.literal('visual'), primitives: z.array(VisualPrimitiveSchema).max(64) }).strict(),
]);
```

`VisualPrimitiveSchema` is a strict union of `text{x,y,text,color,size}`, `rect{x,y,width,height,color}`, `circle{cx,cy,radius,color}`, and `line{x1,y1,x2,y2,color,width}`. Coordinates and dimensions are finite numbers in `0..100`; text is <=256; colors are `cyan|mint|blue|purple|amber|muted|white`; sizes and widths are bounded to `0..20`. Wrap content in strict record `{version:1,id,owner,title,content,placement,visible,createdAt,updatedAt,expiresAt}`. IDs match `[A-Za-z0-9._-]{1,64}`; title <=256; content JSON UTF-8 size <=4096 bytes; timestamps are safe epoch-millisecond integers; `expiresAt` is null or a safe epoch-millisecond integer. At mutation time reject expiries in the past or more than 30 days ahead. Placement is `primary|secondary|notification`. Create input omits owner and timestamps; the service supplies them.
- [ ] **Step 4: Add commands** with these payload shapes; owner is always derived server-side:

```ts
{ type: 'widget.create', payload: { widget: { version: 1, id: 'agent.summary', title: 'Summary', content: { kind: 'text', text: 'Ready' }, placement: 'primary', expiresAt: null } } }
{ type: 'widget.update', payload: { id: 'agent.summary', content: { kind: 'text', text: 'Updated' } } }
{ type: 'widget.set-visibility', payload: { id: 'agent.summary', visible: false } }
{ type: 'widget.remove', payload: { id: 'agent.summary' } }
```

Add structured `NOT_FOUND` to `ErrorResponseSchema`; leave owner authorization to Task 3. Make state `widgets` parse legacy records through a dedicated normalization helper; update the shared `Widget` type and demo fixtures to produce v1 metrics.
- [ ] **Step 5: Replace the old demo-only add-widget command** with `widget.create`; update protocol/demo/Admin callers and tests so all creation uses the same strict widget schema and service.
- [ ] **Step 6: Run focused tests and build.** `npm test -- --run tests/protocol.test.ts tests/demo-state.test.ts` and `npm run build` must pass before committing `feat: define structured widget protocol`.

### Task 2: Widget lifecycle service

**Files:** create `server/widgets.ts` and `tests/widgets.test.ts`.

- [ ] **Step 1: Write failing pure-service tests** for create, update preserving ID/owner/createdAt, visibility, remove, expiry, max 32 records, max 12 visible, duplicate ID, missing ID, cross-owner update/remove, and no mutation of the input array on failure.
- [ ] **Step 2: Run `npm test -- --run tests/widgets.test.ts`** and confirm service imports/expected operations fail.
- [ ] **Step 3: Implement typed service operations** `createWidget(widgets, widgetInput, principal, now)`, `updateWidget(widgets, id, patch, principal, now)`, `setWidgetVisibility(widgets, id, visible, principal)`, `removeWidget(widgets, id, principal)`, and `removeExpiredWidgets(widgets, now)`. Each returns `{ ok:true, widgets }` or `{ ok:false, code:'CONFLICT'|'NOT_FOUND'|'FORBIDDEN'|'INVALID_INPUT' }`; clone only the changed record/array. Derive owner from principal (`owner`, `demo`, or `agent:<opaque-id>`), never the submitted widget. Enforce 32 total records and no more than 12 visible records. Reject past or >30-day expiry values.
- [ ] **Step 4: Re-run service tests** and ensure all operations preserve stable identity and return no changed array for invalid requests.
- [ ] **Step 5: Commit** `feat: add owned widget lifecycle service` with only service and focused tests.

### Task 3: Backend identity, idempotency, and transactions

**Files:** modify `server/server.ts`, `tests/server.test.ts`, `tests/server-security.test.ts`, and `tests/backend-persistence.test.ts`.

- [ ] **Step 1: Add failing API tests** for agent credential IDs, each widget command, owner access to all records, agent self-ownership only, demo-only behavior, duplicate/cross-owner IDs, structured error codes, and rejected updates not changing revision or broadcasting.
- [ ] **Step 2: Add idempotency tests**: retrying the same principal/requestId/payload returns the original revision with one broadcast; reusing that requestId for another payload returns `CONFLICT`; reopen a file-backed database and prove a retry remains idempotent.
- [ ] **Step 3: Run focused server tests** and confirm the current API rejects widget commands or lacks the expected ownership result.
- [ ] **Step 4: Migrate agent records**: add schema migration version 2, add nullable `agent_id` to existing `agents`, assign a random UUID to each legacy row, enforce unique/non-null IDs for new records, and return `{ id, secret }` from `POST /api/agents`. Derive authenticated principal as `agent:<agent_id>` from the hashed bearer-token lookup; never accept it from a command payload.
- [ ] **Step 5: Wire widget commands through the service.** Add `widget_commands(principal, request_id, fingerprint, revision, created_at)` with unique `(principal,request_id)`. Hash the validated command JSON. Inside one SQLite transaction, apply the service result, save full state/revision/source/activity and the success idempotency record; only then update in-memory state and broadcast. Prune oldest idempotency entries to 1000 total. For a matching retry return its saved revision without a second commit; for a mismatching fingerprint return `CONFLICT`. Map `INVALID_INPUT` to HTTP 400, `FORBIDDEN` to 403, `NOT_FOUND` to 404, `CONFLICT` to 409, and persistence failure to 500 using the existing structured error envelope.
- [ ] **Step 6: Route demo widget actions through the same service** using principal `demo`; ensure demo records are created/updated/removed only when Demo is enabled and never claim real-agent ownership.
- [ ] **Step 7: Run expiry cleanup at startup and every 60 seconds.** When cleanup removes expired slots, persist changed state and broadcast through `commit`; clear the timer on server close. Verify with an injected clock so expiry tests do not sleep.
- [ ] **Step 8: Run focused backend tests and build.** Include migration, persistence restart, idempotent retry, and WebSocket assertions. Commit `feat: persist owned widget commands` only after all pass.

### Task 4: Safe Display slot renderers

**Files:** create `src/display/widgets.ts`; modify `src/display/view.ts`, `src/display.css`, `src/main.ts`, and `tests/display-view.test.ts`.

- [ ] **Step 1: Add renderer tests first** for each kind, visibility/expiry filtering, stable placement order, no-slot empty state, unknown progress, escaped text, visual primitive bounds, and no `<script>`/raw markup path. Use valid v1 fixtures from Task 1.
- [ ] **Step 2: Run `npm test -- --run tests/display-view.test.ts`** and observe failures before renderer implementation.
- [ ] **Step 3: Implement `renderWidget(widget, now = Date.now()): HTMLElement | null`** in `src/display/widgets.ts`. Create text nodes with `textContent`; create SVG using `createElementNS`; map only validated theme tokens to fixed CSS colors; set only numeric validated SVG attributes. Return null for hidden or expired records. Do not set `innerHTML` from widget data.
- [ ] **Step 4: Add three placement regions** to the Display shell and mount renderer elements after the stable shell renders. Sort within each region by `createdAt`, then `id`; retain activity/status as a separate region. Omit empty regions, show “No agent slots yet” when none render, and show a calm overflow count if visible records exceed the 12-slot display cap.
- [ ] **Step 5: Style Workbench slots responsively** with restrained dark surfaces, legible headings and structured metric/progress/status/text states. CSS must not animate widget content. Keep the existing reduced-motion and offline status behavior intact.
- [ ] **Step 6: Run Display tests and build**, then manually check desktop/narrow layout, keyboard focus, accessible labels and malicious-looking text in browser. Commit `feat: render structured display slots`.

### Task 5: Admin inspection and test controls

**Files:** modify `src/admin/view.ts`, `src/main.ts`, `src/shared/protocol.ts` if an owner command is needed, and `tests/admin-view.test.ts` / `tests/server.test.ts`.

- [ ] **Step 1: Add failing Admin view tests** for listing kind/title/owner/placement/visibility, hidden/expired status, visibility and remove controls, and explicit create/update test-widget actions for the structured kinds.
- [ ] **Step 2: Implement the compact Workbench Admin list** in `renderAdmin`; escape all displayed fields. Bind per-slot hide/show/remove actions through `widgetAction(action,id)`. Add one “Create/update sample” button per kind using deterministic owner IDs `test-text`, `test-status`, `test-metric`, `test-progress`, and `test-visual`; if the ID exists, send `widget.update`, otherwise `widget.create`. Use existing `send` so every view reflects backend-confirmed state; errors use existing toast and do not claim success.
- [ ] **Step 3: Add server tests** proving owner controls can act on any slot while agent controls remain owner-scoped; Admin-generated test widgets use owner identity, not agent identity.
- [ ] **Step 4: Run `npm test -- --run tests/admin-view.test.ts tests/server.test.ts` and `npm run build`; commit `feat: manage widget slots in admin`.

### Task 6: Documentation and final verification

**Files:** update `docs/protocol/protocol-v1.md`, add `docs/widgets/structured-widgets.md`, update `PROJECT.md`, and update the Milestone 4 section of `docs/plans/2026-10-29-glimpse-dock-roadmap.md` only after acceptance evidence exists.

- [ ] **Step 1: Document actual v1 widget record kinds, exact command payloads, owner derivation, idempotency semantics, placement regions, expiry, and all numeric/size limits.** Include one text, one metric/progress, and one declarative visual JSON example. State clearly that custom HTML/JS execution is deferred.
- [ ] **Step 2: Run final checks**: `npm test`; `npm run build`; `git diff --check`; security review. Manually verify owner and paired Display contexts, create/update/hide/remove, legacy state load, responsive Display, keyboard controls, and rejected oversized/cross-owner commands.
- [ ] **Step 3: Reconcile documentation and status**: mark Milestone 4 implemented in `PROJECT.md`/roadmap only if all acceptance checks pass. Preserve the untracked SQLite database and `.superpowers/` mockup artifacts; do not stage them.
- [ ] **Step 4: Commit documentation/status** as `docs: document structured widget system`; leave the feature branch isolated and unmerged unless the user asks to integrate it.

## Self-review

- Schema and data requirements map to Task 1; pure lifecycle and ownership to Task 2; agent identity, command permissions, idempotency and persistence to Task 3; safe placement rendering to Task 4; Admin operations to Task 5; docs and acceptance to Task 6.
- Existing metrics receive safe normalization; no legacy records are discarded. Widget ownership is derived from authenticated principal data, and invalid operations do not commit or broadcast.
- No executable HTML/JS, arbitrary SVG, charts, layout editor, Hermes integration, or unrelated Admin redesign is included.
- Verify the original request's desire for agent flexibility via text/status/metric/progress and a constrained visual primitive scene; custom executable code is explicitly deferred per the approved phased design.
