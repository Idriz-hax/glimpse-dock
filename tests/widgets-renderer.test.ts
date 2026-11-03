import { afterEach, describe, expect, it } from 'vitest';
import { renderWidget } from '../src/display/widgets';
import type { Widget } from '../src/shared/protocol';

class ElementShim {
  children: ElementShim[] = [];
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  textContent = '';
  constructor(readonly tagName: string) {}
  append(...nodes: ElementShim[]) { this.children.push(...nodes); }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
}
const priorDocument = globalThis.document;
const doc = {
  createElement: (tag: string) => new ElementShim(tag),
  createElementNS: (_ns: string, tag: string) => new ElementShim(tag),
};
const installDocument = () => { Object.defineProperty(globalThis, 'document', { configurable: true, value: doc }); };
afterEach(() => { Object.defineProperty(globalThis, 'document', { configurable: true, value: priorDocument }); });

const widget = (kind: Widget['content']['kind'], content: Widget['content'], extra: Partial<Widget> = {}): Widget => ({
  version: 1, id: 'test', owner: 'owner', title: 'Title', content, placement: 'primary', visible: true,
  createdAt: 0, updatedAt: 0, expiresAt: null, ...extra,
} as Widget);

describe('renderWidget', () => {
  it('renders every content kind and unknown progress', () => {
    installDocument();
    const contents: Widget['content'][] = [
      { kind: 'text', text: 'body' }, { kind: 'status', label: 'Ready', tone: 'success' },
      { kind: 'metric', label: 'Count', value: '4', unit: 'items' },
      { kind: 'progress', label: 'Work', value: null },
      { kind: 'visual', primitives: [] },
    ];
    const rendered = contents.map(content => renderWidget(widget(content.kind, content))!);
    expect(rendered.map(el => el.children[1].tagName)).toEqual(['p', 'p', 'p', 'p', 'svg']);
    expect(rendered[3].children.map(child => child.textContent)).toContain('Unknown');
    expect(renderWidget(widget('progress', { kind: 'progress', label: 'Work', value: 42 }))!.children[2].children[0].style.width).toBe('42%');
  });

  it('filters hidden and expired widgets and preserves hostile strings as text', () => {
    installDocument();
    expect(renderWidget(widget('text', { kind: 'text', text: 'x' }, { visible: false }))).toBeNull();
    expect(renderWidget(widget('text', { kind: 'text', text: 'x' }, { expiresAt: 5 }), 5)).toBeNull();
    const hostile = '<img src=x onerror=alert(1)>';
    const card = renderWidget(widget('text', { kind: 'text', text: hostile }, { title: hostile }))!;
    expect(card.children[0].textContent).toBe(hostile);
    expect(card.children[1].textContent).toBe(hostile);
    expect(card.children[0].children).toHaveLength(0);
  });

  it('maps visual primitives to SVG with allowlisted colors and numeric attributes', () => {
    installDocument();
    const primitives = [
      { kind: 'text', x: 1, y: 2, text: 'Hi', color: 'cyan', size: 3 },
      { kind: 'rect', x: 1, y: 2, width: 3, height: 4, color: 'mint' },
      { kind: 'circle', cx: 5, cy: 6, radius: 7, color: 'blue' },
      { kind: 'line', x1: 1, y1: 2, x2: 3, y2: 4, color: 'amber', width: 2 },
    ] as const;
    const svg = renderWidget(widget('visual', { kind: 'visual', primitives: [...primitives] }))!.children[1];
    expect(svg.children.map(child => child.tagName)).toEqual(['text', 'rect', 'circle', 'line']);
    expect(svg.children.map(child => child.getAttribute('fill') ?? child.getAttribute('stroke'))).toEqual(['#78d8e8', '#7be0b2', '#83aaff', '#f2bd70']);
    expect(svg.children[0].attributes).toMatchObject({ x: '1', y: '2', 'font-size': '3' });
  });
});
