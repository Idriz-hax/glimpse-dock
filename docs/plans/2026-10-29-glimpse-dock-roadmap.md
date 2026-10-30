# Glimpse Dock Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Keep each milestone independently buildable and testable.

**Goal:** Evolve the current Vite demo into a secure, local-first visual home for AI agents, starting with a real backend-driven demo vertical slice.

**Architecture:** Retain the TypeScript/Vite frontend and existing visual work. Keep Admin and Agent Display as separate routes and modules. Add a lightweight TypeScript backend as the authority for shared agent/widget state, a versioned validated protocol, and adapters that normalize demo and Hermes events. Introduce persistence, authentication, permissions, and deployment in small milestones rather than a rewrite.

**Tech Stack:** Existing TypeScript + Vite; add Vitest for unit/integration tests; Node.js TypeScript backend; Fastify HTTP, WebSocket transport, Zod protocol validation, and SQLite are the default candidates. Confirm package compatibility and the smallest viable dependency set in Milestone 2 before installing them. Use Playwright for end-to-end tests once the server/display vertical slice exists.

---

## Baseline and file boundaries

Current verified baseline: TypeScript 5.7 + Vite 6; `npm run build` passes; no tests or server; Admin currently lives at `/`; Display at `/display`; demo state is held in `src/main.ts` and synchronized with browser storage/channel. The working tree already has uncommitted edits, so inspect and preserve them before implementation.

Keep the first structure small and responsibility-based:

| Area | Target responsibility |
| --- | --- |
| `src/admin/` | Admin route composition and admin-only views. |
| `src/display/` | Fullscreen display route and display presentation states. |
| `src/shared/` | Shared protocol-derived types, schemas, and client API/event handling. |
| `src/widgets/` | Known widget schemas and renderers; no arbitrary HTML. |
| `src/styles/` | Shared tokens plus admin/display styles. |
| `server/src/` | Backend startup, HTTP/WebSocket boundary, state, auth, persistence, and adapter lifecycle. |
| `server/src/adapters/` | Demo adapter first; Hermes isolated after verification. |
| `tests/` | Unit/integration tests; `e2e/` for browser flows when useful. |
| `docs/` | Architecture, protocol, security, integration, deployment, and plan documentation kept aligned with code. |

Do not move the whole app into the suggested monorepo layout unless implementation demonstrates a concrete need. Route decision updated at the user's direction on 2026-10-30: `/` and `/display` open Visual Display; `/admin` opens Admin. This supersedes the original `/`-to-Admin compatibility requirement below.

## Milestone 0 — Safe baseline and working agreement

**Outcome:** known-good baseline with user changes preserved and test/build commands repeatable.

### Tasks
1. Inspect `git status`, the complete existing `README.md`, `PROJECT.md`, `package.json`, lockfile, `src/main.ts`, styles, and Vite/TypeScript configuration. Record which existing edits are user-owned; do not revert them.
2. Run `npm run build` and `npm audit`; record outputs in the milestone notes. Keep this evidence separate from runtime/test claims.
3. Add an architecture decision note under `docs/architecture/` for the first vertical slice: one local backend is state authority, Vite remains the frontend dev server, Admin and Display are distinct, demo is an adapter, and Hermes details stay unverified until researched.
4. Add/update README sections for current prototype, known limitations, and intended milestones without claiming planned functionality is implemented.

**Exit checks:** clean build; baseline limitations documented; no user changes discarded.

## Milestone 1 — Foundation (critical)

**Outcome:** dependable, tested frontend foundation with genuinely separate Admin and Display routes.

