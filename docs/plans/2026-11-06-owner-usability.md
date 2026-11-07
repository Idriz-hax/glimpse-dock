# Owner Usability Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make owner/admin controls and the live display understandable and readable to first-time owners, especially on low-DPI screens.

**Architecture:** Keep the current server/state contracts and visual identity. Adjust owner-facing copy and markup in the existing renderers, derive explanatory details only from existing state/diagnostics, then tune the shared CSS cascade and cover it with focused view tests. Do not create new diagnostic, retry, or progress capabilities.

**Tech Stack:** TypeScript, Vite, CSS, Vitest.

---

## File map

- `src/admin/view.ts` — owner overview, workspace status/header, diagnostics presentation, and empty-state content.
- `src/display/view.ts` — live phase, observed task/action context, elapsed time, slots, and footer copy.
- `src/display/widgets.ts` — actual slot-empty rendering if separate from display view.
- `src/style.css` — global owner/admin supporting text sizes and responsive overrides.
- `src/display.css` — display-specific sizing/low-DPI constraints and overrides.
- `tests/admin-view.test.ts`, `tests/admin-diagnostics.test.ts` — owner status, diagnostics, and empty-state rendering.
- `tests/display-view.test.ts` — plain-language display context, observed action/elapsed rendering, and kiosk footer.

## Task 1: Add owner/admin copy and state tests

**Files:** `tests/admin-view.test.ts`, `tests/admin-diagnostics.test.ts`

- [ ] Add failing tests for a single workspace health indicator, non-placeholder Overview header, actionable known/unknown control-unavailable states, and useful empty recent-event/widget guidance.
- [ ] Run `npx vitest run tests/admin-view.test.ts tests/admin-diagnostics.test.ts --exclude '**/.worktrees/**'` and confirm the new assertions fail against current markup.
- [ ] Keep the output limited to status/errors actually present in diagnostics. Do not add a retry button unless a real retry handler exists.
- [ ] Re-run the focused tests and confirm they pass.

## Task 2: Add display wording/action tests

**Files:** `tests/display-view.test.ts`, `src/display/view.ts`, `src/display/widgets.ts`

- [ ] Add failing tests for replacing unexplained turn/slot wording with one concise plain-language explanation, removing the kiosk F11 hint, and showing elapsed time plus the latest observed action when available.
- [ ] When no observed action is available, assert an honest waiting-for-update message; do not estimate percent completion.
- [ ] Run `npx vitest run tests/display-view.test.ts --exclude '**/.worktrees/**'` and confirm failure before implementation.
- [ ] Implement the minimal rendering changes and rerun the focused test.

## Task 3: Raise owner/admin supporting text sizes

**Files:** `src/style.css`, `src/display.css`, `tests/admin-view.test.ts`, `tests/display-view.test.ts`

- [ ] Add focused assertions or a browser-level check to ensure owner/admin secondary labels and slot-empty copy are readable at default scaling, and that the prior 14px display overrides remain effective.
- [ ] Raise the smallest owner-view labels/helper text (currently including 8–13px rules) to a consistent readable floor, preserving hierarchy, contrast, focus rings, and narrow/short viewport behavior.
- [ ] Check final cascade order so mobile/short-height rules do not reduce supporting copy below that floor.
- [ ] Run focused tests and build; inspect at 1280×720 and 390×844 viewports and correct clipping/overflow.

## Task 4: Full UI verification and review

- [ ] Run `npm run build` and `npm test -- --exclude '**/.worktrees/**'` (if the script does not forward the exclusion, use the equivalent Vitest command with the repository worktree directories excluded).
- [ ] Verify no unintended text changes, accessible focus visibility, and responsive display/admin layout. Summarize any remaining physical-projector limitations for owner review.
- [ ] Leave all changes unpushed until the user approves the rendered result.
