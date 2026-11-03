# Milestone 7 Portable Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the production app reproducibly on Linux, macOS and Windows, with optional same-device auto-access and safe kiosk/service guidance.

**Architecture:** Keep one Node/npm application and SQLite store, bound to loopback. Add a default-off same-origin local access mode (`off`, `display`, or `owner`), and keep OS-specific service/kiosk behavior in deployment examples rather than application logic.

**Tech Stack:** Node.js 22.12+/24, TypeScript/tsx, Fastify, SQLite, npm, GitHub Actions, systemd, launchd, Windows Task Scheduler.

---

## File map

- `server/server.ts`: parse deployment configuration, production entry behavior, auto-access route and startup warning.
- `src/main.ts`, `src/auth/view.ts`, `src/admin/view.ts`: auto-access bootstrap and visible owner-mode warning; preserve normal sign-in/setup and explicit voice activation.
- `package.json`, `server/start-production.ts` (if needed): shell-independent production start command and runtime TSX dependency.
- `tests/server-security.test.ts`, `tests/auto-access.test.ts`, `tests/production-start.test.ts`: security modes and production startup contract.
- `.github/workflows/ci.yml`: Node build/test matrix for Linux, macOS and Windows.
- `docs/deployment/README.md`, `docs/deployment/linux.md`, `docs/deployment/macos.md`, `docs/deployment/windows.md`: shared install/recovery plus OS-specific service and kiosk instructions.

### Task 1: Make production start portable across shells

**Files:** modify `package.json`, `server/server.ts`; create `server/start-production.ts` only if it avoids shell-specific environment assignment; test `tests/production-start.test.ts`.

- [ ] Replace the POSIX-only `NODE_ENV=production ...` npm command with a command that works in PowerShell, cmd, and POSIX shells. Keep Vite/dev server behavior unchanged.
- [ ] Ensure production serves built `/`, `/admin`, and `/display` routes, binds only loopback, and exits cleanly. Keep data path explicit through `GLIMPSE_DB`; document owner-controlled directory permissions.
- [ ] Test production mode selection and route serving with a temporary DB/build fixture. Run `npm run build` and the focused startup test.

### Task 2: Implement default-off local auto-access securely

**Files:** modify `server/server.ts`, `src/main.ts`, `src/auth/view.ts`; create `tests/auto-access.test.ts`; extend `tests/server-security.test.ts`.

- [ ] Parse `GLIMPSE_LOCAL_AUTO_ACCESS` strictly as `off` (default), `display`, or `owner`; invalid values fail startup with a generic configuration error. Owner mode is inactive until first-run password setup has completed. Keep the runtime dependency `tsx` available to `npm start` in production installs, and avoid POSIX-only inline environment assignments.
- [ ] Add a same-origin POST bootstrap route. It may mint only the selected role, must require loopback client address and exact loopback Origin/Host match, use the existing hashed-session/cookie/expiry/revocation mechanism, and never accept role choice from request data. A request with no trusted Origin is rejected.
- [ ] In the UI, try the bootstrap route before rendering a gate; if disabled/rejected, preserve existing sign-in/setup/pairing. Display mode remains read-only. Owner mode displays a persistent warning; it never stores passwords or starts voice/microphone without explicit activation.
- [ ] Test disabled default, invalid config, non-loopback/host mismatch, malicious Origin, role cannot be selected by request, read-only display, owner setup prerequisite, session expiry/logout/revoke, warning visibility, and no automatic voice activation.
- [ ] Run `npx vitest run tests/auto-access.test.ts tests/server-security.test.ts tests/voice-ui.test.ts`.

### Task 3: Add OS build/test matrix

**Files:** create `.github/workflows/ci.yml`; adjust package scripts only if required.

- [ ] Add a matrix for `ubuntu-latest`, `macos-latest`, and `windows-latest`, pinned to a supported Node LTS. Use `npm ci`, `npm test`, and `npm run build`; avoid secrets and deployment side effects.
- [ ] Validate YAML structure and run the same commands locally on the available OS. Keep native service/kiosk claims separate from this CI evidence.

### Task 4: Write portable install, service, kiosk and recovery instructions

**Files:** create `docs/deployment/README.md`, `docs/deployment/linux.md`, `docs/deployment/macos.md`, `docs/deployment/windows.md`.

- [ ] Document clean install/update with Node/npm, production build/start, loopback-only access, bootstrap secret/password setup, environment configuration, data-directory permissions, SQLite backup/restore, logs, restart/recovery and removal.
- [ ] Linux: provide a systemd service using an unprivileged account, explicit working/data paths and protected environment file; provide a user desktop-session kiosk autostart example.
- [ ] macOS: provide a per-user LaunchAgent plist and a graphical-session browser login-item approach; explain log/data paths and safe environment loading.
- [ ] Windows: provide Task Scheduler startup instructions and a PowerShell example that keeps the server under the intended user; provide Edge/Chrome kiosk/startup guidance.
- [ ] Explain auto-access modes and their risk: default off; display is read-only; owner mode grants local owner control to any client able to access the service and must show the warning prominently. Never put API keys/passwords in browser arguments, source control, or world-readable service files.
- [ ] Mark Linux/macOS/Windows service-manager and kiosk procedures as machine-verified only after execution on each OS; give exact smoke-test commands and rollback steps.

### Task 5: Security and end-to-end verification

**Files:** tests and deployment docs as needed.

- [ ] Review auto-access for Origin/loopback bypass, CSRF, cookie scope, role escalation, session revocation and microphone activation. Run the security-reviewer before shipping.
- [ ] Run `npm test`, `npm run build`, `git diff --check`, Python Hermes fixtures, and the CI matrix commands. Test service startup with temporary data directories on each available OS.
- [ ] Confirm no docs are staged/committed without explicit permission; keep `.superpowers/` and other AI-only folders untracked.
