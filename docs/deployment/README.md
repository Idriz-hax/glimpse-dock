# Portable deployment

Glimpse Dock is a single local Node.js process with a SQLite database and a browser UI. Keep the backend bound to loopback; it is not designed for LAN or public-network access. Run the backend and the graphical browser kiosk as separate user-session jobs.

## Requirements and install

Install Node.js 22.12+ or 24 and npm. CI tests Node 22 and 24; older runtime versions are not covered by the current matrix. From a trusted checkout:

```text
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4174/admin` to set up the owner. The server serves Admin and Display routes on loopback. It intentionally rejects non-loopback `HOST` values. `PORT` changes the port; `GLIMPSE_DB` selects the SQLite file (default `glimpse-dock.sqlite`). Set the database path to a persistent directory writable only by the service account. Never put the database in a temporary directory or a shared/world-writable location.

First-run owner setup requires `GLIMPSE_BOOTSTRAP_SECRET` and an owner password of 12–128 UTF-8 bytes. Supply the one-time bootstrap secret through a short-lived protected process environment, not a command-line argument or checked-in file; remove it after initial setup. Do not store the owner password in a service definition or browser startup arguments. Logs go to the process/service manager's standard output and error; do not include secrets in log configuration.

## Same-device access modes

`GLIMPSE_LOCAL_AUTO_ACCESS` is `off` by default. `display` grants a local browser a read-only Display session; `owner` grants owner access to local clients able to reach the service, but only after initial owner setup. Owner mode is a deliberate local privilege bypass: enable it only on a trusted single-user device, heed the startup/UI warning, and disable it when no longer needed. It does not store a password and never starts microphone capture; voice requires explicit user activation. Neither mode allows LAN access.

Pair a separate display through Admin's one-time pairing flow. Revocation and sign-out are available from Admin. Keep the kiosk browser in the intended signed-in desktop session; do not run a graphical browser as a system service.

## Update, backup, recovery, removal

1. Stop the backend service and confirm it has exited before backing up the SQLite database. If the SQLite CLI is installed, prefer its backup command (`sqlite3 "$GLIMPSE_DB" ".backup '$BACKUP_PATH'"`); otherwise, after a clean shutdown, copy the database and any remaining `-wal` file together rather than copying the main file alone.
2. Make a protected backup of the database. Keep backups access-controlled like the live database.
3. Update the checkout, run `npm ci`, then `npm run build`; restart with `npm start`.
4. If startup or migration fails, stop the process, preserve the failed database for diagnosis, restore the last known-good backup, and restart the previous known-good application version. Do not overwrite the only backup.
5. Inspect the service manager's stdout/stderr for startup errors; the application does not provide remote administration.
6. To remove, stop/disable the service and kiosk autostart, archive or delete the database according to the owner's retention needs, then remove the checkout and its Node dependencies.

The service recipes below are examples, not machine-verified deployment artifacts. Substitute absolute paths and test them on the target OS. The GitHub CI matrix verifies application tests/builds; it does not verify OS service managers or kiosk behavior.

- [Linux: systemd and desktop kiosk](./linux.md)
- [macOS: LaunchAgent and login item](./macos.md)
- [Windows: Task Scheduler and browser startup](./windows.md)
