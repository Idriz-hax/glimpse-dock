import { describe, expect, it } from 'vitest';
import { initialState } from '../src/demo-state';
import { renderAdmin } from '../src/admin/view';

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
});
