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
});
