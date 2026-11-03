# Milestone 6 Operations and Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete owner operations and a persistent shared display profile with accessible, truthful states.

**Architecture:** Extend the validated state/profile pipeline and SQLite persistence; keep owner-only mutations behind existing CSRF/Origin checks and broadcast read-only state to displays. Add bounded, redacted operational diagnostics and organize the existing Admin rather than replacing its framework.

**Tech Stack:** TypeScript, Fastify, Zod, SQLite, Vite, Vitest, native DOM.

---

## File map

- `src/shared/protocol.ts`, `src/demo-state.ts`: preferences schema/default and protocol state compatibility.
- `server/server.ts`: persistence, profile authorization/broadcast, diagnostics and bounded audit records.
- `src/main.ts`, `src/admin/view.ts`, `src/style.css`: fetch/state lifecycle, Admin navigation/views, accessible styling.
- `src/display/view.ts`, `src/display/widgets.ts`, `src/display.css`: render shared display preferences without changing owner voice/privacy behavior.
- `tests/server-security.test.ts`, `tests/*protocol*`, `tests/admin-view.test.ts`, `tests/display-view.test.ts`, `tests/display-preferences.test.ts`, `tests/admin-diagnostics.test.ts`: focused contract and UI coverage.

### Task 1: Define a bounded display profile

**Files:** modify `src/shared/protocol.ts`, `src/demo-state.ts`; test existing protocol and new `tests/display-preferences.test.ts`.

- [ ] Define strict `DisplayPreferencesSchema` with `scale: compact|normal|large`, `reducedMotion: boolean`, `intensity: subtle|balanced|vivid`, `showClock: boolean`, `showWidgets: boolean`, and `layout: balanced|compact`; default to normal scale, no shared motion reduction, balanced intensity, clock/widgets shown, balanced layout. Add a legacy-safe default to state.
- [ ] Update `loadState()` so older persisted snapshots missing the profile receive defaults, while explicitly malformed profiles are rejected and fall back safely.
- [ ] Test valid/default and rejected enum, wrong-type, and unknown-key inputs; this profile deliberately uses bounded enums rather than numeric settings.
- [ ] Run `npx vitest run tests/display-preferences.test.ts tests/protocol.test.ts`.

### Task 2: Persist and broadcast owner profile changes

**Files:** modify `server/server.ts`, `tests/server-security.test.ts`, `tests/display-preferences.test.ts`.

- [ ] Add a strict owner-only `display.preferences.set` command; paired display and agent principals must be rejected. Persist it in the same SQLite state transaction and fan it out through existing snapshots.
- [ ] Add tests for owner save, restart persistence, paired snapshot update, invalid input, agent denial, and no partial write on persistence failure.
- [ ] Run `npx vitest run tests/server-security.test.ts tests/display-preferences.test.ts`.

### Task 3: Add accessible preference controls and Display rendering

**Files:** modify `src/admin/view.ts`, `src/main.ts`, `src/display/view.ts`, `src/display/widgets.ts`, `src/style.css`, `src/display.css`; test `tests/admin-view.test.ts`, `tests/display-view.test.ts`, `tests/display-preferences.test.ts`.

- [ ] Add labeled controls in Settings for every profile field; save through the owner command and retain the last persisted values on failure. Announce saving/saved/error through a live status region.
- [ ] Apply scale, intensity, clock, layout and widget visibility to paired Display output. CSS must still honor each browser's `prefers-reduced-motion: reduce` even if shared settings permit motion.
- [ ] Test state-to-markup behavior, keyboard-operable labels, failed-save state, and browser reduced-motion override.
- [ ] Run `npx vitest run tests/admin-view.test.ts tests/display-view.test.ts tests/display-preferences.test.ts`.

### Task 4: Add bounded, redacted diagnostics

**Files:** modify `server/server.ts`; create `server/diagnostics.ts` if separation keeps route logic readable; test `tests/admin-diagnostics.test.ts` and `tests/server-security.test.ts`.

- [ ] Add a bounded SQLite diagnostics table storing only timestamp, category, allowlisted code, and safe status. Record rejected authenticated commands and operational failures without bodies, prompts, transcripts, keys, session secrets, or raw exceptions; cap retained rows at 200.
- [ ] Add owner-only diagnostics endpoint returning readiness/configuration booleans, registered/revoked agent identities, paired-session expiry/revocation data, recent safe events, and explicit retention counts. Report agent capabilities/presence as unknown when the backend has no evidence.
- [ ] Test role/Origin authorization, redaction, max-row cleanup, empty/error states, and bounded output.
- [ ] Run `npx vitest run tests/admin-diagnostics.test.ts tests/server-security.test.ts`.

### Task 5: Build the Field Station Admin surfaces

**Files:** modify `src/admin/view.ts`, `src/main.ts`, `src/style.css`; test `tests/admin-view.test.ts`, `tests/admin-diagnostics.test.ts`.

- [ ] Add Agents, Displays, and Health/Diagnostics sections while retaining Overview, Widgets, Activity, Settings. Include owner-only revoke controls for registered agent credentials and paired displays; use only endpoint facts and show unknown/unavailable explicitly.
- [ ] Group rejected commands, safe errors, network/auth/config readiness, and actual retention behavior without displaying secrets or stack traces.
- [ ] Apply restrained Field Station tokens to Admin/Settings; preserve the existing full-screen Visual Display identity. Include loading, empty, error, and disconnected states.
- [ ] Test each page's role-independent rendering data, safe text escaping, and state coverage.
- [ ] Run `npx vitest run tests/admin-view.test.ts tests/admin-diagnostics.test.ts`.

### Task 6: Accessibility and bounded long-session verification

**Files:** modify UI/tests as needed; use `tests/` and browser audit tooling.

- [ ] Verify keyboard/focus, touch target sizing, headings/labels/live announcements, contrast, reduced motion and 390px/desktop layouts for Admin and Display.
- [ ] Add regression coverage that diagnostics remain bounded and widgets/preferences render after repeated updates; verify no diagnostic event contains voice content. Measure a representative long session in the browser using available heap/task metrics and record observed cleanup without promising unmeasured memory figures.
- [ ] Run focused UI tests, then `npm test`, `npm run build`, `git diff --check`; fix all failures before beginning M7 integration.
