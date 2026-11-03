import { describe, expect, it } from 'vitest';
import { createWidget, removeExpiredWidgets, removeWidget, setWidgetVisibility, updateWidget } from '../server/widgets';
import type { Widget } from '../src/shared/protocol';

const widget = (id: string, owner = 'owner', visible = true, expiresAt: number | null = null): Widget => ({ version: 1, id, owner, title: id, content: { kind: 'text', text: id }, placement: 'primary', visible, createdAt: 1, updatedAt: 1, expiresAt });
const input = (id: string, expiresAt: number | null = null) => ({ version: 1 as const, id, title: id, content: { kind: 'text' as const, text: id }, placement: 'primary' as const, expiresAt });
const agent = (id = 'abc') => `agent:${id}`;

describe('widget lifecycle', () => {
  it('creates with principal-derived owner and timestamps', () => {
    expect(createWidget([], input('one'), agent(), 10)).toEqual({ ok: true, widgets: [{ ...widget('one', 'agent:abc'), createdAt: 10, updatedAt: 10 }] });
  });
  it('updates content without changing stable identity', () => {
    const before = widget('one', 'agent:abc');
    const result = updateWidget([before], 'one', { title: 'new' }, agent(), 20);
    expect(result.ok && result.widgets[0]).toMatchObject({ id: 'one', owner: 'agent:abc', createdAt: 1, updatedAt: 20, title: 'new' });
  });
  it('does not retain caller-owned patch content', () => {
    const content = { kind: 'text' as const, text: 'validated' };
    const patch = { content };
    const result = updateWidget([widget('one')], 'one', patch, 'owner', 20);
    content.text = 'mutated';
    expect(result.ok && result.widgets[0].content).toEqual({ kind: 'text', text: 'validated' });
  });
  it('changes visibility and removes records', () => {
    expect(setWidgetVisibility([widget('one')], 'one', false, 'owner', 20)).toMatchObject({ ok: true, widgets: [{ visible: false, updatedAt: 20 }] });
    expect(removeWidget([widget('one')], 'one', 'owner')).toEqual({ ok: true, widgets: [] });
  });
  it('preserves untouched fields on partial updates', () => {
    const before = widget('one');
    const content = { kind: 'status' as const, label: 'Ready', tone: 'success' as const };
    expect(updateWidget([before], 'one', { content }, 'owner', 20)).toMatchObject({ ok: true, widgets: [{ title: 'one', content, placement: 'primary' }] });
    expect(updateWidget([before], 'one', { title: 'Renamed' }, 'owner', 20)).toMatchObject({ ok: true, widgets: [{ title: 'Renamed', content: before.content, placement: 'primary' }] });
  });
  it('removes expired records deterministically', () => {
    expect(removeExpiredWidgets([widget('b', 'owner', true, 5), widget('a'), widget('c', 'owner', true, 5)], 5)).toEqual({ ok: true, widgets: [widget('a')] });
  });
  it('rejects duplicate IDs, missing IDs, and cross-owner changes without mutation', () => {
    const original = [widget('one', 'agent:other')];
    expect(createWidget(original, input('one'), agent(), 10)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(updateWidget(original, 'absent', {}, agent(), 10)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(removeWidget(original, 'one', agent())).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(original).toEqual([widget('one', 'agent:other')]);
  });
  it('enforces record and visible limits and expiry bounds', () => {
    expect(createWidget(Array.from({ length: 32 }, (_, i) => widget(String(i))), input('new'), 'owner', 10)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(createWidget(Array.from({ length: 12 }, (_, i) => widget(String(i))), input('new'), 'owner', 10)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(createWidget([], input('past', 9), 'owner', 10)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(createWidget([], input('far', 10 + 31 * 86400000), 'owner', 10)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });
});
