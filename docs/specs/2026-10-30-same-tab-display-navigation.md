# Same-tab Visual Display navigation

## Goal

Make the Admin's **Open visual display** link navigate the current browser tab to `/display`, rather than opening a second tab. Make `/` open the Visual Display by default while retaining `/admin` as the explicit Admin entry.

## Scope and behavior

- Keep the existing `/display` URL and link presentation.
- Remove the link's explicit new-tab behavior and the `rel="noopener"` attribute that only accompanies it.
- Use ordinary same-tab anchor navigation; do not add client-side routing, alter Admin navigation, or change Display pairing/authentication.
- Resolve `/` to the Display view; `/display` remains Display and `/admin` remains Admin. Update route-focused tests and any route documentation that states `/` is an Admin alias.

## Verification

Inspect the rendered Display link to ensure it has `href="/display"` and no `target="_blank"`; verify `/`, `/display`, and `/admin` resolve to the intended views; run focused route/view tests and the normal project test/build checks.

## Assumptions

The user explicitly wants the current tab to change views, analogous to selecting Admin navigation. Opening a second tab is not needed, even when using a paired Display session. The user has now superseded the earlier `/`-is-Admin-alias requirement: root should open Display, with `/admin` retained for Admin.
