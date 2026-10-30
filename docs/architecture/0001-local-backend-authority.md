# ADR 0001: Local backend owns shared application state

- **Status:** accepted and implemented for Milestones 1–2
- **Date:** 2026-10-29

## Context

The current TypeScript/Vite prototype keeps demo state in the browser and shares it only between same-origin tabs. The product needs Admin and Display to share state across separate sessions, recover it after refresh/restart, and accept validated agent updates without trusting the frontend.

## Decision

- Retain the Vite frontend and existing working visual behavior.
- Keep Admin and Agent Display as separate routes; `/admin` opens Admin, while `/` and `/display` open Visual Display (updated at the user's direction on 2026-10-30).
- Add one lightweight local backend as the authoritative source for agent and widget state.
- Use a versioned, schema-validated protocol between adapters, backend, and clients.
- Implement Demo as an adapter through the same state/command boundary intended for Hermes.
- Keep browser storage for local presentation preferences only; do not use it or `BroadcastChannel` as shared application state.
- Bind local development and the backend to loopback by default. Make LAN access deliberate and permission-protected.
- Use Fastify 5.12.7, `@fastify/websocket` 11.3.4, Zod 4.6.7, and `better-sqlite3` 12.11.1 in the existing npm project. SQLite 12 preserves the documented Node 20.19+ support; version 13 requires Node 22. The initial protocol tests and clean dependency audit verified these selections.
- Use single-owner authentication. Bootstrap setup requires an out-of-band startup secret; store password hashes with Node `crypto.scrypt`, session token digests in SQLite, and issue `HttpOnly; SameSite=Strict` cookies. Browser mutations require an exact same-origin check and session-bound CSRF token.
- Display sessions are paired, read-only, revocable sessions. Agent credentials are random, scoped, stored as digests, and can only invoke validated agent commands. WebSockets provide validated snapshots and full-state updates only; mutations use authorized HTTP.
- Persist each accepted state transition and revision before replacing in-memory state, returning success, or broadcasting. The Demo adapter is opt-in and traverses the same command boundary; without explicit Demo mode, start with empty/inactive state.
- Verify Hermes capabilities from its installed version and supported documentation before implementing or documenting an adapter; Hermes integration is outside Milestone 2.

## Consequences

The first backend milestone must include state snapshots, live updates, reconnect behavior, input validation, and basic authorization. The demo UI will no longer be considered evidence of a real agent connection. Keep the backend single-process and loopback-bound by default; full-state snapshots intentionally avoid event replay and patch-ordering complexity at this bounded state size. Plain loopback HTTP is a development convenience, not encrypted transport; non-loopback operation requires HTTPS and Secure cookies. No multi-user or multi-instance architecture is implied.

## Baseline verification

On 2026-10-30 in the isolated feature worktree, Milestone 1 verification passed: 28 tests, strict TypeScript/Vite build, `npm audit` (zero vulnerabilities), and Playwright route/interaction smoke checks. Milestone 2 verification includes SQLite restart and write-failure behavior, two-client WebSocket snapshot/fan-out/reconnect, pairing/revocation/frame-size and graceful-shutdown tests, Demo adapter, frontend transport, production build, and auth/UI tests. Playwright smoke passed setup, owner login, Demo state, Display pairing, cross-context update, reload, and production static serving. A focused security review found no material issues in the reviewed M1/M2 paths. `better-sqlite3` 12.11.1 was rebuilt and exercised on Node 20.19.4.
