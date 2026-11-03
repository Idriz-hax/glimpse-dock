# Linux deployment

This is an example for a systemd host. Use a dedicated unprivileged account, a protected persistent database directory, and an absolute Node/npm path. The sample assumes the checkout is `/opt/glimpse-dock`, the service account is `glimpse-dock`, and the database directory is `/var/lib/glimpse-dock`; adapt and verify every path.

```ini
# /etc/systemd/system/glimpse-dock.service
[Unit]
Description=Glimpse Dock local workspace
After=network.target

[Service]
Type=simple
User=glimpse-dock
Group=glimpse-dock
WorkingDirectory=/opt/glimpse-dock
Environment=PORT=4174
Environment=GLIMPSE_DB=/var/lib/glimpse-dock/glimpse-dock.sqlite
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/glimpse-dock

[Install]
WantedBy=multi-user.target
```

Create the service account and directories with ownership restricted to that account. Keep the checkout outside protected home directories (the sample uses `/opt` and `/var/lib`); if adapting paths under `/home`, review and adjust `ProtectHome=true` and the allowed write paths. Install Node/npm at the absolute path used by `ExecStart` (version-manager shims may not be available to systemd). Install the checkout and dependencies so the service account can read them. Then reload and enable:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now glimpse-dock.service
systemctl status glimpse-dock.service
journalctl -u glimpse-dock.service
```

Do not put the owner password or persistent bootstrap secret in the unit. For first setup, stop the unit and run `npm start` temporarily as the service account with the same `GLIMPSE_DB` and `PORT` values as the unit, and `GLIMPSE_BOOTSTRAP_SECRET` set only in that process environment (for example, read it without echo using the shell's secure-input facility); complete owner setup, stop the temporary process, clear the variable, then start the unit without the secret. A system service starts the backend only; it does not establish a logged-in graphical session.

## Display kiosk

Autostart the browser in the intended desktop user's session, separately from systemd. For example, create a desktop-session autostart entry that launches the installed browser with `http://127.0.0.1:4174/display`. Use a paired Display session or the explicitly configured local `display` access mode. Do not launch the browser as root or put owner credentials in browser arguments. Browser kiosk flags and desktop autostart behavior vary by desktop environment; test at the actual console login.

## Stop, backup, rollback

```sh
sudo systemctl stop glimpse-dock.service
sudo sqlite3 /var/lib/glimpse-dock/glimpse-dock.sqlite ".backup /var/lib/glimpse-dock/backup.sqlite"
```

The SQLite backup command is WAL-aware. To recover, stop the service, preserve the existing database, restore the protected backup as the configured database file, reinstall the previous application version, then `sudo systemctl start glimpse-dock.service`. To remove, disable/stop the unit, delete the unit file and reload systemd, remove the desktop autostart entry, and delete the data directory only if its data is no longer needed.

**Verification status:** the service and desktop-session examples are not machine-verified here. Verify user/group permissions, write access, startup after boot, loopback-only health, owner setup, restart, backup/restore, and browser launch on the target distribution and desktop environment.
