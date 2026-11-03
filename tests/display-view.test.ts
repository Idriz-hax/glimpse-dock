import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../src/demo-state';
import { renderDisplay } from '../src/display/view';
import { mountDisplayWidgets, renderWidget } from '../src/display/widgets';
import { WidgetSchema } from '../src/shared/protocol';

class TestElement {
  children: TestElement[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  textContent = '';
  attributes: Record<string, string> = {};
  hidden = false;
  constructor(readonly tagName: string) {}
  append(...items: TestElement[]) { this.children.push(...items); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  get childElementCount() { return this.children.length; }
  querySelector(selector: string): TestElement | null {
    if (selector.startsWith('[data-placement=')) return this.children.find(child => child.dataset.placement === selector.match(/"([^"]+)"/)?.[1]) ?? null;
    const className = selector.slice(1);
    return this.children.find(child => child.className.split(' ').includes(className)) ?? null;
  }
  querySelectorAll(selector: string): TestElement[] { return this.children.filter(child => selector === '.display-slot-region' && child.className === selector.slice(1)); }
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

  it('validates visual primitive bounds and exposes accessible widget labels', () => {
    vi.stubGlobal('document', { createElement: (tag: string) => new TestElement(tag), createElementNS: (_namespace: string, tag: string) => new TestElement(tag) });
    const base = { version: 1 as const, owner: 'owner', id: 'visual', title: 'Diagram', placement: 'primary' as const, visible: true, createdAt: 1, updatedAt: 1, expiresAt: null };
    const visual = WidgetSchema.parse({ ...base, content: { kind: 'visual', primitives: [{ kind: 'circle', cx: 100, cy: 0, radius: 100, color: 'cyan' }] } });
    const rendered = renderWidget(visual)!;
    const scene = rendered.children[1], circle = scene.children[0];
    expect(scene.attributes).toMatchObject({ role: 'img', 'aria-label': 'Diagram visual' });
    expect(circle.attributes).toMatchObject({ cx: '100', cy: '0', r: '100', fill: '#78d8e8' });
    expect(rendered.attributes['aria-label']).toBe('Diagram, visual slot');
    const invalid = { ...visual, content: { kind: 'visual', primitives: [{ kind: 'circle', cx: 101, cy: 50, radius: 10, color: 'cyan' }] } } as never;
    expect(renderWidget(invalid)).toBeNull();
    const progress = WidgetSchema.parse({ ...base, id: 'progress', content: { kind: 'progress', label: 'Build', value: 50 } });
    expect(renderWidget(progress)?.children.find(child => child.attributes.role === 'progressbar')?.attributes['aria-label']).toBe('Build');
  });

  it('mounts slots in stable placement order, shows empty state, and reports overflow beyond twelve', () => {
    vi.stubGlobal('document', { createElement: (tag: string) => new TestElement(tag), createElementNS: (_namespace: string, tag: string) => new TestElement(tag) });
    const root = new TestElement('main');
    for (const placement of ['primary', 'secondary', 'notification']) { const region = new TestElement('section'); region.className = 'display-slot-region'; region.dataset.placement = placement; root.append(region); }
    const empty = new TestElement('p'); empty.className = 'display-empty'; root.append(empty);
    const overflow = new TestElement('p'); overflow.className = 'display-overflow'; root.append(overflow);
    const make = (id: string, createdAt: number, placement: 'primary' | 'secondary' | 'notification' = 'primary') => WidgetSchema.parse({ version: 1, id, owner: 'owner', title: id, content: { kind: 'text', text: id }, placement, visible: true, createdAt, updatedAt: createdAt, expiresAt: null });
    mountDisplayWidgets(root as never, [], 100);
    expect(empty.hidden).toBe(false);
    const widgets = [make('z', 1), make('b', 1), make('a', 1), make('secondary', 0, 'secondary'), ...Array.from({ length: 10 }, (_, i) => make(`later-${i}`, i + 2))];
    mountDisplayWidgets(root as never, widgets, 100);
    expect(root.children[0].children.map(el => el.dataset.widgetId)).toEqual(['a', 'b', 'z', 'later-0', 'later-1', 'later-2', 'later-3', 'later-4', 'later-5', 'later-6', 'later-7']);
    expect(root.children[1].children.map(el => el.dataset.widgetId)).toEqual(['secondary']);
    expect(empty.hidden).toBe(true);
    expect(overflow.textContent).toBe('+2 more slots');
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

  it('renders owner voice stage while paired display remains voice-free', () => {
    const owner = renderDisplay(initialState(), false, true, 'owner');
    expect(owner).toContain('data-voice-enable'); expect(owner).toContain('data-transcript'); expect(owner).toContain('data-subagents');
    const paired = renderDisplay(initialState(), false, true, 'display');
    expect(paired).not.toContain('voice'); expect(paired).not.toContain('data-transcript');
  });
});
