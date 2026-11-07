# Hermes Voice Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an owner-only local voice conversation with Hermes on `/display`, while retaining paired read-only displays and visible subagent status.

**Architecture:** The Glimpse Dock backend calls the Hermes API Server using a server-only key and maintains a separate API-owned Hermes session. The browser captures mic audio only for the active owner page; the backend proxies it to loopback Wyoming wake/STT/TTS services. Paired displays receive no voice data or controls.

**Tech Stack:** Existing Fastify/TypeScript/SQLite/Vitest; Hermes API Server HTTP/SSE; Wyoming TCP protocol with local openWakeWord, faster-whisper, and Piper services; browser `getUserMedia`, Web Audio, and WebSocket.

---

## File map

- `server/voice/hermes-api.ts`: authenticated API Server session/run client and event parsing.
- `server/voice/wyoming.ts`: bounded loopback Wyoming connections for wake detection, transcription, and synthesis.
- `server/server.ts`: owner/CSRF/origin-checked voice routes and owner-only event stream; persist only the API session ID in existing `kv` storage.
- `src/display/view.ts`, `src/display/voice.ts`, `src/display/voice-worklet.ts`, `src/main.ts`, `src/display.css`: role-aware voice-stage UI, microphone control, transcript, subagent status, audio framing, and local playback.
- `tests/voice-*.test.ts`, `tests/server-security.test.ts`, `tests/display-view.test.ts`: deterministic protocol, authorization, and UI tests.
- `docs/integrations/hermes.md`: local speech/API Server setup, key handling, limitations, and machine-run validation steps.

### Task 1: Hermes API Server client

**Files:** create `server/voice/hermes-api.ts`; test in `tests/voice-hermes-api.test.ts`.

- [ ] **Step 1: Add failing client tests.** Inject fake `fetch`; assert session/run calls forward optional AbortSignals, `startRun` uses `{input,session_id}` plus idempotency, and `stopRun` POSTs `/v1/runs/{id}/stop`. Parse the v0.22.6 SSE envelope (`event`, `text` for `message.delta`, `subagent_id` only for subagent status, and final `output` on `run.completed`); never expose subagent goal/preview or tool arguments. Require a terminal event and reject early EOF. Assert non-2xx/malformed events fail without raw body text.
- [ ] **Step 2: Run the focused test.** `npm test -- --run tests/voice-hermes-api.test.ts`; expect missing-module failures.
- [ ] **Step 3: Implement the minimal typed client.** Add `HermesApiClient(baseUrl,key,fetchImpl=fetch)` with abortable session/run admission, abortable stop, and terminal-aware bounded SSE parsing. Forward only assistant text deltas, safe subagent IDs/status, and bounded final output; never log request/response bodies or expose arbitrary upstream fields. A socket disconnect must request remote run stop when a run ID exists; local AbortSignal alone does not cancel Hermes execution.
- [ ] **Step 4: Pass focused tests.** `npm test -- --run tests/voice-hermes-api.test.ts`; expect all client contract fixtures to pass.
- [ ] **Step 5: Commit.** `git add server/voice/hermes-api.ts tests/voice-hermes-api.test.ts && git commit -m "feat: add Hermes API voice client"`.

### Task 2: Local Wyoming audio pipeline

**Files:** create `server/voice/wyoming.ts`; test in `tests/voice-wyoming.test.ts`; add `src/display/voice-worklet.ts` for bounded audio framing.

The module boundary is:

```ts
export type WyomingEvent = { type: string; data?: Record<string, unknown>; payload?: Buffer };
export class WyomingVoiceClient {
  constructor(services: { wake: string; stt: string; tts: string });
  listWakeModels(): Promise<Array<{ name: string; phrase: string }>>;
  listVoices(): Promise<string[]>;
  detectWake(audio: AsyncIterable<Buffer>, signal: AbortSignal, onDetection: (name: string, timestamp: number) => void, configuredName?: string): Promise<string | undefined>;
  transcribe(audio: AsyncIterable<Buffer>, signal: AbortSignal): Promise<string>;
  synthesize(text: string, voice: string, signal: AbortSignal): Promise<{ pcm: Buffer; rate: number; width: number; channels: number }>;
}
```

