# Same-tab Visual Display navigation

## Goal

Make the Admin's **Open visual display** link navigate the current browser tab to `/display`, rather than opening a second tab.

## Scope and behavior

- Keep the existing `/display` URL and link presentation.
- Remove the link's explicit new-tab behavior and the `rel="noopener"` attribute that only accompanies it.
- Use ordinary same-tab anchor navigation; do not add client-side routing, alter Admin navigation, or change Display pairing/authentication.

## Verification

Inspect the rendered Display link to ensure it has `href="/display"` and no `target="_blank"`; run the focused Admin view test and the normal project test/build checks.

## Assumptions

The user explicitly wants the current tab to change views, analogous to selecting Admin navigation. Opening a second tab is not needed, even when using a paired Display session.
