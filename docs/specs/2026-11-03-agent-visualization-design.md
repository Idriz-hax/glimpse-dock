# Agent visualization design

## Goal and scope

Implement Glimpse Dock roadmap Milestone 3: make the Visual Display represent explicit backend-owned agent activity states instead of deriving activity from a running flag and progress percentage. The Display style is configurable in Admin → Settings between the user's selected treatments: **Quiet status** and **Ambient activity**. The visual companion server has been stopped.

Hermes integration, a general widget system, and the broader display preferences planned for Milestone 6 remain out of scope. The demo adapter remains the only event source for now; demo activity must remain clearly labeled as simulated.

## State and data flow

Extend protocol v1 state with a bounded activity state: idle, thinking, tool-use, responding, waiting, completed, or error. Add validated commands for setting activity and clearing/setting measurable progress as needed; progress remains optional in presentation, and no percentage is invented when absent. The backend remains authoritative: it validates, persists and broadcasts accepted changes; clients render only validated snapshots/updates. Demo transitions exercise these states. Completion and errors are terminal-looking truthful states, not inferred from progress alone.

Persist the selected display style in backend-owned state so the Admin choice applies to separately paired Display sessions and survives reload/restart. Only the owner may change it; display sessions remain read-only. Preserve existing authentication, CSRF, Origin, validation, persistence-failure and broadcast boundaries. Existing persisted state must receive safe defaults when fields are absent.

## Display behavior

Render state-specific labels and task context for idle, thinking, tool-use, responding, waiting, completed, and error. When no activity data is present show an unmistakable idle state; when the connection is lost show disconnected/stale status rather than presenting old activity as live. Show a numeric progress indicator only when supplied and validated; otherwise use indeterminate/no progress presentation.

Quiet status keeps the current restrained hierarchy and avoids ambient activity motion. Ambient activity uses the current subdued ambient visual language and state-aware motion. `prefers-reduced-motion` disables nonessential animation in both styles. State text, status badges, and failure cues remain understandable without relying on color or motion.

Admin Settings exposes an accessible two-choice control for Quiet status and Ambient activity, reflects the current persisted choice, and reports save failures without falsely updating the selected persisted value.

## Validation

Add focused protocol, backend, adapter and view tests for every activity state, invalid values, migration/default behavior, persistence and restart, owner-only preference changes, cross-session update propagation, and progress omitted versus supplied. Verify reduced-motion CSS and accessible setting semantics. Run the complete test suite and production build after changes; perform responsive display review at 1920×1080 and a smaller viewport and keyboard/screen-reader smoke checks.
