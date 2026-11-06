# Trusted-LAN Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in owner-authenticated LAN Admin listener with mutually exclusive insecure HTTP or certificate-backed HTTPS, preserving loopback HTTP as the default.

**Architecture:** Keep Fastify and SQLite as the single local server. Store one normalized owner username alongside the existing password hash; keep session digests and CSRF. Validate listener transport before listening, bind only the selected private address, and retain strict request-origin and route boundaries.

**Tech Stack:** TypeScript, Fastify 5, SQLite, Node TLS, Vitest.

---

## Files

- Modify: `server/server.ts` (schema migration, auth, listener validation, TLS, route policy).
- Modify: `src/auth/view.ts`, `src/main.ts` (username setup/login and LAN warning/confirmation UI).
- Tests: `tests/server.test.ts`, `tests/server-security.test.ts`, `tests/websocket-security.test.ts`, `tests/voice-routes.test.ts`, `tests/backend-persistence.test.ts`, `tests/auth-view.test.ts`, `tests/auth-bootstrap.test.ts`.
- Docs: `README.md`, `docs/security/local-deployment.md`, relevant `docs/deployment/*.md`.

## Task 1: Owner identity compatibility

- [ ] Add failing tests: new setup requires bounded normalized username and password; login verifies username/password; a password-only database prompts a local one-time username upgrade; upgrade preserves stored password hash and session rows; remote request cannot bootstrap or upgrade.
- [ ] Run `npx vitest run tests/auth-view.test.ts tests/auth-bootstrap.test.ts tests/backend-persistence.test.ts tests/server-security.test.ts`; confirm the new assertions fail.
- [ ] Add a versioned SQLite migration for owner username metadata. Validate username at the trust boundary and use one database transaction for the existing-owner upgrade; do not rehash/change password or revoke sessions. Keep setup/migration loopback-only and preserve scrypt, constant-time comparison, CSRF and route rate limits.
- [ ] Update `src/auth/view.ts` and `src/main.ts` for setup/login username fields and the required local upgrade state; escape server-provided values and announce errors/status accessibly. When the server reports LAN HTTP, show the credential/session interception warning before submitting login and require explicit acknowledgment; keep the warning visible in authenticated Admin.
- [ ] Rerun the focused tests and verify an existing database remains usable after reopening.

## Task 2: Transport configuration and route security

- [ ] Add failing tests for default loopback HTTP; invalid/public/wildcard/unassigned bind rejection; missing, malformed, non-private or bind-excluding trusted CIDR rejection; LAN requests accepted only from the configured CIDR; IPv4-mapped IPv6 normalization; LAN access disabled by default; explicit HTTP versus HTTPS selection; no simultaneous listeners; TLS missing/mismatched/unreadable material rejection; exact origin/Host policy; `Secure` cookie only for HTTPS; and no HTTPS-to-HTTP fallback.
- [ ] Run `npx vitest run tests/server.test.ts tests/server-security.test.ts tests/websocket-security.test.ts tests/voice-routes.test.ts`; confirm new cases fail.
- [ ] Introduce validated listener configuration (testable independently of `listen`): default loopback HTTP; explicit private, host-assigned bind address plus explicit private trusted CIDR containing that bind; exactly one selected mode; HTTPS requires cert/key and exact HTTPS origin. Use Node interface data to verify bind assignment; enforce direct `req.ip` membership in the configured CIDR and normalize IPv4-mapped IPv6. Pass TLS material to Fastify's HTTPS server. Keep `trustProxy: false`; reject unsafe/malformed configuration before opening the listener and never log key bytes.
- [ ] Enforce configured exact origin and expected Host for mutating HTTP and authenticated WebSockets in either mode; retain CSRF/rate limits. Permit remote `/admin` plus authenticated Admin APIs/stream only. Reject remote Display pairing/redeem, Display surfaces, and all voice routes while leaving them available locally.
- [ ] Require explicit host configuration to select LAN HTTP. At the login boundary, block submission until the operator acknowledges interception risk; keep a persistent warning while HTTP is active. Mark HTTPS recommended and display safe startup/configuration errors; never describe HTTP as secure.
- [ ] Rerun focused security tests. Manually inspect session cookie headers and exercise authorized/unauthorized requests for both modes.

## Task 3: Operator documentation

- [ ] Until the LAN listener is implemented and verified, leave current README/deployment statements intact: the released/current server is loopback-only. Do not describe planned LAN support as available.
- [ ] Update README and local deployment/security docs: loopback default; required local owner setup/migration; transport choices; HTTP credential/session interception warning; HTTPS trusted-certificate/origin and external renewal/restart; protected key permissions; mandatory application CIDR and matching firewall restriction; no port forwarding/public exposure.
- [ ] After listener implementation and tests pass, replace obsolete “LAN/TLS unavailable” claims with the shipped transport behavior, setup requirements, CIDR and firewall policy. Keep deployment recipes consistent across operating systems.
- [ ] Run `git diff --check` and search docs for contradictory claims (`loopback only`, `TLS not implemented`, `non-loopback`).

## Completion

- [ ] Commit this lane after focused security/auth tests pass. Parent plan owns full suite/build, LAN browser/firewall acceptance, and security review before shipping.