- [ ] **Step 1: Add protocol tests.** Use a local fake TCP server for `describe`/`info`, wake detection, streamed STT chunks with early VAD transcript before audio-stop, and Piper audio metadata. Assert configured model selection, iterator cleanup, 15-second/480,000-byte utterance cap, per-frame/protocol limits, timeout/abort, loopback-only endpoints, and no raw audio/transcript logs.
- [ ] **Step 2: Run the focused test.** `npm test -- --run tests/voice-wyoming.test.ts`; expect missing-module failures.
- [ ] **Step 3: Implement the client with Node `net`.** Accept only `127.0.0.1`/`localhost` service endpoints. Parse bounded Wyoming framing; apply socket backpressure; propagate abort through discovery, wake, streaming STT, and TTS. Cap STT utterances at 480,000 bytes and return when Whisper's VAD emits `transcript`, before waiting for source end. Enumerate installed models/voices only. Model installation and Whisper `--vad-endpointing 0.7` remain Task 5 setup; never download/install models in app code. Add no dependency.
- [ ] **Step 4: Add browser audio framing.** Implement an `AudioWorklet` that sends mono 16 kHz PCM frames only over the owner voice socket; don't buffer audio in browser storage. Cap each utterance at 15 seconds. Echo/noise constraints and pausing wake during TTS belong to Task 4 UI/socket integration.
- [ ] **Step 5: Pass focused protocol tests.** `npm test -- --run tests/voice-wyoming.test.ts`; expect fake-server framing, bounds, abort, and loopback checks to pass.
- [ ] **Step 6: Commit.** `git add server/voice/wyoming.ts src/display/voice-worklet.ts tests/voice-wyoming.test.ts && git commit -m "feat: add local Wyoming voice bridge"`.


### Task 3: Owner-only backend routes and session persistence

**Files:** modify `server/server.ts`; use `server/voice/hermes-api.ts` and `server/voice/wyoming.ts`; test in `tests/server-security.test.ts` and `tests/voice-routes.test.ts`.

- [ ] **Step 1: Add failing authorization/contract tests.** Create an owner via `/api/setup` and a paired display via `/api/display/pair` + `/api/display/redeem`. Assert the owner can get redacted voice readiness and create/reuse one API-owned Hermes session; paired display, agent bearer, wrong Origin, missing CSRF, oversized prompt, and missing server key receive errors before any Hermes client call. Assert transcripts never enter `/api/state` or paired-display WebSocket frames.
- [ ] **Step 2: Run focused tests.** `npm test -- --run tests/server-security.test.ts tests/voice-routes.test.ts`; confirm the new voice-route tests fail before implementation.
- [ ] **Step 3: Add server-only configuration.** Read `HERMES_API_SERVER_URL` (default `http://127.0.0.1:8642`), `HERMES_API_SERVER_KEY`, and `WYOMING_WAKE_URI`, `WYOMING_STT_URI`, `WYOMING_TTS_URI`; reject non-loopback URLs and return readiness flags only, never config values or credentials. Add fake-client injection to `createServer` options for deterministic tests.
- [ ] **Step 4: Add authenticated routes.** `GET /api/voice/status` is owner-only and returns service readiness plus installed wake/voice names, never URLs/keys. `POST /api/voice/settings` requires owner, same-origin, and CSRF; validate installed wake model, Piper voice, and enabled flag, then store non-secret preferences in `kv`. `POST /api/voice/session` creates the one API-owned session if absent and returns readiness only (never the session ID); `POST /api/voice/session/reset` requires owner/Origin/CSRF and replaces it only when no voice socket/run is active. `GET /api/voice/session` upgrades only after owner-cookie, Origin, and session-expiry checks; allow one active voice socket globally and register it for logout/revocation/expiry cleanup.

  The binary socket accepts bounded mono PCM16/16 kHz frames and JSON `resume`, `pause`, `manual-start`, `stop`, and `{type:'playback-ended',turn}` controls. Use one synchronous phase dispatcher and bounded queue; never persist or broadcast voice content. Phases: paused → wake → capturing → transcribing → running → speaking → wake; any failure returns to paused and socket close to closed. Manual start captures one utterance; enforce both 15 seconds and 480,000 bytes. On wake, capture only subsequent frames and stream them to local Whisper until VAD transcript or cap; an empty transcript submits no Hermes run. Submit one text turn via `/v1/runs`, retain run ID only in memory, stream allowlisted deltas/subagent IDs, and speak only bounded final `run.completed.output` through local Piper. EOF without a terminal run event is failure. On pause/stop/close, abort local work and call `/v1/runs/{id}/stop` when a run ID exists; don't admit another run until old run is terminal. Resume wake only on the current turn's matching `playback-ended` acknowledgement to prevent TTS echo retriggering. Turn IDs fence stale socket events. Stop capture and local connections on socket close/page hide.

  **Voice WebSocket wire format:** Client controls are JSON objects with `type` as above; client binary messages are one PCM16 little-endian mono 16 kHz frame, max 16 KiB. Each turn gets a monotonically increasing numeric ID. Server JSON events are `{type:'state',phase,turn:number|null}`, `{type:'wake',name,turn:number}`, `{type:'transcript',text,turn:number}`, `{type:'assistant.delta',text,turn:number}`, `{type:'subagent',action:'start'|'complete',subagentId,turn:number}`, `{type:'tts-start',rate,width,channels,bytes,turn:number}`, `{type:'tts-end',turn:number}`, and `{type:'error',code,turn:number|null}`. TTS uses raw PCM, not WAV: after `tts-start`, exactly one binary message contains `bytes` raw PCM in the announced format, then `tts-end`; only a matching playback-ended acknowledgement resumes wake listening. Never send Hermes session/run IDs or raw exceptions.
