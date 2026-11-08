# Display Readability and Motion Implementation Plan

> **For agentic workers:** Implement the approved display design task-by-task, using focused tests and review.

**Goal:** Make kiosk display copy easier to read, reduce redundant center text, and add activity-linked motion without inventing state or ignoring reduced-motion preferences.

**Architecture:** Keep state selection in `renderDisplay`; render one live-update row from verified elapsed/action data. Apply typography and state-based motion in the existing display stylesheet; CSS must remain static for inactive/reduced-motion displays.

**Tech Stack:** TypeScript, existing Vitest tests, CSS animations.

---

## File Map

- Modify `src/display/view.ts`: remove duplicate phase/explanatory/task prose; combine actual elapsed time and last observed action into one accessible live-update row; retain connection state and actual progress bar.
- Modify `src/display.css`: enlarge supporting/slot text, style the compact update row, and enable subtle transform/opacity motion only during thinking/tool-use/responding unless reduced motion is requested.
- Modify `tests/display-view.test.ts`: assert concise output, active-only verified update content, no duplicate center explanation, and larger supporting-text hooks where markup provides them.

## Task 1: Lock down concise, truthful display output

- [ ] Update display-view assertions: active state includes one main activity heading and one live-update row; no duplicate kicker, static turn/slot explainer, or `Current status:` prose.
- [ ] Assert elapsed time appears only with a valid active-turn timestamp; valid same-turn observed action appears in that same row; missing/stale action uses the honest waiting text.
- [ ] Run `npx vitest run tests/display-view.test.ts` and verify new expectations fail before implementation.

## Task 2: Implement the compact display view

- [ ] Build the live-update row from the existing `turnStartedAt`, `turnId`, and `latestAction` values only; escape observed text as before. Keep actual progress represented by the accessible progress bar, without a redundant visible percent caption.
- [ ] Remove the duplicate phase kicker, fixed turn/slot definition, and separate task-description paragraph from the center. Keep the header connection pill, primary activity heading, and widget-slot content.
- [ ] Run the focused display-view tests and `npx tsc --noEmit`.

## Task 3: Improve readability and activity-linked motion

- [ ] Raise small slot, empty-state, footer, progress, and metadata labels to a readable 16–18px scale while retaining responsive sizing.
- [ ] Keep the orb/halos still for idle, waiting, completed, and error states; enable subtle existing/updated transform-and-opacity motion for thinking, tool-use, and responding states, including the quiet visual preset.
- [ ] Disable motion for both the `display-reduced-motion` preference class and `prefers-reduced-motion: reduce`.
- [ ] Run `npx vitest run tests/display-view.test.ts tests/display-widgets.test.ts`, `npm run build`, and `git diff --check`; inspect 1440×900, 768×1024, and 390×844 screenshots for overflow, hierarchy, and legibility.

## Kiosk guard status

The user supplied an evidence-based output-precondition fix for `/home/hax/.hermes/cache/kiosk-crash-evidence/kiosk_guard.py`. That Linux-host path is absent from this macOS workspace, so the guard cannot be safely modified or tested until the user shares/mounts the current file. Do not create a parallel speculative guard in this application repository.
