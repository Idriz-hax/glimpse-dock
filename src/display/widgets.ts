import { WidgetSchema, type Widget } from '../shared/protocol';

const colors = { cyan: '#78d8e8', mint: '#7be0b2', blue: '#83aaff', purple: '#ba9cf5', amber: '#f2bd70', muted: '#91a2b8', white: '#edf4ff' } as const;
const svgNS = 'http://www.w3.org/2000/svg';
const node = (tag: string, text?: string) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
const svg = (tag: string, attrs: Record<string, number | string>) => { const el = document.createElementNS(svgNS, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value)); return el; };

export function renderWidget(input: Widget, now = Date.now()): HTMLElement | null {
  const parsed = WidgetSchema.safeParse(input);
  if (!parsed.success || !parsed.data.visible || (parsed.data.expiresAt !== null && parsed.data.expiresAt <= now)) return null;
  const widget = parsed.data, card = node('article');
  card.className = `display-slot display-slot--${widget.placement}`;
  card.dataset.widgetId = widget.id;
  card.setAttribute('aria-label', `${widget.title}, ${widget.content.kind} slot`);
  const heading = node('h2', widget.title); card.append(heading);
  const content = widget.content;
  if (content.kind === 'text') card.append(node('p', content.text));
  else if (content.kind === 'status') { const p = node('p', content.label); p.className = 'display-slot-status'; p.dataset.tone = content.tone; card.append(p); }
  else if (content.kind === 'metric') { if (content.label !== widget.title) { const label = node('p', content.label); label.className = 'display-slot-label'; card.append(label); } const value = node('p', `${content.value}${content.unit ? ` ${content.unit}` : ''}`); value.className = 'display-slot-value'; card.append(value); if (content.caption) card.append(node('p', content.caption)); }
  else if (content.kind === 'progress') { card.append(node('p', content.label)); if (content.value === null) card.append(node('p', 'Unknown')); else { const bar = node('div'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', content.label); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(content.value)); const fill = node('span'); fill.style.width = `${content.value}%`; bar.append(fill); card.append(bar); } }
  else {
    const scene = svg('svg', { viewBox: '0 0 100 100', role: 'img', 'aria-label': `${widget.title} visual` });
    for (const primitive of content.primitives) {
      const color = colors[primitive.color]; let el: SVGElement;
      if (primitive.kind === 'text') { el = svg('text', { x: primitive.x, y: primitive.y, 'font-size': primitive.size, fill: color }); el.textContent = primitive.text; }
      else if (primitive.kind === 'rect') el = svg('rect', { x: primitive.x, y: primitive.y, width: primitive.width, height: primitive.height, fill: color });
      else if (primitive.kind === 'circle') el = svg('circle', { cx: primitive.cx, cy: primitive.cy, r: primitive.radius, fill: color });
      else el = svg('line', { x1: primitive.x1, y1: primitive.y1, x2: primitive.x2, y2: primitive.y2, stroke: color, 'stroke-width': primitive.width });
      scene.append(el);
    }
    card.append(scene);
  }
  return card;
}

export function mountDisplayWidgets(root: HTMLElement, widgets: Widget[], now = Date.now()): void {
  if (root.querySelector('.display')?.getAttribute('data-show-widgets') === 'false') {
    root.querySelector('.display-widgets')?.setAttribute('hidden', '');
    return;
  }
  root.querySelector('.display-widgets')?.removeAttribute('hidden');
  const visible = widgets.map(widget => ({ widget, element: renderWidget(widget, now) })).filter((item): item is { widget: Widget; element: HTMLElement } => item.element !== null);
  visible.sort((a, b) => a.widget.createdAt - b.widget.createdAt || a.widget.id.localeCompare(b.widget.id));
  for (const { widget, element } of visible.slice(0, 12)) root.querySelector(`[data-placement="${widget.placement}"]`)?.append(element);
  root.querySelectorAll<HTMLElement>('.display-slot-region').forEach(region => { region.hidden = region.childElementCount === 0; });
  const empty = root.querySelector<HTMLElement>('.display-empty')!;
  empty.hidden = visible.length !== 0;
  const overflow = root.querySelector<HTMLElement>('.display-overflow')!;
  overflow.hidden = visible.length <= 12;
  if (visible.length > 12) overflow.textContent = `+${visible.length - 12} more slots`;
}
