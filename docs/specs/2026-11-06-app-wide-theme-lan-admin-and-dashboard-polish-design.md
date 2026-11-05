# App-wide theme, trusted-LAN Admin, and dashboard polish

**Status:** Approved for implementation (2026-11-06)

**Baseline:** `feature/hermes-integration` at `49c7c4d`

**Scope source:** User-approved design direction and Hermes tester feedback (2026-11-06)

## Goal

Make the existing Admin, Visual Display, sign-in/setup, voice, widgets, and feedback states feel like one product through a shared palette; fix the specific trust-eroding dashboard/display details identified by the Hermes tester; and support authenticated Admin access from a trusted LAN using a deliberate HTTP or HTTPS choice. Preserve the established layouts and activity model. This is a consistency and correctness pass, not a redesign or an unrestricted remote-hosting feature.

## Baseline and boundaries

The feature branch contains the completed scoped Quiet/Ambient visualization work. That selector controls Display motion/style behavior; it does not create a shared palette. Admin, Display, and auth still define separate hard-coded colors. Shared theme tokens are broader Milestone 6 work and remain incomplete.

The current deployment is loopback-only HTTP. It uses a bootstrap secret and owner password, not a username. Non-loopback HTTP is not supported. The new remote mode must not weaken the local-only default or make the service public/LAN-reachable by accident.

Implementation starts from the feature branch in an isolated worktree. Existing dirty `main` and feature worktrees are preserved; this work does not merge branches or overwrite their local changes.

## 1. One palette across the app

Define the color palette once in the existing global stylesheet as semantic CSS custom properties, then consume those properties throughout Admin, Display, auth/setup, voice, widgets, and all component states. Include surfaces, text/muted text, borders, brand accents, focus, hover/disabled treatments, overlays, and semantic status colors. Replace palette-specific hard-coded colors in styles and the widget/SVG color mapping; keep color literals only in the central token definitions.

Use the existing cool cyan/mint/slate family as the shared brand palette, with violet as a secondary brand accent. Remove the Admin-only lime/green brand treatment in navigation/logo/focus so primary interactions read consistently across surfaces. Keep success, warning, error, and offline colors semantically distinct; do not recolor errors or warnings as brand accents. Preserve Admin, Display, and sign-in surface treatments and layout differences, including the Display's atmospheric background. Quiet/Ambient remains a motion/presentation preference, not a second palette.

Verify text and controls against each surface for WCAG AA contrast, visible focus, and non-color status cues. No new palette, theme switcher, or visual redesign is in scope.

## 2. Tester feedback: truth and state clarity

- **Unknown progress:** never render `null%`. When progress is `null`, omit the progress bar and show an em dash only where a textual value is necessary. When supplied, display the validated value.
- **Consistent activity vocabulary:** derive dashboard/session badges from the authoritative activity state. Use `Active` for thinking/tool-use/responding, `Waiting` for waiting, and explicit `Idle`, `Completed`, `Error`, or `Disconnected` states as applicable. An actively processing turn must never be labelled `Inactive`.
- **Empty states:** the event stream says “No recent events yet” when empty. “No agent slots yet” is shown in the relevant slot/agent region with readable contrast, not as low-contrast footer text.
- **Unavailable controls:** explain the actual known reason and the condition that restores the control, based on readiness/configuration state. Do not invent a reason; if the cause is unknown, say that availability could not be determined and point to Health/diagnostics.
- **Version label:** remove the stale hard-coded `v0.1.0 alpha` footer label. Do not replace it with an unverified version claim.
- **Contextual Display visual:** keep the calm ambient identity at idle. For known active tool categories, replace the generic central blob with an accessible context icon: shell/terminal, code/brackets, or search/magnifier. Map only allowlisted tool categories; never render raw tool names, arguments, results, or other hook content. Use a neutral tool fallback when category is unknown.
- **Long-turn hint:** add a backend-authored nullable turn-start timestamp. Start it when a turn becomes active, retain it through thinking/tool-use/responding/waiting transitions, and clear it on idle/completed/error. Show elapsed time only while actively working (for example, “Running for 2m 14s”); hide it while waiting or when no start time is known. Existing persisted state defaults to no timestamp. Never synthesize a completion percentage.

Preserve current run-fencing and terminal-event protections; this change must not relax voice or activity lifecycle guarantees.

## 3. Authenticated trusted-LAN Admin with explicit HTTP/HTTPS choice

### Account setup and compatibility

- Use one owner account only; no roles, multi-user administration, or account-management system.
- New setup collects a bounded username and password alongside the existing bootstrap secret. Normalize the username consistently and retain existing password length/hash protections and login rate limiting.
- First-time setup remains loopback-only. Remote setup/bootstrap is not allowed.
- For existing password-only databases, preserve the password hash and sessions. After local owner login, require a one-time username selection before LAN mode can start. Commit the username upgrade atomically. Until upgraded, LAN mode fails closed with a clear startup explanation; local login remains available.

### Network and transport configuration

