# Kiosk Browser Crash Diagnosis Plan

> **For agentic workers:** Use this plan only for the evidence-gathering task; do not add speculative Chromium flags or a browser supervisor.

**Goal:** Determine whether the reported Chromium zygote failure has an actionable, evidence-based recovery fix.

**Architecture:** The app supervises its backend, not the separately launched kiosk browser. Diagnose the desktop-session launcher and browser using target-machine evidence; keep app behavior unchanged unless that evidence proves the app owns the failing lifecycle.

**Tech Stack:** Deployment documentation, systemd/journal or platform-equivalent logs, target Chromium/Chrome/Edge runtime.

---

## Task 1: Request and assess target-machine evidence

**Files:** `docs/deployment/README.md`, `docs/deployment/linux.md`, `docs/deployment/macos.md`, `docs/deployment/windows.md`

- [ ] Review the current documentation describing backend-only supervision and separately launched browsers.
- [ ] Ask for the exact kiosk OS/session, browser name/version, launch command/flags, exit status, browser stderr or journal output, and restart behavior.
- [ ] If those details are unavailable, record the limitation and leave runtime code untouched.
- [ ] If a repeatable app-owned defect is shown, write a separate focused proposal and tests before changing the deployment/runtime behavior.

## Task 2: Validate any evidence-based fix

- [ ] Reproduce on the target kiosk; verify browser relaunch and visible recovery after the failure.
- [ ] Confirm the display reconnects and current state is restored without duplicate or lost state.
- [ ] Do not claim the crash is fixed based only on build/unit tests; leave this track open if the target environment cannot be tested.