### Tasks
1. Add Vitest and a `test` script; configure TypeScript/Vitest to run focused tests without changing production behavior.
2. Add tests for the existing command parser: accepted commands, blank/unknown input, and progress boundary values. Extract only the parser/state transition code needed to make it testable.
3. Add tests for local state loading: valid saved state restores; malformed JSON falls back safely; malformed nested values are rejected rather than reaching renderers.
4. Add a `/admin` Admin entry and retain `/display` for Visual Display. The later route decision above makes `/` another Display entry. Test direct navigation and refresh on all routes.
5. Split `src/main.ts` by responsibility into Admin, Display, shared state/types, and render helpers. Preserve current demo controls and visuals; do not introduce React or a router dependency unless a concrete requirement appears.
6. Validate/clamp progress and validate state before render; ensure every user/state-derived string is escaped and enums/classes are allowlisted. Add regression tests for malformed progress, widget tone, and log level.
7. Change Vite dev/preview host defaults from `0.0.0.0` to loopback. Add an explicit documented opt-in for LAN testing rather than exposing the dev server by default.
8. Update `README.md` and `PROJECT.md` to describe routes, local-only prototype security, test/build commands, and what remains simulated.

**Acceptance:** `/admin`, `/`, and `/display` work on direct navigation; current demo behavior is retained; malformed state cannot break rendering or inject markup; no unexpected console errors in manual smoke test; unit tests and build pass; Vite is loopback by default.

## Milestone 2 — Local backend and shared authoritative state (critical)

**Outcome:** Admin and Display in separate sessions share real backend-owned state, with recovery after disconnect/restart.

### Tasks
1. Confirm the smallest runtime dependency set and supported Node versions. Keep the current single npm project unless server packaging proves a workspace is needed. Document the chosen HTTP, WebSocket, schema, and SQLite libraries in `docs/architecture/`.
2. Define protocol v1 in `src/shared/protocol.ts` (or `packages/protocol/` only if a second consumer requires a package): event envelope, agent state, snapshot, widget commands, and structured error response. Put Zod schemas next to protocol types and test valid/invalid versions, missing fields, oversized text, and unknown commands.
3. Create `server/src/server.ts` with loopback-only bind by default, health endpoint, API routes, WebSocket endpoint, graceful shutdown, and bounded message/body sizes. Add a Vite proxy for local development.
4. Create a backend-owned in-memory state service with typed transitions and snapshots. Make all mutations pass one validator/permission boundary; publish accepted updates to connected clients.
5. Implement snapshot-on-connect, client reconnect with bounded backoff, and full state refresh after reconnect. Test missed events by reconnecting and asserting snapshot correctness.
6. Add the Demo adapter under `server/src/adapters/demo.ts`. It emits explicitly marked simulated states/events only when demo mode is enabled; production startup must not schedule fake activity by default.
7. Replace Admin-to-Display localStorage/BroadcastChannel shared-state sync with backend API/WebSocket events. Keep only local display/admin preferences in browser storage. Prove synchronization in two browser contexts.
8. Add SQLite persistence for config and current widget/state records, with schema migration/init and bounded activity retention. Test restart restores state; test failed writes return errors instead of reporting success.
9. Add initial single-owner authentication and authorization before any mutation API is exposed: first-run secret/password setup, secure password hashing using Node crypto, HttpOnly/SameSite cookies, CSRF protection for mutating browser requests, and distinct read-only display access. Store agent credentials hashed/revocable; never broadcast them.
10. Add rate limits, request/message size limits, generic structured errors, and redacted logs. Test unauthenticated mutation denied, display read succeeds but mutation denied, revoked agent credentials denied, and invalid message rejected.
11. Add integration tests for API mutations, WebSocket fan-out, two clients, unauthorized requests, persistence/restart, and server shutdown. Add root scripts to start frontend+backend in dev and build/serve both without Vite in production.
12. Update README plus `docs/architecture/`, `docs/protocol/`, and `docs/security/` with actual endpoints, auth model, state ownership, development commands, network defaults, and verified limitations.

**Acceptance:** two independent browser contexts share state; refresh and server restart recover state; invalid/unauthorized commands are rejected; server binds loopback by default; Demo events are explicitly labeled and disabled by default outside demo mode; integration tests and production build pass.

## Milestone 3 — Agent visualization (high)