- Loopback-only HTTP remains the default and behaves as before.
- LAN Admin is explicit opt-in and offers mutually exclusive `HTTP (insecure)` and `HTTPS (recommended)` deployment modes; both require an explicit private LAN interface address. Do not accept wildcard or public-interface binds. Do not start both transports on LAN or silently downgrade HTTPS to HTTP.
- HTTPS requires a certificate file, matching private key, and exact HTTPS browser origin covered by a certificate trusted by client browsers. A public certificate can be issued using DNS-01 validation without exposing the app; local DNS can map the hostname to the private LAN address. A private CA is an alternative only if the operator configures trust on each client.
- LAN HTTP requires a separate explicit insecure opt-in. Display a persistent warning before and after activation explaining that usernames, passwords, and session cookies can be intercepted and replayed by anyone able to monitor the network. Require a deliberate confirmation; recommend HTTPS and a firewall-restricted trusted LAN. HTTP is never available remotely unless this mode is explicitly selected.
- Keep certificate/private-key material outside the database and logs; require protected filesystem permissions. Certificate issuance/renewal is external to the app; after renewal, restart the service to load the new files. Do not expose the service through router port-forwarding or public interfaces.
- Require host firewall rules allowing the selected LAN port only from the trusted subnet. Reject startup for missing/mismatched/unreadable TLS material in HTTPS mode, invalid origin, unsupported bind address, or unupgraded owner account. Report safe causes without exposing key contents.

### Request/auth boundary

- Remote owner login uses the single owner username/password. Use the existing password-hashing, session-digest, CSRF, and rate-limit mechanisms.
- Set owner session cookies `HttpOnly` and `SameSite=Strict`; set `Secure` in HTTPS mode. Require the configured exact origin for state-changing requests and authenticated WebSockets in either LAN mode; retain CSRF validation. Make clear that origin/CSRF checks do not protect credentials from interception in HTTP mode.
- Restrict remote routes to `/admin` and the authenticated APIs/WebSocket required by Admin. Keep paired-display routes/pairing and voice/microphone endpoints loopback-only.
- Do not trust arbitrary `Host`, `Origin`, or forwarded headers. LAN mode is a direct listener, not proxy mode.

## UX and operational states

The Admin flow covers: first-run bootstrap on localhost; existing password-only account upgrade on localhost; LAN access disabled by default; choosing HTTP with a persistent interception warning or HTTPS with certificate setup; TLS configuration failure with a safe diagnostic; wrong credentials/rate limiting; and authenticated Admin. In HTTPS mode, a missing, expired, or hostname-mismatched certificate is a browser/server TLS failure, not an app fallback to HTTP. HTTP mode must never be represented as secure.

Dashboard/Display coverage includes: null and supplied progress; idle, active, waiting, completed, error, and disconnected states; elapsed-time start/resume/clear; no events/no slots; known and unknown control-availability reasons; known/unknown tool category; and voice readiness/error states. Existing owner/paired-display separation remains intact.

## Verification and acceptance

### Automated

- Protocol tests cover nullable `turnStartedAt`, defaulting legacy records, active-transition timestamp behavior, and reset/retention rules.
- View tests cover null/present progress, badge mapping for every activity, empty-event/slot messages, control-reason copy, stale-version removal, known/unknown tool icons, and elapsed-time visibility/reset behavior.
- Auth tests cover new username/password setup, local-only one-time migration of existing password-only state without password/session loss, and login rate limiting.
- Server/security tests cover loopback default, explicit LAN opt-in, private-interface validation, HTTPS certificate startup failure, exact origin/Host checks, Secure-cookie behavior by transport, CSRF, authenticated remote Admin access, remote denial for pairing/Display/voice routes, and the HTTP warning/confirmation state.
- Audit source color values to confirm all palette values live in central tokens and all app surfaces consume them. Verify contrast and focus on Admin, Display, auth, voice, widget and operational/status surfaces.

### Manual/browser and external acceptance

- Review at 1920×1080 and a narrow viewport, with keyboard and screen-reader semantics. Confirm status is understandable without color or motion alone.
- On a trusted LAN, test both modes separately: HTTPS with a trusted DNS-01 certificate and no browser warning; HTTP only after the explicit warning/confirmation. Confirm credentials are never sent over HTTP unless the operator chose that mode, clients outside the firewall's trusted subnet cannot connect, unauthenticated clients cannot view protected Admin data, HTTPS never downgrades, and there is no router/public exposure.
- Run live Hermes CLI/Gateway and Hermes API Server + Wyoming voice checks on the user's actual installation. Automated/fake-client tests do not count as live voice acceptance. Record exact versions and privacy/run-fencing results in the existing validation checklist.

## Explicitly out of scope

No internet/public access, reverse-proxy mode, simultaneous LAN HTTP+HTTPS listeners, automatic certificate issuance/renewal, private certificate-authority distribution, multiple owner accounts, remote display pairing, remote voice/microphone, new agent orchestration, or wholesale layout redesign. LAN HTTP is an explicit insecure opt-in, not a recommended deployment. Broader Milestone 6 Admin completeness/accessibility items should be separately audited and prioritized; this design covers the concrete tester findings above, not every historical product idea.
