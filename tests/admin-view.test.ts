import { describe, expect, it, vi } from 'vitest';
import { initialState } from '../src/demo-state';
import { bindAdminEvents, renderAdmin, updatePreferenceSaveUI, type AdminDiagnostics } from '../src/admin/view';

describe('Admin view', () => {
  it('renders the supported demo command examples', () => {
    const html = renderAdmin(initialState(), 'overview');
    expect(html).toContain('data-command="set tasks to 42"');
    expect(html).toContain('data-command="set progress to 85"');
    expect(html).toContain('data-command="complete task"');
  });
  it('opens the Visual Display in the current tab', () => {
    const html = renderAdmin(initialState(), 'overview');
    expect(html).toContain('href="/display"');
    expect(html).not.toContain('target="_blank"');
  });
  it('keeps simulation controls demo-only and renders pairing state safely', () => {
    const demo = renderAdmin(initialState(), 'overview', { demoMode: true });
    const live = renderAdmin(initialState(), 'overview', { demoMode: false });
    expect(demo).toContain('id="simulate"');
    expect(live).not.toContain('id="simulate"');
    expect(live).not.toContain('id="command-form"');
    expect(live).toContain('id="logout"');
    expect(demo).toContain('id="logout"');
    const settings = renderAdmin(initialState(), 'settings', { demoMode: false, pairing: { code: '<img src=x>', status: 'Code ready' } });
    expect(settings).toContain('id="create-pairing"');
    expect(settings).toContain('role="status"');
    expect(settings).toContain('&lt;img src=x&gt;');
    expect(settings).not.toContain('<output aria-label="One-time pairing code"><img');
  });
  it('renders an accessible display-style choice from backend state', () => {
    for (const style of ['quiet', 'ambient'] as const) {
      const state = { ...initialState(), displayStyle: style };
      const html = renderAdmin(state, 'settings', { demoMode: false });
      expect(html).toContain('<fieldset');
      expect(html).toContain('<legend>Display style</legend>');
      expect(html).toContain('name="display-style"');
      expect(html).toContain('> Quiet status</label>');
      expect(html).toContain('> Ambient activity</label>');
      expect(html).toMatch(new RegExp(`value="${style}" checked`));
      expect(html).not.toMatch(new RegExp(`value="${style === 'quiet' ? 'ambient' : 'quiet'}" checked`));
    }
  });

  it('renders labeled shared display controls and a save announcement', () => {
    const html = renderAdmin(initialState(), 'settings', { demoMode: false, preferenceStatus: 'Could not save preferences' });
    for (const field of ['scale', 'intensity', 'layout', 'reducedMotion', 'showClock', 'showWidgets']) expect(html).toContain(`name="${field}"`);
    expect(html).toContain('id="preferences-status" role="status" aria-live="polite"');
    for (const [id, name] of [['pref-scale', 'scale'], ['pref-intensity', 'intensity'], ['pref-layout', 'layout'], ['pref-reduced-motion', 'reducedMotion'], ['pref-show-clock', 'showClock'], ['pref-show-widgets', 'showWidgets']]) {
      expect(html).toContain(`for="${id}"`); expect(html).toContain(`id="${id}"`); expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('<form id="display-preferences">');
    expect(html).toContain('<button class="primary-btn" type="submit">Save preferences</button>');
    expect(html).toContain('<select id="pref-scale" name="scale">');
    expect(html).toContain('type="checkbox" name="reducedMotion"');
  });
  it('updates save feedback in place and restores persisted values after failure', () => {
    const controls = Object.fromEntries(['scale', 'intensity', 'layout', 'reducedMotion', 'showClock', 'showWidgets'].map(key => [key, { value: 'edited', checked: false }])) as Record<string, { value: string; checked: boolean }>;
    const button = { disabled: false };
    const form = { elements: { namedItem: (name: string) => controls[name] }, querySelector: () => button };
    const status = { textContent: '' };
    const focusedControl = controls.scale;
    const persisted = initialState();
    const priorState = structuredClone(persisted);
    const app = { querySelector: (selector: string) => selector === '#display-preferences' ? form : selector === '#preferences-status' ? status : null } as never;
    updatePreferenceSaveUI(app, 'Saving preferences…', true);
    expect(status.textContent).toBe('Saving preferences…'); expect(button.disabled).toBe(true);
    updatePreferenceSaveUI(app, 'Could not save preferences', false, persisted.displayPreferences);
    expect(status.textContent).toBe('Could not save preferences'); expect(button.disabled).toBe(false);
    expect(controls.scale.value).toBe('normal'); expect(controls.showWidgets.checked).toBe(true);
    expect(persisted).toEqual(priorState);
    expect(focusedControl).toBe(controls.scale);
  });
  it('renders operation loading, unavailable, empty, and populated states without secret identifiers', () => {
    const state = initialState();
    expect(renderAdmin(state, 'agents', { demoMode: false, diagnostics: { status: 'loading' } })).toContain('Loading operational data');
    expect(renderAdmin(state, 'health', { demoMode: false, diagnostics: { status: 'error', error: '<offline>' } })).toContain('&lt;offline&gt;');
    const data: AdminDiagnostics = { readiness: { loopbackBinding: true, storage: 'available', ownerConfigured: true, hermes: { configured: false, availability: 'not-verified' }, wyoming: { configured: false, availability: 'not-verified' } }, agents: [{ id: '<agent>', revoked: false, capabilities: 'unknown', presence: 'unknown' }], pairedSessions: [{ status: 'active', expires: 1000, revoked: false }], events: [{ timestamp: 1, category: '<command>', code: 'SAFE_CODE', status: 400 }], retention: { diagnostics: { retained: 1, limit: 200 }, activity: { retained: 2, limit: 200, behavior: 'prune-oldest-above-limit' } } };
    const agents = renderAdmin(state, 'agents', { demoMode: false, diagnostics: { status: 'loaded', data } });
    expect(agents).toContain('&lt;agent&gt;'); expect(agents).toContain('Presence: unknown'); expect(agents).toContain('Capabilities: unknown');
    expect(agents).toContain('data-revoke-agent="&lt;agent&gt;"');
    expect(renderAdmin(state, 'agents', { demoMode: false, diagnostics: { status: 'loaded', data: { ...data, agents: [{ ...data.agents[0], revoked: true }] } } })).not.toContain('data-revoke-agent=');
    const health = renderAdmin(state, 'health', { demoMode: false, diagnostics: { status: 'loaded', data } });
    expect(health).toContain('1 of 200'); expect(health).toContain('prune-oldest-above-limit'); expect(health).toContain('&lt;command&gt;');
    const displays = renderAdmin(state, 'displays', { demoMode: false, diagnostics: { status: 'loaded', data, displaySessionIds: ['secret-hash-not-for-dom'] } });
    expect(displays).toContain('data-revoke-display="0"'); expect(displays).not.toContain('secret-hash-not-for-dom');
    expect(renderAdmin(state, 'displays', { demoMode: false, disconnected: true, diagnostics: { status: 'loaded', data: { ...data, pairedSessions: [] } } })).toContain('Connection lost · reconnecting');
    expect(renderAdmin(state, 'displays', { demoMode: false, diagnostics: { status: 'loaded', data: { ...data, pairedSessions: [] } } })).toContain('No paired displays');
    expect(renderAdmin(state, 'agents', { demoMode: false, diagnostics: { status: 'loaded', data: { ...data, agents: [] } } })).toContain('No registered agents');
    const nav = renderAdmin(state, 'overview');
    for (const page of ['overview','widgets','activity','agents','displays','health','settings']) expect(nav).toContain(`data-page="${page}"`);
  });
  it('shows the persistent warning only when backend reports owner auto-access active', () => {
    expect(renderAdmin(initialState(), 'settings', { demoMode: false, ownerAutoAccess: true })).toContain('Same-device owner access is active');
    expect(renderAdmin(initialState(), 'settings', { demoMode: false, ownerAutoAccess: false })).not.toContain('Same-device owner access is active');
  });
  it('lists widget metadata, hidden and expired status, escaped fields and management controls', () => {
    const state = initialState();
    state.widgets = [{ ...state.widgets[0], id: '<hostile>', title: '<img src=x>', owner: '<owner>', placement: 'notification', visible: false, expiresAt: 1 }];
    const html = renderAdmin(state, 'widgets', { demoMode: false }, 2);
    expect(html).toContain('&lt;img src=x&gt;'); expect(html).toContain('&lt;owner&gt;');
    expect(html).not.toContain('<img src=x>'); expect(html).toContain('metric'); expect(html).toContain('notification');
    expect(html).toContain('Hidden'); expect(html).toContain('Expired'); expect(html).toContain('data-widget-action="show"'); expect(html).toContain('data-widget-action="remove"');
  });
  it('offers create/update sample controls for all five kinds', () => {
    const html = renderAdmin(initialState(), 'widgets', { demoMode: false });
    for (const kind of ['text', 'status', 'metric', 'progress', 'visual']) expect(html).toContain(`data-widget-sample="${kind}"`);
  });
  it('closes an open mobile sidebar when selecting a page', () => {
    let click: (() => void) | undefined, removed = '', selected = '';
    const nav = { dataset: { page: 'widgets' }, addEventListener: (_: string, handler: () => void) => { click = handler; } };
    const sidebar = { classList: { remove: (name: string) => { removed = name; } }, addEventListener() {} };
    const app = { querySelectorAll: (selector: string) => selector === '[data-page]' ? [nav] : [], querySelector: (selector: string) => selector === '#sidebar' ? sidebar : null } as unknown as HTMLElement;
    bindAdminEvents(app, { page: page => { selected = page; }, simulate() {}, toggle() {}, command() {}, addWidget() {}, reset() {} });
    click?.();
    expect(removed).toBe('mobile-open'); expect(selected).toBe('widgets');
  });
  it('moves focus to the newly rendered page heading after mobile navigation selection', () => {
    let click: (() => void) | undefined, open = true, focused = false, tabindex = '', currentHeading: { setAttribute: (_: string, value: string) => void; focus: () => void };
    const nav = { dataset: { page: 'widgets' }, addEventListener: (_: string, handler: () => void) => { click = handler; } };
    const oldHeading = { setAttribute() {}, focus: () => { throw new Error('must focus the replacement heading'); } };
    const heading = { setAttribute: (_: string, value: string) => { tabindex = value; }, focus: () => { focused = true; } };
    currentHeading = oldHeading;
    const sidebar = { classList: { contains: () => open, remove: () => { open = false; } }, addEventListener() {} };
    const toggle = { setAttribute() {}, addEventListener() {}, focus: () => { throw new Error('stale menu toggle should not receive focus'); } };
    const app = { querySelectorAll: (selector: string) => selector === '[data-page]' ? [nav] : [], querySelector: (selector: string) => selector === '#sidebar' ? sidebar : selector === '#menu-toggle' ? toggle : selector === '.content h1' ? currentHeading : null } as unknown as HTMLElement;
    bindAdminEvents(app, { page() { currentHeading = heading; }, simulate() {}, toggle() {}, command() {}, addWidget() {}, reset() {} });
    click?.();
    expect(open).toBe(false); expect(tabindex).toBe('-1'); expect(focused).toBe(true);
  });
  it('wires display revoke controls to an opaque internal index', () => {
    let click: (() => void) | undefined, revoked = -1;
    const button = { dataset: { revokeDisplay: '1' }, addEventListener: (_: string, handler: () => void) => { click = handler; } };
    const app = { querySelectorAll: (selector: string) => selector === '[data-revoke-display]' ? [button] : [], querySelector: () => null } as never;
    bindAdminEvents(app, { page() {}, simulate() {}, toggle() {}, command() {}, addWidget() {}, reset() {}, revokeDisplay: index => { revoked = index; } });
    click?.(); expect(revoked).toBe(1);
  });
  it('wires agent revoke using the listed agent ID', () => {
    let click: (() => void) | undefined, revoked = '';
    const button = { dataset: { revokeAgent: 'agent-safe-id' }, addEventListener: (_: string, handler: () => void) => { click = handler; } };
    const app = { querySelectorAll: (selector: string) => selector === '[data-revoke-agent]' ? [button] : [], querySelector: () => null } as never;
    bindAdminEvents(app, { page() {}, simulate() {}, toggle() {}, command() {}, addWidget() {}, reset() {}, revokeAgent: id => { revoked = id; } });
    click?.(); expect(revoked).toBe('agent-safe-id');
  });
  it('contains Tab focus in the open mobile navigation and closes on Escape with focus return', () => {
    const listeners: Record<string, (event: { key: string; shiftKey?: boolean; preventDefault: () => void }) => void> = {};
    let open = false, focusTarget = '', expanded = 'false', prevented = false, activeElement: { id: string } = { id: 'outside' };
    const focus = (target: string) => { const element = { id: target, focus: () => { focusTarget = target; activeElement = element; }, getClientRects: () => [1] }; return element; };
    const nav = focus('first-link'), last = focus('last-link');
    vi.stubGlobal('document', { get activeElement() { return activeElement; } });
    const menu = { classList: { contains: () => open, toggle: (_: string, value: boolean) => { open = value; }, remove: () => { open = false; } }, querySelector: () => nav, querySelectorAll: () => [nav, last], contains: (active: { id: string }) => ['first-link', 'last-link'].includes(active.id), addEventListener: (name: string, cb: (event: { key: string; shiftKey?: boolean; preventDefault: () => void }) => void) => { listeners[name] = cb; } };
    const toggle = { setAttribute: (_: string, value: string) => { expanded = value; }, focus: () => { focusTarget = 'menu-toggle'; }, addEventListener: (name: string, cb: () => void) => { listeners[`toggle-${name}`] = cb; } };
    const app = { querySelectorAll: () => [], querySelector: (selector: string) => selector === '#sidebar' ? menu : selector === '#menu-toggle' ? toggle : null } as never;
    bindAdminEvents(app, { page() {}, simulate() {}, toggle() {}, command() {}, addWidget() {}, reset() {} });
    listeners['toggle-click'](); expect(open).toBe(true); expect(expanded).toBe('true'); expect(focusTarget).toBe('first-link');
    activeElement = last;
    listeners.keydown({ key: 'Tab', preventDefault: () => { prevented = true; } }); expect(prevented).toBe(true); expect(focusTarget).toBe('first-link');
    prevented = false; listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; } }); expect(prevented).toBe(true); expect(focusTarget).toBe('last-link');
    listeners.keydown({ key: 'Escape', preventDefault() {} }); expect(open).toBe(false); expect(expanded).toBe('false'); expect(focusTarget).toBe('menu-toggle');
    vi.unstubAllGlobals();
  });
  it('returns focus to the menu toggle when the mobile backdrop is dismissed', () => {
    let backdropClick: (() => void) | undefined, open = true, focusTarget = '';
    const menu = { classList: { contains: () => open, remove: () => { open = false; } }, addEventListener() {} };
    const toggle = { setAttribute() {}, focus: () => { focusTarget = 'menu-toggle'; }, addEventListener() {} };
    const backdrop = { addEventListener: (_: string, handler: () => void) => { backdropClick = handler; } };
    const app = { querySelectorAll: () => [], querySelector: (selector: string) => selector === '#sidebar' ? menu : selector === '#menu-toggle' ? toggle : selector === '#sidebar-backdrop' ? backdrop : null } as never;
    bindAdminEvents(app, { page() {}, simulate() {}, toggle() {}, command() {}, addWidget() {}, reset() {} });
    backdropClick?.(); expect(open).toBe(false); expect(focusTarget).toBe('menu-toggle');
  });
});