**Outcome:** Agent Display responds to backend state instead of deriving apparent activity locally.

### Tasks
1. Define the normalized state enum and allowed transitions in shared protocol/types; reject impossible transitions and test them.
2. Refactor the display view into explicit idle, thinking, tool-use, responding, waiting, completed, error, and disconnected presentation states.
3. Connect each display state to backend snapshots/events; remove locally generated progress and activity from production paths.
4. Use indeterminate progress when the adapter reports no measurable progress; show numerical progress only when supplied and validated by the adapter.
5. Add safe concise error/disconnection summaries and ensure stale state is visibly stale/offline.
6. Add reduced-motion behavior and tests for state changes with motion preference enabled/disabled; ensure animation does not obscure readable content.
7. Profile idle and active display on a representative browser; tune CSS animation and event rendering based on measurements, not unsupported FPS claims.
8. Run responsive visual review at 1920×1080 and smaller sizes, plus keyboard/screen-reader smoke checks.

**Acceptance:** each UI state follows actual backend/demo events; no fake live status; disconnected state is unmistakable; reduced-motion works; display remains uncluttered and readable.

## Milestone 4 — Structured widget system (critical)

**Outcome:** agents/demo adapter can safely create, update, hide, and remove stable, owned widgets.

### Tasks
1. Define versioned schemas and limits for text, status, metric, and progress widgets. Include ID, owner, timestamps, expiry, visibility, and placement hint; do not add chart support yet.
2. Implement backend widget registry/service with create/update/visibility/remove operations and ownership checks. Ensure updates preserve IDs and do not recreate the display.
3. Add idempotent command IDs and structured validation/permission errors for widget commands.
4. Implement safe renderer components for the first three types (text, metric, progress) and confirm all data is text/schema rendered, never raw HTML.
5. Add Demo adapter commands to create, update, and remove sample widgets through the same validated backend path as a real adapter.
6. Add Admin widget inspection and explicit test-widget controls; add Display placements for primary/secondary/notification without arbitrary coordinates.
7. Add limits for widget count, content size, list/data length, update rate, and expiry cleanup. Test boundary values and unauthorized cross-agent changes.
8. Add unit and integration tests for schema validation, stable update identity, ownership, placement, expiry, and invalid payload rejection.
9. Document protocol commands, widget schemas, permissions, rate/size bounds, and examples in `docs/protocol/` and `docs/widgets/`.

**Acceptance:** at least three widget types can be created, updated, hidden, and removed through validated commands; clients update without reload; invalid/oversized/unauthorized changes are rejected; stable widget ownership is enforced.

## Milestone 5 — Verified Hermes integration (critical)

**Outcome:** first real agent integration uses documented, verified Hermes mechanisms only.

### Tasks
1. Inspect the installed Hermes version and official documentation/source for supported hooks, events, APIs, SDKs, or tool/plugin extension points. Record exact version and sources in `docs/integrations/hermes.md`.
2. Create a capability matrix for requested events: online/offline/idle, task start/update/complete/fail, tool start/complete, waiting, responding. Mark each supported, unsupported, or unverified with evidence.
3. Choose one stable supported event mechanism; reject undocumented APIs and avoid terminal scraping unless no reliable supported option exists and limitations are explicit.
4. Implement `server/src/adapters/hermes/` as a boundary that normalizes only verified events into protocol v1; include reconnect, cleanup, health, and error handling.
5. Add a documented, permission-scoped Hermes capability/tool to submit structured widget commands through the same validator/ownership path.
6. Add fixture-based adapter tests for each supported event, malformed/unknown events, disconnect and reconnect. Keep live Hermes validation separate from automated tests.
7. Test against an actual Hermes installation and record the exact environment, verified behavior, unavailable events, and setup/troubleshooting.

**Acceptance:** real supported activity is visible; no fake events are presented as live; widget commands are permission limited; unsupported Hermes capabilities are documented, not simulated.

## Milestone 6 — Display polish, admin completeness, and accessibility (medium)

