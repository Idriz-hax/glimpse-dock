# App-wide Theme and Dashboard Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply one semantic palette across Admin, Display, sign-in/setup, voice and widgets, and implement the approved Hermes tester fixes.

**Architecture:** Reuse `src/style.css` as the canonical token source and keep existing page-specific surfaces. Keep activity time authoritative in the backend protocol/state; render only known, validated activity and allowlisted tool categories.

**Tech Stack:** TypeScript, Zod, CSS, Vitest, DOM/SVG.

---

## Files

- Modify: `src/style.css`, `src/display.css`, `src/auth/auth.css`, `src/display/widgets.ts`, `src/shared/icons.ts`.
- Modify: `src/shared/protocol.ts`, `server/server.ts`, `src/admin/view.ts`, `src/display/view.ts`, `integrations/hermes/glimpse_dock/adapter.py`.
- Tests: `tests/protocol.test.ts`, `tests/server.test.ts`, `tests/admin-view.test.ts`, `tests/display-view.test.ts`, `integrations/hermes/tests/test_adapter.py`.

## Task 1: Timestamp protocol and lifecycle

- [ ] **Write regression tests first.** In `tests/protocol.test.ts`, parse a legacy state without `turnStartedAt` and assert `null`; parse an explicit epoch timestamp and explicit `null`; reject negative, fractional, or unsafe timestamps. In `tests/server.test.ts`, assert an active turn sets the injected clock time, transitions among thinking/tool-use/responding/waiting retain it, and idle/completed/error clear it.
- [ ] Run `npx vitest run tests/protocol.test.ts tests/server.test.ts`; confirm the new assertions fail because the property/lifecycle is missing.
- [ ] Add `turnStartedAt: z.number().int().safe().nonnegative().nullable().default(null)` to `ProtocolStateSchema`. Update the server's state transition handling to use `now()` only when a turn becomes active, retain during an active turn including waiting, clear on idle/completed/error, and let `ProtocolStateSchema` default old persisted rows.
- [ ] Run the focused tests and confirm pass; preserve run-fencing and terminal-event behavior.

## Task 2: Correct Admin and Display states

- [ ] Add tests in `tests/admin-view.test.ts` and `tests/display-view.test.ts`: null progress emits neither `null%` nor a bar; numeric progress has matching width/value; activity labels map thinking/tool-use/responding to Active and waiting/idle/completed/error/disconnected distinctly; empty logs and empty slots have visible explanatory copy; the stale version string is absent; elapsed time appears only for active work with a timestamp and is absent while waiting/unknown. Assert only shell/code/search tool categories are accepted and arbitrary category strings fail protocol validation.
- [ ] Run `npx vitest run tests/admin-view.test.ts tests/display-view.test.ts`; confirm new cases fail.
- [ ] Add an optional allowlisted tool category (`shell`, `code`, `search`) to the validated task/activity protocol, default absent for old state, and update `integrations/hermes/glimpse_dock/adapter.py` to map recognized tool names to those categories. Update `integrations/hermes/tests/test_adapter.py` for recognized and unknown tools. Unknown types omit the category; preserve run-fencing.
- [ ] Update `src/shared/icons.ts` with code-brackets and magnifier icons; use its existing settings/gear icon for shell and box fallback for unknown tools. Update `src/admin/view.ts` to conditionally render the progress bar/value, derive labels from activity, render “No recent events yet”, explain unavailable controls from actual readiness (unknown reason points to Health/diagnostics), and remove the hard-coded version. Update `src/display/view.ts` to put the slot empty state in its section and show active elapsed time from the supplied timestamp; do not expose raw tool data.
- [ ] Run focused view tests; inspect emitted markup for accessible status text, progressbar attributes and icon labels.

## Task 3: Palette centralization

- [ ] Audit hex/RGB/HSL color literals across all of `src/`. Define semantic surface, text, border, brand, focus, state, and overlay tokens in `src/style.css`.
- [ ] Replace component-specific palette literals in Admin, Display, auth, voice, and widget SVG mapping with tokens. Preserve distinct backgrounds/surfaces and semantic success/warning/error/offline cues; remove Admin-only lime/green brand accents. Do not change layout or add a theme switcher.
- [ ] Run `npx vitest run tests/admin-view.test.ts tests/display-view.test.ts`; search all of `src/` for remaining literal colors and confirm only central token declarations remain.
- [ ] Review contrast and visible keyboard focus for Admin, Display, auth, voice, widget and status surfaces; check desktop and narrow viewport, reduced motion, and non-color cues.

## Completion

- [ ] Commit this lane after focused tests pass. Parent plan owns full suite/build, integrated LAN acceptance, and live Hermes/Wyoming checks.
