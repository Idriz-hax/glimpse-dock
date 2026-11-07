# Hermes Voice Display Design

**Status:** Approved in conversation on 2026-11-03, including a separate Hermes API Server session rather than attaching to an active Gateway/CLI chat.

## Goal

Make Glimpse Dock's existing `/display` the owner-facing place to monitor Hermes and have a local voice conversation in a dedicated API-owned Hermes session. Keep paired displays read-only and private. Also fix the Hermes widget result contract and pairing-code usability issues reported during live testing.

## Scope

This work has two independently testable parts:

1. **Integration and pairing fixes:** return Hermes widget results as JSON strings; extend pairing-code validity; distinguish invalid and expired pairing codes, show understandable server errors, and document the contract and timeout.
2. **Voice-enabled Display:** add an owner-only voice interface on `/display`, driven by a local speech service and a supported, authenticated Hermes conversation interface.

The existing Hermes plugin remains opt-in and lifecycle metadata remains free of prompt/response text. Voice conversation is a separate, explicit owner action and must use a documented authenticated Hermes interface. No live validation claim is implied beyond the user's report that Hermes Agent v0.22.6 Gateway was used for plugin testing.

## Approved product behavior

- Use the selected **voice-first stage** layout: conversation is primary; the subagent roster remains visible beside it.
- Reuse `/display`, not a new route. An owner-authenticated `/display` session can interact; a paired display session retains its read-only activity/widget experience.
- Voice turns go to a dedicated API-owned session on the configured Hermes profile; they do not join the user's active CLI/Gateway transcript. Subagents from that voice session are visible for status only; voice does not address an individual subagent directly.
- Speech recognition, wake-name detection, and speech synthesis run through a local speech service. The service listens only while the owner Display is active, the user has granted microphone permission, and listening is enabled. Show a persistent microphone/listening indicator and a pause control. Provide a manual talk control as a fallback.
- Configure the wake name in the owner Display; default phrase is “Hey Hermes”.
- Keep transcript and spoken-response text in the owner session only. Do not persist it in Glimpse Dock, log it, or broadcast it to paired displays. Hermes retains conversation history in its API-owned session.
- Keep the Hermes API Server key server-side. Only the recognized transcript (not raw audio) is submitted to Hermes.

## Architecture and data flow

1. The owner opens `/display`; role-aware rendering grants microphone and conversation controls only to the owner session. Paired display sessions continue to receive status/widgets and never receive voice controls or transcript content.
2. The local speech service detects the configured wake phrase and performs speech-to-text and local text-to-speech. The UI provides an explicit manual talk fallback, mute/stop controls, and visible service/microphone state.
3. The browser sends recognized text to an owner-authenticated Glimpse Dock backend endpoint. The backend validates owner role, CSRF/origin, input size, and active Hermes configuration; it does not expose Hermes credentials to browser code.
4. The Glimpse Dock backend calls the documented Hermes API Server over loopback using a server-held `API_SERVER_KEY`. Create or resume the UI's API-owned session, submit each turn through the supported run endpoint, and correlate run terminal events. This uses the same Hermes profile/config/tools but remains separate from the active CLI/Gateway transcript. Stream only the needed response and bounded subagent status to the owner UI for local speech; never mirror transcript/tool content to paired displays. Do not use private Gateway bootstrap tickets or scraped dashboard credentials.
5. Existing plugin hooks continue reporting normalized lifecycle metadata for sessions they observe; they do not carry conversation content. Voice-session subagent status comes from documented API run events, not an assumption that plugin hooks identify the API-owned session.

The local speech service boundary and exact engine/package are to be selected in the implementation plan based on supported local runtime, model size, licensing, and a small hardware test. Browser-native recognition is not an acceptable default because local-only processing is not guaranteed across browsers.

## Configuration and states

Owner Display settings expose the local speech-service connection/health, listening enable/pause, wake name, and local output voice. Hermes API Server URL/session ID and `API_SERVER_KEY` remain server-managed, not browser-persisted. The main stage covers idle/paused, wake/listening, transcribing, waiting for Hermes, speaking, disconnected, permission-denied, service-unavailable, and request-failed states. A failed voice setup must leave the existing read-only Display usable and explain the recovery action.

The conversation transcript is transient UI state. Reload/logout clears it; Glimpse Dock does not create a transcript database or transcript log.

## Pairing and widget fixes

