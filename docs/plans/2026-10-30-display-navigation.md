# Display Navigation Implementation Plan

> **For agentic workers:** Use inline execution for this small, coupled change; follow the steps in order and verify each focused behavior.

**Goal:** Open Visual Display from Admin in the same tab and make `/` the default Display route while keeping `/admin` as Admin.

**Architecture:** Keep ordinary anchor navigation and the existing `resolveRoute` function. Change only the Display link attributes and route resolution, update route expectations and route docs; do not alter auth, pairing, or view state.

**Tech Stack:** TypeScript, Vitest, Vite.

---

## Files and responsibilities

- `src/admin/view.ts` — emits the Admin-to-Display link.
- `src/routes.ts` — maps browser pathnames to Admin or Display.
- `tests/admin-view.test.ts` — verifies the link markup.
- `tests/routes.test.ts` — verifies `/`, `/admin`, and `/display` route choices.
- `README.md`, `PROJECT.md`, `docs/architecture/0001-local-backend-authority.md`, `docs/plans/2026-10-29-glimpse-dock-roadmap.md` — document the route behavior and supersede the earlier root-route decision.

### Task 1: Change Display link to same-tab navigation

**Files:** `tests/admin-view.test.ts`, `src/admin/view.ts`

- [x] Add a focused assertion that rendered Admin markup contains the Display link with `href="/display"` and does not contain `target="_blank"`.
- [x] Run `npx vitest run tests/admin-view.test.ts`; confirm the new assertion fails against the current link.
- [x] Remove `target="_blank"` and its paired `rel="noopener"` from the anchor; keep the href and visible label unchanged.
- [x] Rerun `npx vitest run tests/admin-view.test.ts`; expect all Admin view tests to pass.

### Task 2: Make root open Display, preserve explicit Admin route

**Files:** `tests/routes.test.ts`, `src/routes.ts`, `README.md`, `PROJECT.md`

- [x] Change the route table expectations so `/` resolves to `display`, `/display` resolves to `display`, and `/admin` resolves to `admin`; retain trailing-slash cases.
- [x] Run `npx vitest run tests/routes.test.ts`; confirm the root case fails before implementation.
- [x] Update `resolveRoute` so only `/admin` resolves to Admin and `/` or `/display` resolves to Display.
- [x] Update README, PROJECT, architecture, and roadmap route descriptions to the current decision.
- [x] Rerun `npx vitest run tests/routes.test.ts`; expect all route cases to pass.

### Task 3: Verify final behavior

- [x] Run `npm test`; expect all test files to pass.
- [x] Run `npm run build`; expect TypeScript checks and Vite production build to pass.
- [x] Run `git diff --check`; expect no whitespace errors.
- [x] Confirm only the intended files changed; leave inherited unrelated worktree changes unstaged.
