import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../src/demo-state';
import { renderDisplay } from '../src/display/view';
import { renderWidget } from '../src/display/widgets';
import { WidgetSchema } from '../src/shared/protocol';

class TestElement {
  children: TestElement[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  textContent = '';
  attributes: Record<string, string> = {};
  constructor(readonly tagName: string) {}
  append(...items: TestElement[]) { this.children.push(...items); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
}

describe('display render boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('omits a duplicate metric label but keeps a distinct one', () => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => new TestElement(tag),
      createElementNS: (_namespace: string, tag: string) => new TestElement(tag),
    });
    const base = { version: 1 as const, owner: 'owner', placement: 'primary' as const, visible: true, createdAt: 1, updatedAt: 1, expiresAt: null };
    const metric = (id: string, title: string, label: string) => WidgetSchema.parse({ ...base, id, title, content: { kind: 'metric', label, value: '42' } });
    const duplicate = renderWidget(metric('same', 'Jobs', 'Jobs'))!;
    const distinct = renderWidget(metric('different', 'Queue', 'Jobs waiting'))!;
    expect(duplicate.children.filter(child => child.className === 'display-slot-label')).toHaveLength(0);
    expect(distinct.children.find(child => child.className === 'display-slot-label')?.textContent).toBe('Jobs waiting');
  });

  it('keeps demo copy by default and uses neutral copy outside demo mode', () => {
    expect(renderDisplay(initialState())).toContain('LOCAL DEMO • NOT CONNECTED TO HERMES');
    expect(renderDisplay(initialState(), false)).toContain('LOCAL WORKSPACE');
    expect(renderDisplay(initialState(), false)).not.toContain('NOT CONNECTED TO HERMES');
  });

  it('renders malformed progress safely without exposing it in style or text', () => {
    for (const progress of [NaN, Infinity, -1, 101]) {
      const html = renderDisplay({ ...initialState(), progress });
      expect(html).not.toContain('width:0%');
      expect(html).not.toContain('0% progress');
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('Infinity');
    }
  });

  it('presents every activity explicitly without inferring completion from progress', () => {
    const titles = ['Standing by.', 'Thinking.', 'Using a tool.', 'Responding.', 'Waiting.', 'Task complete.', 'Something went wrong.'];
    const activities = ['idle', 'thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error'] as const;
    activities.forEach((activity, i) => {
      const html = renderDisplay({ ...initialState(), activity, progress: 100 });
      expect(html).toContain(titles[i]);
      expect(html).toContain(`data-activity="${activity}"`);
    });
    expect(renderDisplay({ ...initialState(), progress: null })).not.toContain('display-progress');
    expect(renderDisplay(initialState())).toContain('64% progress');
  });

  it('supports both display styles and a disconnected status', () => {
    expect(renderDisplay({ ...initialState(), displayStyle: 'quiet' })).toContain('display--quiet');
    expect(renderDisplay({ ...initialState(), displayStyle: 'ambient' })).toContain('display--ambient');
    expect(renderDisplay({ ...initialState(), task: 'Keep this task text', activity: 'waiting' })).toContain('>Keep this task text</p>');
    expect(renderDisplay(initialState(), true, false)).toContain('Connection lost');
  });
});