- Change all `widget_handler` paths to return `json.dumps(result, default=str)` so Hermes receives a string for success and error results. Update fixture tests to parse the returned JSON and assert its decoded shape.
- Increase pairing-code TTL from 60 seconds to five minutes.
- Have the pairing endpoint return structured, distinct errors for an unrecognized code, an expired code, and rate limiting. The UI should show the server's safe `error.message` (with a useful fallback) and preserve accessible alert/status announcements.
- Update `docs/integrations/hermes.md` to describe JSON-string widget results and the five-minute pairing window.

## Security and privacy

- Enforce that only owner sessions can submit prompts or configure voice. Paired display credentials remain read-only; agent credentials do not grant owner conversation access.
- Validate same-origin/CSRF and request bounds at the existing backend trust boundary; do not trust a role supplied by the client.
- Keep the full-privilege Hermes API Server key out of browser state, app database, and logs; load it from the protected Glimpse Dock server environment. Do not expose the API Server directly to the browser; keep it bound to loopback and do not enable CORS for Glimpse Dock. Do not log prompts, responses, raw audio, or transcripts in Glimpse Dock.
- The API Server key grants access to Hermes' full agent toolset. Explain this privilege before enabling voice.
- Raw audio is processed only by the local speech service. Do not submit audio to Hermes.
- Distinct pairing errors are acceptable because codes are random, short-lived, and rate-limited; still ensure responses do not reveal owner/session information.
- Keep the mic state visible; stop capture on pause, logout, owner session expiry, page hide, or close.

## Failure behavior

- Missing local speech service: show service unavailable and setup guidance; keep read-only status/widgets working.
- Mic denied/revoked: explain how to grant permission and retain the manual controls only if capture becomes available.
- Hermes API Server disconnected, rejected submission, timeout, or failed/cancelled run: show a concise owner-only error, stop speaking, and do not report a successful turn. A later user turn may reconnect through the documented API session flow.
- Wrong pairing code, expired code, and rate limit have distinct concise messages and recovery guidance. Do not collapse server errors to a bare “Forbidden”.

## Verification

Automated tests cover:

- JSON string type and decoded success/error payloads for Hermes tool fixtures.
- Pairing expiry, invalid code, expired code, rate-limit response, and displayed server message.
- Owner-only prompt/config authorization, paired-display denial, CSRF/origin enforcement, bounded prompts, and no broadcast of transcript content.
- API Server session/run request correlation with fixtures for accepted submission, streamed subagent status, terminal success/failure/cancellation, disconnect, and timeout.
- Local speech-service boundary fixtures for wake detection, transcript delivery, TTS state, permission denial, unavailable service, and stop/pause behavior.

Run the full Python and TypeScript test suites plus production build after reconciliation. Manual validation remains required on Hermes Agent v0.22.6 Gateway and the target browser/machine: enable the API Server, configure its key server-side, verify API-owned session creation/run streaming and subagent events, test local engine installation/resource use, wake recognition, local-only audio, spoken reply, stop/permission behavior, role separation, and pairing UX. Record the observed Hermes version and environment; fixture tests do not substitute for that live check.

## Explicitly out of scope

- Joining an already-active CLI/Gateway conversation over Gateway WebSocket (the tagged release has no supported generic external WebSocket auth/bootstrap path).
- Always-on wake listening while the browser is closed or outside the active Display page.
- Direct voice prompting of individual subagents.
- Broadcasting or storing transcript/response content in Glimpse Dock or paired displays.
- Additional agent integrations, cloud speech services, or replacing Hermes Gateway's conversation storage.
- Automatically managing the user's Chromium process or unrelated Hermes memory-provider startup issues.

## References

- Existing integration and capability limits: [`docs/integrations/hermes.md`](../integrations/hermes.md).
- Official [Hermes v0.22.6 plugins documentation](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/website/docs/user-guide/features/plugins.md).
- Official [Hermes v0.22.6 hooks documentation](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/website/docs/user-guide/features/hooks.md).
- Official [Hermes v0.22.6 API Server documentation](https://github.com/NousResearch/hermes-agent/blob/v0.22.6/website/docs/user-guide/features/api-server.md).
- Tagged Gateway WebSocket session/prompt methods are not used for external authentication; the API Server is selected because it has a documented bearer-authenticated external surface and API-owned sessions.
- Official [Gateway Local Sessions documentation](https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-local-sessions) (verify exact event/auth details against the v0.22.6 tag when implementing).
