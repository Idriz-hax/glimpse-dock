import { WidgetCreateSchema, WidgetSchema, type Widget } from '../src/shared/protocol';

export type WidgetPrincipal = 'owner' | 'demo' | `agent:${string}`;
export type WidgetResult = { ok: true; widgets: Widget[] } | { ok: false; code: 'CONFLICT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_INPUT' };
const DAY = 24 * 60 * 60 * 1000;
const fail = (code: Exclude<WidgetResult, { ok: true }>['code']): WidgetResult => ({ ok: false, code });
const validExpiry = (expiry: number | null, now: number) => expiry === null || (Number.isSafeInteger(expiry) && expiry > now && expiry <= now + 30 * DAY);
const canManage = (widget: Widget, principal: WidgetPrincipal) => principal === 'owner' || widget.owner === principal;
const fit = (widgets: Widget[]) => widgets.length <= 32 && widgets.filter(w => w.visible).length <= 12;

export function createWidget(widgets: Widget[], widgetInput: unknown, principal: WidgetPrincipal, now: number): WidgetResult {
  const parsed = WidgetCreateSchema.safeParse(widgetInput);
  if (!parsed.success || !validExpiry(parsed.data.expiresAt, now)) return fail('INVALID_INPUT');
  if (widgets.some(w => w.id === parsed.data.id)) return fail('CONFLICT');
  const created: Widget = { ...parsed.data, owner: principal, visible: true, createdAt: now, updatedAt: now };
  if (!WidgetSchema.safeParse(created).success) return fail('INVALID_INPUT');
  const next = [...widgets, created];
  return fit(next) ? { ok: true, widgets: next } : fail('CONFLICT');
}

export function updateWidget(widgets: Widget[], id: string, patch: unknown, principal: WidgetPrincipal, now: number): WidgetResult {
  const index = widgets.findIndex(w => w.id === id);
  if (index < 0) return fail('NOT_FOUND');
  const current = widgets[index];
  if (!canManage(current, principal)) return fail('FORBIDDEN');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !['title', 'content', 'placement', 'expiresAt'].includes(k))) return fail('INVALID_INPUT');
  const updated = { ...current, ...patch, updatedAt: now };
  if (!validExpiry(updated.expiresAt, now)) return fail('INVALID_INPUT');
  const parsed = WidgetSchema.safeParse(updated);
  if (!parsed.success) return fail('INVALID_INPUT');
  const next = widgets.map((w, i) => i === index ? parsed.data : w);
  return fit(next) ? { ok: true, widgets: next } : fail('CONFLICT');
}

export function setWidgetVisibility(widgets: Widget[], id: string, visible: boolean, principal: WidgetPrincipal): WidgetResult {
  const index = widgets.findIndex(w => w.id === id);
  if (index < 0) return fail('NOT_FOUND');
  if (!canManage(widgets[index], principal)) return fail('FORBIDDEN');
  if (typeof visible !== 'boolean') return fail('INVALID_INPUT');
  const next = widgets.map((w, i) => i === index ? { ...w, visible } : w);
  return fit(next) ? { ok: true, widgets: next } : fail('CONFLICT');
}

export function removeWidget(widgets: Widget[], id: string, principal: WidgetPrincipal): WidgetResult {
  const target = widgets.find(w => w.id === id);
  if (!target) return fail('NOT_FOUND');
  if (!canManage(target, principal)) return fail('FORBIDDEN');
  return { ok: true, widgets: widgets.filter(w => w.id !== id) };
}

export function removeExpiredWidgets(widgets: Widget[], now: number): WidgetResult {
  return { ok: true, widgets: widgets.filter(w => w.expiresAt === null || w.expiresAt > now) };
}
