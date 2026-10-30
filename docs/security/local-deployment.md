# Local deployment and security boundary

## Trust model

Milestones 1–2 target one owner and paired read-only displays on the same trusted machine/network namespace. The service defaults to loopback and rejects non-loopback host configuration. It uses plain HTTP only on loopback; TLS and LAN access are intentionally unsupported. Do not tunnel or reverse-proxy it onto an untrusted network.

The bootstrap secret is provided out of band as `GLIMPSE_BOOTSTRAP_SECRET`; it is never served by the application. First setup is allowed once per database and requires a 12–128 UTF-8-byte owner password. Password hashes use Node `crypto.scrypt`; opaque session and agent secrets are stored as SHA-256 digests. Cookies are HttpOnly and SameSite=Strict. Loopback HTTP cookies are not marked Secure; TLS termination is not implemented.

Browser mutation requests require a matching loopback Origin/Host and owner CSRF token. Agent bearer calls are separately authorized and must not also send a browser session. Displays redeem one-time short-lived codes, receive read-only sessions, and can be revoked by the owner; active sockets close on revocation or expiration. WebSockets require a valid session and same-origin loopback Origin and accept at most 16 KiB inbound frames (client messages are rejected because the channel is read-only). Shutdown sends close code 1001 and terminates peers that do not finish the close handshake within one second.

Setup, login, and pairing redemption are rate-limited per route and source IP; scrypt concurrency, JSON body sizes, protocol strings/arrays, WebSocket payloads, and retained activity are bounded. Because this deployment binds only to loopback and does not have a trustworthy unauthenticated client identity, browser tabs and local processes share the same per-route rate-limit bucket; one local client can temporarily throttle another client's setup, login, or pairing redemption. This is an accepted availability tradeoff in the single-machine trust model, not isolation between local clients. Forwarded-IP headers are not trusted. Logs redact cookie, authorization, and Set-Cookie headers. Errors returned to clients are generic. The SQLite file is trusted local data: filesystem permissions, backups, and host access remain the operator's responsibility.

## Run safely

```bash
GLIMPSE_BOOTSTRAP_SECRET='one-time-secret' npm run dev
```

Optional controls are `GLIMPSE_DB` (SQLite file path), `GLIMPSE_DEMO=1` (explicit fake activity), and `PORT` (loopback listener port). `HOST` cannot be set to a non-loopback address. Never commit the bootstrap secret or share a database file containing credential hashes. A lost owner password currently requires a deliberate database reset; there is no remote recovery flow.

## Known limits

- Single-process in-memory connection registry; no cluster/multi-instance support.
- Session lifetimes are fixed; owners can revoke sessions but cannot tune expiry.
- No TLS/LAN/remote operation, multi-user roles, hardware-backed secrets, or external agent transport.
- Initial SQLite schema initialization is automatic; a full migration history is not yet implemented.
- Local processes with filesystem access are trusted and can read/replace the SQLite database.
