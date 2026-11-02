# Agent Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement explicit backend-driven agent activity states and a persistent Admin-selected Quiet/Ambient Display style.

**Architecture:** Extend protocol v1 state and validated owner commands; normalize legacy persisted records with safe defaults. Backend-owned state keeps the owner setting and paired Display sessions consistent through SQLite snapshots and WebSocket updates. Display renders the state truthfully, including idle/disconnected and progress only when known; Demo exercises states but remains labeled simulated.

**Tech Stack:** TypeScript, Zod, Fastify, SQLite, Vitest, HTML/CSS.

---

## File map

- `src/shared/protocol.ts`: activity/style schemas and validated commands.
- `src/demo-state.ts`, `server/adapters/demo.ts`: local domain defaults and simulated activity transitions.
- `server/server.ts`: state initialization/migration defaults and owner-only style mutation through existing command boundary.
- `src/admin/view.ts`, `src/main.ts`: accessible Admin style selector and event handler.
- `src/display/view.ts`, `src/display.css`: state-driven Display and Quiet/Ambient visual behavior.
- `tests/protocol.test.ts`, `tests/demo-adapter.test.ts`, `tests/server.test.ts`, `tests/backend-persistence.test.ts`, `tests/admin-view.test.ts`, `tests/display-view.test.ts`: focused contract, authorization, persistence, and rendering coverage.
- `PROJECT.md`: update milestone status only after verification.

### Task 1: Protocol and state defaults

- [ ] Add strict enums for activity states (`idle`, `thinking`, `tool-use`, `responding`, `waiting`, `completed`, `error`) and display style (`quiet`, `ambient`) in `src/shared/protocol.ts`; add defaulted values to `ProtocolStateSchema`, preserving current fixtures and old database records.
- [ ] Add a validated `state.set-activity` command for setting one bounded activity state, and allow `state.set-progress` to accept `null` to clear unknown progress; protocol state progress defaults to `null` and numeric progress remains bounded. Keep existing numeric command shape valid. Add the validated `display.set-style` owner command; ensure backend command authorization rejects agents and display sessions for this command.
- [ ] Add protocol tests for valid/invalid enum values, commands, defaults, and omitted progress. Run `npm test -- --run tests/protocol.test.ts`.

### Task 2: Backend persistence, permissions, and demo states

- [ ] Extend `src/demo-state.ts` and `server/adapters/demo.ts` so demo actions set meaningful activity state, with pause/reset/completion transitions consistent with state fields.
- [ ] In `server/server.ts`, normalize state loaded from SQLite through the extended schema, apply the style command only for owner, and commit/broadcast it with the existing persistence transaction.
- [ ] Add tests proving old saved state gets defaults, style survives restart and broadcasts, non-owner principals cannot change it, and demo transitions cover activity values. Run the focused persistence/server/adapter tests.

### Task 3: Admin preference UI

- [ ] Add an accessible labeled two-option selector in Admin Settings, reflecting `state.displayStyle`; wire changes to `display.set-style` through the existing `send` flow in `src/main.ts`.
- [ ] Add Admin view tests for selected state and semantic labels. Ensure failures retain backend-confirmed selection and use existing toast feedback. Run `npm test -- --run tests/admin-view.test.ts`.

### Task 4: Truthful Display and motion

- [ ] Update `src/display/view.ts` to map every protocol activity state to explicit status/title/task presentation; avoid deriving completion from 100% progress, and render progress only when reported. Show idle clearly.
- [ ] Update `src/display.css` for the selected Quiet/Ambient treatment; ambient motion is nonessential and disabled by `prefers-reduced-motion`. Preserve readable status without color/motion alone.
- [ ] Track WebSocket connectivity in `src/main.ts` and show a disconnected/stale indicator on Display when the stream closes; clear it after a valid snapshot/update.
- [ ] Add view tests for all states, both styles, absent/present progress, and disconnected presentation; run focused Display tests. Manually review at 1920×1080 and a narrow viewport, keyboard and screen-reader semantics.

### Task 5: Documentation and final verification

- [ ] Update `PROJECT.md` to mark Milestone 3 complete only for verified scope and retain explicit note that Hermes is not integrated.
- [ ] Run `npm test` and `npm run build`; fix failures within this scope. Confirm `git status` preserves the existing untracked SQLite database and visual-companion artifacts (do not stage them).

## Self-review

- Every design requirement maps to a task: state model and backend authority (1–2), cross-session persistent style and owner-only changes (2), Admin control (3), state/progress/connection/motion presentation (4), tests and current project status (5).
- The state default covers legacy SQLite records without a schema-breaking migration; the command is explicitly owner-only despite sharing the existing command route.
- Keep implementation limited to Milestone 3; no Hermes integration, generalized widget framework, or broader Milestone 6 settings.