**Outcome:** useful daily-run experience with clear diagnostics and persisted display configuration.

### Tasks
1. Add display preferences for scale, reduced motion, visualization intensity, clock, widget visibility, and default layout; persist via backend.
2. Add Admin screens for health, agents/capabilities, displays, widgets, recent activity, rejected commands, errors, network/auth/config, and retention. Keep each screen read from backend state and protect mutations.
3. Add theme tokens for the initial dark charcoal/navy, cyan, mint, muted blue/purple palette; do not add theme marketplace/editor.
4. Improve keyboard navigation, touch affordances, focus visibility, accessible labels/live announcements, and contrast. Test reduced motion and usable controls at narrow widths.
5. Add clear empty/loading/disconnected/error states and safe diagnostic detail in Admin, without exposing stacks/secrets on Display.
6. Measure long-session memory/event behavior and bound caches/logs; add regression tests for cleanup/retention.

**Acceptance:** display settings persist, Admin remains practical, Display remains visually primary, routine failures are diagnosable, and keyboard/reduced-motion/responsive checks pass.

## Milestone 7 — Ubuntu production deployment (high)

**Outcome:** reproducible production install and unattended local operation without Vite dev server.

### Tasks
1. Build frontend and backend into production artifacts; serve both from configured local service/port with `/admin` and `/display` routes.
2. Add production configuration validation, secret setup, data directory/permissions, backup/restore, and bounded log retention.
3. Add systemd service template for backend with restart policy and least-privilege user; test service stop/start/reboot recovery.
4. Add user-level graphical-session browser kiosk launch instructions/script; do not run browser via a system service lacking desktop-session access.
5. Add localhost default and deliberate LAN binding controls; document firewall/auth implications and verify no public binding by default.
6. Test fresh install, upgrade, config persistence, DB backup/restore, browser autostart, backend restart, and temporary network loss.
7. Update README and `docs/deployment/ubuntu.md` with verified installation, update, troubleshooting, recovery, and removal steps; prepare alpha release checklist.

**Acceptance:** app runs without dev server; backend restarts automatically; display starts after graphical login; settings survive restart; deployment steps reproduce on Ubuntu.

## Milestone 8 — Additional agents and broader compatibility (future)

**Outcome:** demonstrate the adapter boundary with one additional agent without rewriting shared UI/protocol/widgets.

### Tasks
1. Stabilize and document adapter lifecycle, capabilities, authentication, health, and normalized event contract.
2. Select a second integration only after verifying its supported interface; document evidence and gaps before implementation.
3. Implement it in an isolated adapter module and reuse protocol/widget services.
4. Add contract tests that run the same normalized-event/permission suite against Demo, Hermes, and the second adapter.
5. Add multiple registered agents and a simple active-agent selector only if the one-agent workflow is stable and usable.
6. Test compatibility on another Linux distribution; track Windows/macOS work separately based on actual demand.

**Acceptance:** second agent works without core UI or widget rewrites; each integration has documented verified capabilities and contract tests.

## First implementation batch

Start with Milestone 0, then Milestone 1 Tasks 1–4. Do not begin backend or Hermes implementation until the baseline tests, state validation, route separation, and localhost default are in place. Next create a focused Milestone 2 implementation plan after confirming the dependency/security choices; implement backend state and Demo adapter before adding Hermes.

## Overall completion checks

- `npm run build` passes for production frontend and server artifacts.
- `npm test` passes all unit/integration tests; browser e2e tests cover Admin, Display, widget create/update/remove, disconnect/reconnect, and unauthorized command rejection.
- `npm audit` has no unresolved high/critical issues; findings are assessed rather than treated as a complete security review.
- Manual smoke tests confirm separate routes, no browser console errors, actual backend-driven sync across independent sessions, localhost-only default, and a truthful disconnected state.
- Real Hermes claims cite a tested version/environment; demo behavior remains visibly and operationally separate.
- Docs distinguish implemented behavior from roadmap items.
