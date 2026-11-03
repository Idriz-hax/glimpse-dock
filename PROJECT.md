# Glimpse Dock — project inventory

**Purpose:** a local visual workspace for monitoring AI-agent activity, with a separate Admin dashboard and paired read-only Visual Display.

**Current state:** Milestones 1–4 are implemented in this worktree. A Fastify service owns shared state, persists it in SQLite, authenticates the single owner, pairs read-only display sessions, and accepts scoped bearer agent commands. The Display presents backend-owned activity and safe structured widgets; Admin manages all widget slots, while agents and the opt-in demo own their own widgets. Hermes itself is not integrated. Simulated agent activity is available only with `GLIMPSE_DEMO=1`; otherwise the workspace starts inactive.

## What is present

- **Admin (`/admin`):** Overview, Widgets, Activity, and Settings. Requires owner authentication.
- **Visual Display (`/`, `/display`):** separate read-only session; pairing codes are one-time and sessions can be revoked.
- **Demo adapter:** preserves seeded activity, `Hermes (Demo)`, allowed sample commands, and 12-second simulated updates when explicitly enabled.
- **Agent visualization:** explicit backend-driven activity states and validated transitions; no percentage is shown when progress is unknown. Reduced-motion is honored.
- **Display style:** owner-configurable Quiet status or Ambient activity; preference persists across restart and updates paired displays.
- **Protocol v1:** bounded Zod schemas for state, snapshots, commands, structured errors, and WebSocket messages.
- **Structured widgets:** stable owned slots for text, status, metric, progress, and declarative visual content; strict schemas, idempotent lifecycle commands, fixed placement regions, expiry and count/size bounds. No executable widget HTML or JavaScript.
- **Backend:** loopback-only Fastify API, SQLite state/revision/activity persistence, authenticated HTTP mutations, and read-only snapshot/update WebSockets.
- **Security:** bootstrap-secret first-run setup, scrypt password hashing, hashed opaque session and agent credentials, SameSite/HttpOnly cookies, CSRF and exact loopback Origin checks, rate/body/frame bounds, session expiry/revocation, and redacted credential headers.
- **Frontend transport:** no browser `localStorage` or `BroadcastChannel` shared state; client validates snapshots and updates and reconnects with bounded backoff.

## Implementation map

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | Auth lifecycle, API commands, snapshot validation, WebSocket updates/reconnect. |
| `src/admin/`, `src/display/`, `src/auth/` | Admin, Display, and auth UI. |
| `src/shared/protocol.ts` | Versioned schemas and protocol types. |
| `server/widgets.ts`, `src/display/widgets.ts` | Shared widget lifecycle/ownership service and safe Display renderers. |
| `server/server.ts` | API, authentication, authorization, persistence, WebSockets, static production routes. |
| `server/adapters/demo.ts` | Opt-in simulated state and transitions. |
| `tests/` | UI, protocol, auth, persistence/restart, fan-out, and WebSocket boundary tests. |
| `docs/architecture/`, `docs/protocol/`, `docs/widgets/`, `docs/security/` | Architecture, API contract, widget guide, and deployment/security boundaries. |

## Local workflow

- Node.js 20.19+ or 22.12+, npm; TypeScript 5.7, Vite 6, Fastify 5, Zod 4, SQLite via better-sqlite3.
- `npm ci` — locked dependency install.
- `GLIMPSE_BOOTSTRAP_SECRET='...' npm run dev` — Vite + backend on loopback; Vite proxies API/WS.
- Add `GLIMPSE_DEMO=1` to explicitly enable seeded fake activity.
- `npm test`, `npm run build`, `npm audit` — tests, frontend/server type checks and production bundle, dependency audit.
- `npm start` — production static UI + API, without Vite.
- `GLIMPSE_DB`, `PORT` — optional DB path and port. `HOST` is restricted to loopback; TLS/LAN access is not implemented.

The backend is a single local process. Plain loopback HTTP is not encrypted. Do not expose the service to a LAN or public network. Store and back up the SQLite file with appropriate filesystem permissions.

## Not implemented

- Hermes/other real agent adapter; no external agent is connected automatically.
- TLS, LAN/remote access, multi-user administration, or multi-instance operation.
- Executable custom widget code and arbitrary display coordinates.
- Full schema migration history beyond the migrations needed for agent identities and widget state.

See [README.md](README.md), the [roadmap](docs/plans/2026-10-29-glimpse-dock-roadmap.md), [architecture decision](docs/architecture/0001-local-backend-authority.md), [protocol](docs/protocol/protocol-v1.md), and [security notes](docs/security/local-deployment.md).
