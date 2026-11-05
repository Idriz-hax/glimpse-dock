# App-wide Theme, Dashboard Polish, and Trusted-LAN Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved spec at `docs/specs/2026-11-06-app-wide-theme-lan-admin-and-dashboard-polish-design.md` without weakening local-only defaults, auth boundaries, or run fencing.

**Architecture:** The approved spec contains two independently testable subsystems, so execution is split into a UI/activity plan and an owner/LAN security plan. Keep the current Fastify/SQLite authority and Zod protocol; no dependencies are needed. Complete both subplans before the cross-cutting acceptance gates below.

**Tech Stack:** TypeScript, Fastify, SQLite (`better-sqlite3`), Zod, CSS, Vitest, Vite.

---

## Implementation plans

1. [`2026-11-06-app-wide-theme-dashboard.md`](2026-11-06-app-wide-theme-dashboard.md) — central palette, tester UI fixes, activity timestamp lifecycle, focused UI/protocol tests.
2. [`2026-11-06-trusted-lan-admin.md`](2026-11-06-trusted-lan-admin.md) — owner username migration, HTTP/HTTPS listener config, access boundaries, security tests and operator docs.

## Final acceptance

- [ ] After both subplans reconcile, run `npm test`, then `npm run build`; fix failures before declaring completion.
- [ ] Use browser review at 1920×1080 and narrow width; check keyboard/focus, screen-reader status semantics, reduced motion, contrast, and no color-only state cues.
- [ ] On a trusted LAN, exercise HTTP only after warning/confirmation and HTTPS with browser-trusted certificate. Verify peers outside the configured CIDR are rejected by both application and firewall, no HTTPS downgrade occurs, and remote pairing/Display/voice are denied.
- [ ] Dispatch a security review of the completed listener, account migration, request-origin checks, cookies, and route boundaries; resolve material findings before shipping.
- [ ] Run live Hermes and Wyoming voice validation on the user installation; record as external acceptance, not automated test coverage.
