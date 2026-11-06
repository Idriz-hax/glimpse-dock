# Local deployment and security boundary

## Trust model

The service defaults to loopback HTTP. Trusted-LAN Admin is an explicit opt-in with one selected transport: insecure HTTP or HTTPS. It is not a public-hosting mode and does not support reverse-proxy trust. LAN HTTP exposes credentials and session cookies to interception and replay by anyone monitoring the network; HTTPS is recommended. Never use port forwarding or expose either listener to public networks.

The bootstrap secret is provided out of band as `GLIMPSE_BOOTSTRAP_SECRET`; it is never served by the application. First setup is allowed once per database and requires a bounded owner username and a 12–128 UTF-8-byte password. Existing password-only databases must be upgraded locally before LAN mode can start; the password hash and existing sessions are preserved. Password hashes use Node `crypto.scrypt`; opaque session and agent secrets are stored as SHA-256 digests. Cookies are HttpOnly and SameSite=Strict; Secure is set only for HTTPS. HTTPS terminates directly in the application; there is no HTTP fallback.

Browser mutation requests require the expected Host/Origin and owner CSRF token. LAN mode checks the direct socket peer against the configured CIDR; forwarded headers are ignored. Remote admission is restricted to Admin, its static assets, and authenticated owner Admin APIs/stream; setup/upgrade, display pairing/redeem, Display routes, voice/microphone routes, and agent bearer APIs remain local-only. Agent bearer calls are separately authorized and must not also send a browser session. Displays redeem one-time short-lived codes, receive read-only sessions, and can be revoked by the owner; active sockets close on revocation or expiration. WebSockets require a valid session and same-origin Origin and accept at most 16 KiB inbound frames (client messages are rejected because the channel is read-only). Shutdown sends close code 1001 and terminates peers that do not finish the close handshake within one second.

Setup, login, and pairing redemption are rate-limited per route and source IP; scrypt concurrency, JSON body sizes, protocol strings/arrays, WebSocket payloads, and retained activity are bounded. Because this deployment binds only to loopback and does not have a trustworthy unauthenticated client identity, browser tabs and local processes share the same per-route rate-limit bucket; one local client can temporarily throttle another client's setup, login, or pairing redemption. This is an accepted availability tradeoff in the single-machine trust model, not isolation between local clients. Forwarded-IP headers are not trusted. Logs redact cookie, authorization, and Set-Cookie headers. Errors returned to clients are generic. The SQLite file is trusted local data: filesystem permissions, backups, and host access remain the operator's responsibility.

## Run safely

Default, loopback-only operation:

```bash
GLIMPSE_BOOTSTRAP_SECRET='one-time-secret' npm start
```

LAN mode requires a numeric, private `HOST` address assigned to a local interface, a trusted private CIDR containing that address, and an exact origin including scheme and port. Example insecure HTTP (explicitly discouraged):

```bash
HOST=192.168.1.20 PORT=4174 GLIMPSE_LAN_MODE=http \
GLIMPSE_LAN_HTTP_INSECURE=1 GLIMPSE_TRUSTED_CIDR=192.168.1.0/24 \
GLIMPSE_LAN_ORIGIN=http://192.168.1.20:4174 npm start
```

HTTPS uses the same `HOST`, `PORT`, `GLIMPSE_TRUSTED_CIDR`, and exact HTTPS origin, plus `GLIMPSE_LAN_MODE=https`, `GLIMPSE_TLS_CERT=/protected/path/fullchain.pem`, and `GLIMPSE_TLS_KEY=/protected/path/private-key.pem`. The application checks the leaf certificate validity period and SAN coverage for the configured host; client/browser trust-root acceptance remains external and must also succeed. Keep the private key outside the database and logs with filesystem permissions limited to the service account. The application loads certificate material only at startup: renew certificates externally and restart the service afterward. The app enforces the trusted CIDR; configure the host firewall to allow the selected port only from that same CIDR. Never configure router port forwarding or public exposure.

Optional controls are `GLIMPSE_DB` (SQLite file path), `GLIMPSE_DEMO=1` (explicit fake activity), and `PORT` (listener port). `GLIMPSE_LAN_MODE` must be exactly `http` or `https`; there is no dual listener or downgrade. HTTP requires `GLIMPSE_LAN_HTTP_INSECURE=1` and the browser requires an unchecked-by-default explicit warning acknowledgement before credential submission. Never commit the bootstrap secret or share a database file containing credential hashes. A lost owner password currently requires a deliberate local database reset; there is no remote recovery flow.

## Known limits

- Single-process in-memory connection registry; no cluster/multi-instance support.
- Session lifetimes are fixed; owners can revoke sessions but cannot tune expiry.
- No public hosting, proxy termination, multi-user roles, hardware-backed secrets, or external agent transport.
- Initial SQLite schema initialization is automatic; a full migration history is not yet implemented.
- Local processes with filesystem access are trusted and can read/replace the SQLite database.
