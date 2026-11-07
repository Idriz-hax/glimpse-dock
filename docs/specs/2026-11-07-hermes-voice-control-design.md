# Hermes-controlled microphone listening

**Status:** Design direction approved in conversation on 2026-11-07; implementation awaits review of this specification.

## Goal

Allow Hermes to start or stop Glimpse Dock's owner-display microphone listening from either CLI/Gateway sessions or Glimpse Dock's dedicated API-owned voice conversation, after the owner opts in. Continue to use the existing browser capture, local Wyoming services, and owner-only voice flow; do not create a second audio path.

## User-visible behavior

- The owner can explicitly enable Hermes mic control in voice settings. This is separate from the browser's microphone permission and from enabling the voice page.
- The owner must grant browser microphone permission. If the browser requires a prompt or user gesture when Hermes requests listening, show a clear status and a click-to-enable fallback; never bypass browser permission.
- Hermes requests a desired state (`listening` or `paused`) rather than issuing a toggle, so retries and concurrent requests are idempotent.
- When the owner display is open and voice control is opted in, Hermes requests can start or stop capture/listening. The UI visibly announces the source/state. The browser stream and local voice session remain in the existing owner page.
- If control is not opted in, the owner page is absent, permissions are denied, or the voice services are unavailable, do not start capture; return a safe status to Hermes and explain the state to the owner when the page is connected.
- Owner Stop/Disable always wins, releases the media tracks, and prevents queued requests from silently restarting capture. A future Hermes request may start it again only if the owner control opt-in remains enabled and the owner display is still open.
- Paired read-only displays receive no mic-control requests, transcripts, or audio. Raw audio remains local; only the existing bounded recognized transcript reaches Hermes.

## Architecture

- Add one narrowly scoped Hermes tool, `glimpse_voice_control`, to the optional Glimpse Dock plugin. It accepts only the desired listening state and submits it using the existing loopback agent-token client; it does not accept audio, transcripts, arbitrary UI commands, owner cookies, or credentials.
- Add an agent-authenticated backend control request, gated by the persisted owner opt-in. Use a short-lived, bounded request/acknowledgement path to the authenticated owner voice page; do not persist a pending start request across server restarts or owner logout.
- The owner page applies requests through its existing `getUserMedia`, WebSocket, and `VoiceSession` controls. Keep microphone state and request outcome visible and accessible. Stop requests can be applied immediately; start requests must pass browser permission and local service checks.
- Both CLI/Gateway and the API-owned Hermes session should call the same plugin tool and backend path. Verify that the supported Hermes release loads this plugin tool for API-owned sessions. If it does not, do not silently claim parity or add an undocumented Hermes API; report the supported limitation before shipping.
- Keep the Glimpse Dock feature opt-in and disabled by default. Agent tokens may request only voice state changes after the owner has granted this capability; they do not gain owner-session or widget-administration authority through this feature.

## Failure and lifecycle behavior

- Requests with invalid state, invalid/revoked agent tokens, or no owner opt-in fail closed.
- No connected owner page, disconnected voice socket, unavailable services, or browser permission failure returns a bounded failure status and does not queue a latent microphone start.
- Owner logout, page hide, voice disable, and session expiry stop capture and clear pending control requests.
- Concurrent state requests are ordered; the most recent valid desired state wins. A late start response must not undo a later owner stop.
- Do not log transcripts, audio, or sensitive tool payloads. Record only bounded outcome codes if diagnostics are needed.

## Verification

- Unit/route tests cover opt-in default off, owner persistence, agent authentication and revocation, strict payload allowlist, no owner-page/no-permission/service-unavailable failures, and no pending request surviving logout/restart.
- Browser/UI tests cover accessible opt-in, visible listening/paused/request-denied states, browser permission rejection and click fallback, owner Stop precedence, and no leakage to paired displays.
- Plugin tests cover valid `listening`/`paused` calls and safe errors.
- Run a live integration check against the documented Hermes version for both CLI/Gateway and API-owned sessions before claiming both are supported. If API tool parity cannot be verified, state that limitation instead of inventing a private API.
- Re-run TypeScript and Python suites, production build, and `git diff --check` before commit/push.

## Security and privacy

- Owner opt-in is required in addition to browser microphone permission. Permission is revocable in browser settings and is never treated as proof of continuing consent by itself.
- Only the authenticated owner display can receive/apply control requests. Agent credentials cannot target a user, device, route, or arbitrary browser session.
- The page never opens capture before the user's opt-in and browser permission; any browser-required user gesture remains mandatory.
- Voice control requests do not alter mute/pause/stop semantics to suppress the visible indicator or defeat owner controls.

## Out of scope

- Starting the microphone while Glimpse Dock is closed, while no owner display is active, or on a paired display.
- Remote/cloud capture, browser permission bypass, hidden capture, direct browser exposure of Hermes credentials, or sending raw audio to Hermes.
- Arbitrary Hermes control of other Glimpse Dock UI or settings.

## References

- Existing voice privacy and ownership design: [`2026-11-03-hermes-voice-display-design.md`](2026-11-03-hermes-voice-display-design.md).
- Hermes v0.22.6 [plugin documentation](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/website/docs/user-guide/features/plugins.md) and [API Server documentation](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/website/docs/user-guide/features/api-server.md); plugin-tool availability in API-owned runs still requires verification.
- Browser capture: [MDN `getUserMedia`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia); browser permission and user-activation behavior must be validated in the supported target browser.
