# Windows deployment

Use Task Scheduler to start the backend under the intended unprivileged Windows user. The action needs explicit program and working-directory paths; it does not reliably inherit an interactive shell's Node version-manager setup. Install a supported Node.js LTS and verify the executable paths first.

## Backend task

Create a task triggered **At log on** for the account that owns the application data. Configure **Run only when user is logged on** if you want the same user's desktop session and logs. Set the action as:

- **Program/script:** `C:\Windows\System32\cmd.exe`
- **Arguments:** `/d /c "npm.cmd start"`
- **Start in:** the absolute Glimpse Dock checkout directory, such as `C:\Apps\glimpse-dock`

Task Scheduler does not provide per-task environment-variable fields. Create an ACL-protected launcher script with only non-secret settings, for example:

```bat
@echo off
set "PORT=4174"
set "GLIMPSE_DB=%LOCALAPPDATA%\GlimpseDock\glimpse-dock.sqlite"
"C:\Program Files\nodejs\node.exe" "C:\Apps\GlimpseDock\start-production.mjs"
```

Create the data directory first and grant access only to this task's user. Set **Program/script** to `C:\Windows\System32\cmd.exe`, **Arguments** to `/d /c C:\Apps\GlimpseDock\run-server.cmd`, and **Start in** to `C:\Apps\GlimpseDock`. Use absolute paths and adapt the example if paths contain spaces; test the scheduler action. For first-run setup, run a temporary interactive process with the same `GLIMPSE_DB` and `PORT` values as the launcher and the bootstrap secret in a protected process environment; do not add it to the launcher, task arguments, exported task XML, or a broadly readable script. Complete setup, stop the temporary process, then run the scheduled task without the secret. Never store the owner password in the task or browser arguments.

Starting the task's backend does not launch a browser into a kiosk session. Keep backend startup and browser startup separate.

## Display browser

Configure Edge or Chrome kiosk/startup in the signed-in user's interactive session to open `http://127.0.0.1:4174/display`. Use a paired read-only display session or explicitly enabled local `display` mode. Do not put owner passwords, bootstrap secrets, or API keys in browser arguments. Verify that browser exit/login behavior matches the physical kiosk's intended recovery model.

## Stop, backup, rollback

Stop the scheduled task and verify the Node process exited before backing up the SQLite database. Prefer SQLite's backup command (`sqlite3.exe $env:GLIMPSE_DB ".backup 'C:/Users/USER/GlimpseDock-backup.sqlite'"`); it handles WAL state. Store the backup in an access-controlled location. For recovery, restore the known-good database backup, reinstall the previous application version, and start the task again. For removal, disable/delete the backend task and browser startup configuration, then delete application data only if it is no longer needed.

**Verification status:** the Task Scheduler and browser kiosk procedures are not machine-verified here. Verify task account/permissions, startup at logon, environment and working directory, loopback-default health (or explicitly configured CIDR/firewall-limited LAN access), database writes, logs, restart, backup/restore, browser startup, and removal on the target Windows version. See the [LAN security requirements](../security/local-deployment.md) before enabling remote Admin.
