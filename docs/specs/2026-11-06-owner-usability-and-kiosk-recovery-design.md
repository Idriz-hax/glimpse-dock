# Owner usability and kiosk recovery design

## Goal

Make Glimpse Dock understandable and readable for a first-time owner on a low-DPI display, while preserving the existing dark, kiosk-friendly visual identity and truthful live-agent status. Investigate the separately reported kiosk browser crash without pretending it is an app-owned failure.

## Scope

### Owner/admin interface

- Replace the generic control-availability failure with a named control state, the actual known cause (when diagnostics provide one), and a specific safe next step. Never invent a cause or promise a retry action that does not exist.
- Use a single canonical workspace status; remove redundant, ambiguous status indicators.
- Replace the duplicated “YOUR WORKSPACE — WORKSPACE” heading with a page title and meaningful context.
- Raise small supporting text sizes and contrast across the owner/admin view, including empty-state text, without weakening responsive layouts or focus visibility.
- Give relevant empty states a concise next step. The recent-events state should explain that activity appears when the connected agent starts working; empty widgets should link to adding a widget.

### Agent display

- Keep the existing live turn status and elapsed time. Add concise, plain-language context for unfamiliar turn/agent/slot language.
- Show an elapsed duration and last observed action for active turns only when the action is genuinely available; otherwise say that the display is waiting for the next agent update. Do not invent percentages or estimated completion.
- Remove the F11 fullscreen instruction from the kiosk display.
- Preserve the previous low-DPI text-size improvements and honor responsive and reduced-motion behavior.

### Kiosk reliability

- Investigate the reported Chromium zygote failure against the current deployment architecture.
- The browser is launched separately in the interactive desktop session; the app currently owns no browser process, flags, restart policy, or browser logs. Do not add speculative browser flags or app-level restart machinery.
- Document that diagnosis/recovery needs target-machine evidence (browser command and version, desktop/session, exit status, stderr/journal output, and launcher restart behavior). Only implement a code/config change if new evidence establishes an app-owned, safe fix.

## Design direction

Retain the current restrained dark interface and clear display hierarchy. Use one clear workspace health signal, keep supporting detail visually secondary, and use direct owner-facing language. Prefer observed facts and actionable recovery over generic reassurance or hidden diagnostics.

## State and failure coverage

- Control status must distinguish loading, available, unavailable with a known cause, and unavailable with an unknown cause. Every unavailable state explains the next safe action; unknown causes must say they are unknown.
- Empty recent activity and empty widget states each include a contextual next step.
- Active turns show elapsed time and the most recent observed action when available; missing action data gets an honest waiting message.
- Responsive owner/admin and display layouts must remain readable without clipping after text-size changes; preserve keyboard focus and reduced-motion behavior.
- Kiosk crash recovery remains explicitly unverified until checked on the target machine; no UI change is presented as a browser-crash fix.

## Verification

- Focused admin/display tests for copy, status-state rendering, empty states, and live-turn fields.
- Build and the project test suite, excluding nested worktrees from collection.
- Inspect affected views at desktop and low-resolution/mobile-sized viewports, plus owner/admin text at 100% scaling.
- For kiosk reliability, verify only on the actual target kiosk machine once browser command, version, session, and crash logs are supplied.

## Out of scope

- Redesigning the successful display visual style.
- Adding unsupported agent-progress estimates, retry controls, Chromium flags, or a new browser supervisor without evidence.
- Treating backend systemd restart policy as browser recovery.
