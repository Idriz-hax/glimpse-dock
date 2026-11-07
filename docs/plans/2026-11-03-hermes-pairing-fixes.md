# Hermes Pairing and Tool-Result Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return a Hermes-compatible string from the widget tool and make display pairing failures clear and usable.

**Architecture:** Keep `handle_widget` and the backend ownership boundary unchanged; serialize only the plugin tool handler's return values. Keep pairing authorization and rate limiting in the existing server route, with structured error codes/messages consumed by the existing auth UI.

**Tech Stack:** Python standard library `json`/`unittest`; TypeScript, Fastify, Vitest; Markdown documentation.

---

## File map

- `integrations/hermes/glimpse_dock/__init__.py`: serialize success and error results at the Hermes tool boundary.
- `integrations/hermes/tests/test_plugin.py`: parse the handler's JSON string in success/configuration/error fixtures.
- `server/server.ts`: 5-minute pairing TTL, distinct invalid/expired pairing errors, and a stable rate-limit message.
- `src/shared/protocol.ts`: admit the two new structured pairing error codes while retaining the existing `RATE_LIMITED` code.
- `tests/server-security.test.ts`: pairing expiry, invalid/expired codes, rate limiting, and existing one-time redemption behavior.
- `tests/auth-view.test.ts`: retain escaped accessible error presentation; add a regression assertion only if current coverage is missing.
- `docs/integrations/hermes.md`: document string result contract and 5-minute pairing window.

### Task 1: Return string results from the Hermes tool

- [ ] In `integrations/hermes/tests/test_plugin.py`, change both handler-result assertions to `json.loads(handler(...))`; add a client-failure fixture asserting decoded `COMMAND_FAILED`.
- [ ] Run `python3 -B -m unittest discover -s integrations/hermes/tests -p test_plugin.py -v`; confirm it fails because the handler returns a dict.
- [ ] In `integrations/hermes/glimpse_dock/__init__.py`, import `json` and wrap each `widget_handler` return with `json.dumps(result, default=str)`. Keep `handle_widget`'s internal dict contract unchanged.
- [ ] Run `python3 -B -m unittest discover -s integrations/hermes/tests -v`; expect all Hermes fixture tests to pass.
- [ ] Add a short line to `docs/integrations/hermes.md` explaining that `glimpse_widget` returns a JSON-encoded string; commit only the Python tests/source and guide.

### Task 2: Improve pairing lifetime and errors

- [ ] In `tests/server-security.test.ts`, cover a valid redemption just before five minutes, expired redemption after five minutes, unknown code, reused code, and the sixth request's rate-limit body. Use Vitest fake time and restore real timers after each test.
- [ ] Run `npm test -- --run tests/server-security.test.ts`; confirm new expiry/error assertions fail against the current 60-second/generic-Forbidden route.
- [ ] In `src/shared/protocol.ts`, add `PAIRING_INVALID` and `PAIRING_EXPIRED` to `ErrorResponseSchema.code`; retain `RATE_LIMITED` for 429.
- [ ] In `server/server.ts`, set expiry to `Date.now() + 5 * 60_000`. Return structured 403 errors with distinct `PAIRING_INVALID` and `PAIRING_EXPIRED` codes/messages, and configure the route's 429 response to return a structured, user-safe message.
- [ ] Confirm `src/main.ts`'s `request()` still surfaces `error.message` and `src/auth/view.ts` escapes it with `role="alert"`; add an `auth-view.test.ts` assertion only if current coverage is missing.
- [ ] Run `npm test -- --run tests/server-security.test.ts tests/auth-view.test.ts` and expect all tests to pass.
- [ ] Update `docs/integrations/hermes.md` with the five-minute expiry and wrong/expired/rate-limited recovery messages; commit the focused server, test, and guide changes.

## Final check

- [ ] Run `python3 -B -m unittest discover -s integrations/hermes/tests -v`, `npm test`, `npm run build`, and `git diff --check`; report exact results. Preserve pre-existing untracked files.
