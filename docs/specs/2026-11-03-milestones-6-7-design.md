# Milestones 6–7: operations, accessibility, and portable deployment

**Status:** User-approved design; awaiting review before implementation planning.

## Goal

Complete Milestone 6 with useful, accessible owner administration and a shared display profile. Complete Milestone 7 with a portable Node-based production setup and operator guidance for Linux, macOS, and Windows. Do not make Glimpse Dock depend on a particular computer, home directory, display, or operating system.

## Existing baseline

The app already has Overview, Widgets, Activity, and Settings pages; owner and paired-display roles; session pairing/revocation; SQLite persistence; loopback-only serving; Vite frontend build; and a TypeScript Fastify server. Display appearance currently includes quiet/ambient styles. Full roadmap scope is selected. There is no existing deployment guide directory or CI workflow. The Hermes/Wyoming runtime remains subject to later live validation.

## Milestone 6 design

### Shared display profile

Add one owner-managed profile, persisted by the backend and shared by all paired displays. It covers display scale, reduced-motion preference, visualization intensity, clock visibility, widget visibility, and layout. Keep the current full-screen Display presentation distinct from the Field Station Admin styling. Each browser's operating-system reduced-motion preference remains a safety override even if the shared profile allows motion.

Settings must show loading, saved, unsaved/error, and unavailable states. Failed saves must not silently present a new value as persisted. Validate profile values at the API boundary and provide safe defaults for existing databases and clients.

### Admin information architecture and diagnostics

Retain the existing Overview, Widgets, Activity, and Settings entry points. Add focused Agents, Displays, and Health/Diagnostics views (or equivalent clearly grouped sections) rather than one page per metric.

- **Agents:** list registered/revoked identities and only capabilities actually known to the backend. Do not infer online/idle status or capability support without a heartbeat/handshake source.
- **Displays:** list read-only paired sessions with expiry and allow owner revocation; do not expose session credentials.
- **Activity/diagnostics:** show recent accepted activity, rejected command summaries, and operational errors with bounded retention. Store allowlisted event codes and timestamps, not request bodies, prompts, transcripts, secrets, or raw exceptions.
- **Health/configuration:** report backend readiness, loopback binding, storage status, and whether optional integrations are configured/available. Never show key values, environment dumps, filesystem secrets, or stack traces. Distinguish configured, unavailable, and not yet verified.
- **Retention:** show the actual activity/log retention limits and storage behavior; do not claim an unimplemented cleanup policy.

Apply the chosen **Field Station** direction to Admin and Settings: restrained instrument-panel cues, compact indexed labels, near-black surfaces, and lime/amber semantic status accents. Avoid decorative density; preserve a clear hierarchy and readable body text. Keep the fullscreen Visual Display's existing visual identity.

Accessibility and operational states are part of the feature: keyboard access and visible focus, touch-friendly controls, semantic headings/labels/status announcements, verified contrast, narrow layouts, reduced motion, and clear loading/empty/error/offline states. Bound client/server diagnostic buffers and test cleanup over long sessions.

## Milestone 7 design

### Portable application and operator deployment

Keep one Node/npm app with SQLite and loopback as the default. Do not add native installer packages or OS-specific assumptions to application behavior. Make production build/start commands work from Windows shells as well as POSIX shells, define production configuration and data-directory permissions, and document backup/restore, update, restart, recovery, and removal.

Provide OS-native process/kiosk recipes at the deployment boundary:

- Linux: systemd service under a dedicated unprivileged identity and graphical-session kiosk autostart.
- macOS: per-user `launchd` agent and graphical-session browser login item.
- Windows: Task Scheduler process start and signed-in-session Edge/Chrome kiosk/startup guidance.

The backend remains a loopback service. The browser kiosk runs in a logged-in desktop session, not as a headless system service. Do not persist owner passwords in service files or browser automation. Include a cross-platform build/test matrix if the repository CI host permits it; document any service-manager and kiosk behaviors that still require manual testing on the target OS.

### Opt-in same-device auto-access

Add a single configuration mode, default `off`, with `display` and `owner` choices. It only applies to same-origin loopback UI requests and never permits LAN/remote access.

- `display`: issue a short-lived, revocable read-only display session without a pairing code.
- `owner`: after normal first-run owner setup exists, issue an owner session without asking for the password. This is a deliberate privilege bypass for a trusted single-user device. Emit a prominent startup log warning and visible UI warning. It does not store a password and does not start microphone capture; voice still requires explicit user activation.

Do not use `Host` or a client-supplied local IP alone as proof of local access. Apply the same strict Origin/session checks to auto-access endpoints as other authenticated routes. The display-only mode must not confer owner rights, and the owner mode must be opt-in separately from the default behavior. Paired displays remain read-only unless the operator explicitly selects owner mode for that local device.

## Approaches considered

1. **Full roadmap, shared backend profile, truthful diagnostics, portable Node deployment, native service guides (selected).** Completes both milestones while reusing existing app and persistence boundaries.
2. **Essentials-only UI and generic install notes.** Smaller, but does not meet the requested full Milestone 6 and 7 scope.
3. **Native installer packages for each OS.** More maintenance and platform-specific code than needed for a portable local app; not selected.

## Verification and acceptance

- Full unit/integration suite and production build pass after reconciliation.
- Profile validation, persistence/restart, paired-display synchronization, and failed-save behavior have tests.
- Admin diagnostic records are bounded, redacted, and never include secrets or voice content; unknown states remain unknown.
- Keyboard, contrast, reduced-motion, touch, responsive, loading/empty/error/offline behavior are audited for Admin and Display.
- Cross-platform CI/build checks cover Linux, macOS, and Windows where available. Verify portable start command and database startup behavior per platform.
- Review service templates/scripts for loopback binding, correct user context, least privilege, secret handling, and writable data paths.
- Clearly separate CI-verified application behavior from machine-dependent systemd/launchd/Task Scheduler and kiosk behavior. No OS-specific operational claim is marked verified without evidence from that OS.
- Local auto-access defaults off; tests prove disabled behavior, same-origin loopback restrictions, display-only privilege, owner-mode warning behavior, and that microphone activation remains explicit.

## Scope boundaries

No additional agent integrations, cloud/LAN exposure, native installers, stored owner passwords, automatic microphone activation, guessed agent presence, arbitrary retention promises, or claims of live Hermes/Wyoming compatibility are included.
