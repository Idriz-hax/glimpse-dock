# macOS deployment

Run the backend as a per-user `launchd` agent so it has the intended user's permissions. A LaunchAgent runs only in that user's login session; it is not a pre-login system daemon. Install Node/npm at stable absolute paths—`launchd` does not load interactive shell version-manager configuration.

Example `~/Library/LaunchAgents/local.glimpse-dock.server.plist` (replace the placeholder paths with verified absolute paths):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.glimpse-dock.server</string>
  <key>ProgramArguments</key>
  <array><string>/ABSOLUTE/PATH/TO/npm</string><string>start</string></array>
  <key>WorkingDirectory</key><string>/ABSOLUTE/PATH/TO/glimpse-dock</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>4174</string>
    <key>GLIMPSE_DB</key><string>/ABSOLUTE/PATH/TO/Library/Application Support/Glimpse Dock/glimpse-dock.sqlite</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/ABSOLUTE/PATH/TO/Library/Logs/Glimpse Dock/server.log</string>
  <key>StandardErrorPath</key><string>/ABSOLUTE/PATH/TO/Library/Logs/Glimpse Dock/server-error.log</string>
</dict>
</plist>
```

Create the database and log directories first, owned by the user and not group/world-writable. Keep the plist user-owned with restrictive permissions (for example `chmod 600`). Do not put the owner password or bootstrap secret in the plist. For initial setup, temporarily stop the LaunchAgent and launch `npm start` in a trusted Terminal shell with the same `GLIMPSE_DB` and `PORT` values as the plist, after reading the bootstrap secret without echo into a process-scoped environment variable; complete setup, stop the temporary server, unset the variable, then bootstrap the LaunchAgent without the secret. `launchd` does not source shell startup files. Validate the file and load it in the logged-in GUI domain:

```sh
plutil -lint "$HOME/Library/LaunchAgents/local.glimpse-dock.server.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.glimpse-dock.server.plist"
launchctl print "gui/$(id -u)/local.glimpse-dock.server"
```

## Display browser

Use the user's graphical login items (or the browser's own startup setting) to open `http://127.0.0.1:4174/display` at login. Keep this separate from the backend LaunchAgent. Use a paired read-only display session or explicitly enabled local `display` mode; never pass owner credentials in browser arguments. Validate browser startup in the target user's desktop session.

## Stop, backup, rollback

```sh
launchctl bootout "gui/$(id -u)/local.glimpse-dock.server"
sqlite3 "$HOME/Library/Application Support/Glimpse Dock/glimpse-dock.sqlite" ".backup '$HOME/GlimpseDock-backup.sqlite'"
```

SQLite's backup command handles WAL state. To recover, stop the agent, preserve the existing database, restore the protected backup at the configured path, then bootstrap the LaunchAgent again. To remove, boot it out, remove the plist and GUI login item, and delete the data/log directories only if no longer needed.

**Verification status:** the LaunchAgent and login-item examples are not machine-verified here. Verify absolute Node/npm paths, plist permissions, GUI-session startup, database writes, loopback-default access (or explicitly configured CIDR/firewall-limited LAN access), logs, restart, backup/restore, and removal on the target macOS version. See the [LAN security requirements](../security/local-deployment.md) before enabling remote Admin.
