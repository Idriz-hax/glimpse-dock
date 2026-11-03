# Glimpse Dock

**See your AI agents at work.** Glimpse Dock is a local visual workspace with separate Admin and Visual Display views. A loopback backend owns shared state, persists it in SQLite, and streams validated read-only snapshots to paired displays. Hermes integration is not included yet.

## Requirements and quick start

Requires Node.js 22.12+ or 24 and npm. The CI matrix tests Node.js 22 and 24.

```bash
npm ci
GLIMPSE_BOOTSTRAP_SECRET='choose-a-one-time-setup-secret' npm run dev
```

Open the Vite URL (usually `http://127.0.0.1:5173/`). `/` and `/display` open the Visual Display; `/admin` opens Admin. On first use, choose **First time here? Set up owner access**, enter the bootstrap secret and create an owner password (12–128 UTF-8 bytes). Setup is available only until the owner is created. Keep the bootstrap secret out of shell history and logs where practical.

To try the seeded simulation, stop the dev process and restart with `GLIMPSE_DEMO=1` as well as the bootstrap secret. Demo mode is explicit; without it, the workspace starts inactive and does not invent agent activity. The seeded demo retains the **Hermes (Demo)** label and simulated controls. No mode connects to a real Hermes process.

## Pair a display

In Admin, open **Settings → Pair a display → Create pairing code**. On the separate display device/browser, open `/display` and enter that one-time code. Display sessions are read-only. An owner can revoke sessions and sign out; a Display can be paired again with a new code.

Owner and Display clients use an `HttpOnly`, `SameSite=Strict` session cookie. Mutations use CSRF protection and same-origin validation. Agent credentials are created by the owner and stored server-side as hashes; agent API commands use bearer authentication. WebSockets only deliver validated snapshots/updates; all mutations use HTTP.

## Build, test, and run

```bash
npm test
npm run build
npm audit
npm start                 # production static UI + API
```

`npm run dev` runs Vite and the backend together. The backend defaults to `127.0.0.1:4174`, Vite proxies `/api` and `/api/stream`, and preview binds to `127.0.0.1`. `npm start` serves the built UI and API on loopback. Set `PORT` to change the port; the backend intentionally rejects non-loopback `HOST` values because TLS/LAN operation is not implemented. The SQLite database defaults to `glimpse-dock.sqlite`; set `GLIMPSE_DB` to use another protected writable location. Back up the database while the server is stopped.

## Project structure

- `src/main.ts` — authenticated frontend lifecycle, API and WebSocket transport.
- `src/admin/`, `src/display/`, `src/auth/` — Admin, Display, and access-gate UI.
- `src/shared/protocol.ts` — versioned Zod protocol and bounded command/state schemas.
- `server/server.ts` — Fastify API, auth, WebSocket, SQLite persistence, and production static serving.
- `server/adapters/demo.ts` — opt-in simulated state and commands.
- `tests/` — protocol, UI, auth, persistence, command, and WebSocket security tests.
- `docs/plans/2026-10-29-glimpse-dock-roadmap.md` — product roadmap.
- `docs/architecture/0001-local-backend-authority.md` — backend/security decisions.

The backend is designed as a single local process. HTTP is not encrypted; do not expose it to a LAN or public network. Database sessions and credentials are hashed, but local filesystem access remains trusted. Multi-user access, remote administration, TLS deployment, and a real Hermes adapter are future work.

## License

MIT. See [LICENSE](LICENSE).