- [ ] **Step 5: Pass backend tests.** `npm test -- --run tests/server-security.test.ts tests/voice-routes.test.ts`; expect owner access to work, all other roles/origins to fail closed, and no API key/transcript to appear in shared state or logs.
- [ ] **Step 6: Commit.** `git add server/server.ts tests/server-security.test.ts tests/voice-routes.test.ts && git commit -m "feat: add owner-only voice routes"`.

### Task 4: Role-aware Display voice UI

**Files:** modify `src/main.ts`, `src/display/view.ts`, `src/display.css`; create `src/display/voice.ts`; test in `tests/display-view.test.ts` and `tests/voice-ui.test.ts`.

- [ ] **Step 1: Add role/state render tests.** Assert owner `/display` renders the voice stage, mic permission/enable control, wake-name selector, transcript region, subagent status rail, and settings; paired display renders the existing read-only display without any microphone, prompt, transcript, or settings controls. Assert all assistant/user text is HTML-escaped and error/listening announcements use accessible status/alert semantics.
- [ ] **Step 2: Run focused tests.** `npm test -- --run tests/display-view.test.ts tests/voice-ui.test.ts`; expect owner-view and binding tests to fail before implementation.
- [ ] **Step 3: Implement role-aware Display composition.** Pass the authenticated role into `renderDisplay`; preserve the current paired-display view exactly, and add a separate owner voice-stage renderer matching the approved option 02. Keep transcript and subagent status in ephemeral owner-only UI state. Add compact speech settings for installed wake models (default `hey_hermes`), listening pause, local Piper voice, and service readiness; never include an API key.
- [ ] **Step 4: Implement the voice socket client.** In `src/display/voice.ts`, require an explicit “Enable voice” click before `getUserMedia`, request mono audio with `echoCancellation` and `noiseSuppression`, frame 16 kHz PCM through the worklet, and send only to same-origin `/api/voice/session`. Handle typed server events, render text via `textContent`, play received Piper audio, and send `playback-ended` only when playback actually finishes. Provide manual-start, mute, stop, and pause controls. Stop tracks and close sockets on logout, session expiry, page hide, or user disable; don't persist transcript/audio in browser storage.
- [ ] **Step 5: Bind lifecycle and pass focused tests.** Update `src/main.ts` to start/stop the client only for owner role on `/display`; test microphone denial, service disconnect, socket close, TTS stop, and no capture on the paired role. Run `npm test -- --run tests/display-view.test.ts tests/voice-ui.test.ts`.
- [ ] **Step 6: Commit.** `git add src/main.ts src/display/view.ts src/display/voice.ts src/display/voice-worklet.ts src/display.css tests/display-view.test.ts tests/voice-ui.test.ts && git commit -m "feat: add owner voice display"`.

### Task 5: Setup docs and end-to-end validation

**Files:** update `docs/integrations/hermes.md`; update `PROJECT.md` only if its current status summary needs to reflect the completed voice feature.

- [ ] **Step 1: Document installation.** Explain the separate API-owned conversation; enable Hermes API Server with a long random `API_SERVER_KEY`; bind it to `127.0.0.1`; set the key only in the Glimpse Dock server environment; install `wyoming-openwakeword`, `wyoming-faster-whisper`, and `wyoming-piper` bound to loopback; install the pinned `hey_hermes.tflite` model from Hermes v0.22.6; configure installed wake models/voices, check selected model/voice licenses, note one-time model downloads, and explain that the API key grants the full Hermes toolset.
- [ ] **Step 2: Document limitations and manual checks.** State that voice starts a separate API-owned session, not the active CLI/Gateway transcript; keep wake listening limited to active owner `/display`; document local-only audio, model/voice license verification, permission/error states, and the exact live validation checklist.
- [ ] **Step 3: Run all focused and full checks.** `python3 -B -m unittest discover -s integrations/hermes/tests -v`, `npm test`, `npm run build`, and `git diff --check`; expect all automated checks to pass.
- [ ] **Step 4: Commit docs and record live-test pending.** Commit only documentation changes, state that a live test is pending unless the user has run it, and leave their machine-level Gateway/speech validation checklist intact.
