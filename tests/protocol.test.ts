import { describe, expect, it } from 'vitest';
import { initialState } from '../src/demo-state';
import { ActivityTransitions, canTransitionActivity, CommandRequestSchema, ErrorResponseSchema, ProtocolStateSchema, StateMessageSchema } from '../src/shared/protocol';

describe('protocol v1', () => {
  it('exposes valid activity transitions', () => {
    expect(ActivityTransitions.idle).toEqual(['idle', 'thinking', 'waiting', 'error']);
    expect(canTransitionActivity('thinking', 'tool-use')).toBe(true);
    expect(canTransitionActivity('completed', 'thinking')).toBe(true);
    expect(canTransitionActivity('completed', 'tool-use')).toBe(false);
    expect(canTransitionActivity('error', 'completed')).toBe(false);
  });
  it('allows explicit interruption cleanup to idle from active states', () => {
    for (const activity of ['thinking', 'tool-use', 'responding', 'waiting'] as const) {
      expect(canTransitionActivity(activity, 'idle')).toBe(true);
    }
    expect(canTransitionActivity('completed', 'idle')).toBe(true);
    expect(canTransitionActivity('error', 'idle')).toBe(true);
  });
  it('accepts only known bounded commands', () => {
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r1', type: 'metric.set-value', payload: { id: 'tasks', value: 42 } }).success).toBe(true);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r2', type: 'state.set-progress', payload: { progress: 100 } }).success).toBe(true);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r3', type: 'task.update', payload: { task: 'Summarize files' } }).success).toBe(true);
    for (const toolCategory of ['shell', 'code', 'search']) {
      expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'category', type: 'task.update', payload: { task: 'Working', toolCategory } }).success).toBe(true);
      expect(ProtocolStateSchema.safeParse({ ...initialState(), toolCategory }).success).toBe(true);
    }
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'category', type: 'task.update', payload: { task: 'Working', toolCategory: 'browser' } }).success).toBe(false);
    expect(ProtocolStateSchema.safeParse({ ...initialState(), toolCategory: 'browser' }).success).toBe(false);
    expect(ProtocolStateSchema.parse(initialState()).toolCategory).toBeNull();
    const { toolCategory: _toolCategory, ...legacyState } = initialState();
    expect(ProtocolStateSchema.parse(legacyState).toolCategory).toBeNull();
    expect(CommandRequestSchema.safeParse({ v: 2, requestId: 'r4', type: 'state.set-progress', payload: { progress: 20 } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r5', type: 'state.set-progress', payload: { progress: 101 } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r6', type: 'unknown', payload: {} }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r7', type: 'task.update', payload: { task: 'x'.repeat(2049) } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r8', type: 'task.update' }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r9', type: 'metric.set-value', payload: { id: 'runtime', value: 10 } }).success).toBe(true);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r10', type: 'task.complete', payload: {}, extra: true }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r11', type: 'demo.add-widget', payload: {} }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'create', type: 'widget.create', payload: { widget: { version: 1, id: 'one', title: 'One', content: { kind: 'metric', label: 'One', value: '1' }, placement: 'primary', expiresAt: null } } }).success).toBe(true);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'create', type: 'widget.create', payload: { widget: { version: 2, id: 'one', title: 'One', content: { kind: 'unknown' }, placement: 'invalid' } } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r12', type: 'display.set-style', payload: { style: 'quiet' } }).success).toBe(true);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r13', type: 'display.set-style', payload: { style: 'ambient' } }).success).toBe(true);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r14', type: 'display.set-style', payload: { style: 'neon' } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r15', type: 'display.set-style', payload: { style: 'quiet', extra: true } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r16', type: 'state.set-activity', payload: { activity: 'tool-use' } }).success).toBe(true);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r17', type: 'state.set-activity', payload: { activity: 'unknown' } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r18', type: 'state.set-progress', payload: { progress: 42 } }).success).toBe(true);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r19', type: 'state.set-progress', payload: { progress: null } }).success).toBe(true);
  });

  it('validates versioned full-state snapshots and provenance', () => {
    const log = { id: 1, time: 'now', title: 't', detail: 'd', level: 'info' as const };
    expect(StateMessageSchema.safeParse({ v: 1, type: 'snapshot', revision: 0, source: 'demo', state: initialState() }).success).toBe(true);
    expect(StateMessageSchema.safeParse({ v: 2, type: 'snapshot', revision: 0, source: 'demo', state: initialState() }).success).toBe(false);
    expect(StateMessageSchema.safeParse({ v: 1, type: 'snapshot', revision: -1, source: 'demo', state: initialState() }).success).toBe(false);
    expect(StateMessageSchema.safeParse({ v: 1, type: 'snapshot', revision: 1, source: 'invented', state: initialState() }).success).toBe(false);
    expect(StateMessageSchema.safeParse({ v: 1, type: 'state', revision: 1, source: 'owner', state: { ...initialState(), progress: Infinity } }).success).toBe(false);
    expect(StateMessageSchema.safeParse({ v: 1, type: 'state', revision: 1, source: 'owner', state: { ...initialState(), logs: Array(41).fill(log) } }).success).toBe(false);
    const state = initialState();
    expect(StateMessageSchema.safeParse({ v: 1, type: 'state', revision: 1, source: 'owner', state: { ...state, activity: 'thinking', displayStyle: 'ambient' } }).success).toBe(true);
    expect(StateMessageSchema.safeParse({ v: 1, type: 'state', revision: 1, source: 'owner', state: { ...state, activity: 'invented' } }).success).toBe(false);
    expect(StateMessageSchema.safeParse({ v: 1, type: 'state', revision: 1, source: 'owner', state: { ...state, displayStyle: 'neon' } }).success).toBe(false);
    const { activity: _activity, displayStyle: _displayStyle, ...legacyState } = state;
    const legacy = ProtocolStateSchema.safeParse(legacyState);
    expect(legacy.success && legacy.data).toMatchObject({ activity: 'idle', displayStyle: 'quiet' });
    expect(ProtocolStateSchema.parse({ ...state, progress: 35 }).progress).toBe(35);
    expect(ProtocolStateSchema.parse({ ...state, progress: null }).progress).toBeNull();
    const { progress: _progress, ...withoutProgress } = state;
    expect(ProtocolStateSchema.parse(withoutProgress).progress).toBeNull();
    const { turnStartedAt: _turnStartedAt, ...withoutTurnStartedAt } = state;
    expect(ProtocolStateSchema.parse(withoutTurnStartedAt).turnStartedAt).toBeNull();
    expect(ProtocolStateSchema.parse({ ...state, turnStartedAt: 0 }).turnStartedAt).toBe(0);
    expect(ProtocolStateSchema.parse({ ...state, turnStartedAt: null }).turnStartedAt).toBeNull();
    for (const turnStartedAt of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(ProtocolStateSchema.safeParse({ ...state, turnStartedAt }).success).toBe(false);
    }
  });

  it('validates structured errors', () => {
    expect(ErrorResponseSchema.safeParse({ v: 1, error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'r1' } }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ v: 1, error: { code: 'FORBIDDEN', message: 'Not allowed', requestId: 'r1' } }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ v: 1, error: { code: 'SQL_ERROR', message: 'internal details', requestId: 'r1' } }).success).toBe(false);
  });

  it('normalizes persisted legacy metric widgets', () => {
    const state = initialState();
    const legacy = { ...state, widgets: [{ id: 'old', label: 'Old label', value: '7', sub: 'Old info', tone: 'cyan' }] };
    expect(ProtocolStateSchema.parse(legacy).widgets[0]).toEqual({ version: 1, id: 'old', owner: 'owner', title: 'Old label', content: { kind: 'metric', label: 'Old label', value: '7', caption: 'Old info' }, placement: 'secondary', visible: true, createdAt: 0, updatedAt: 0, expiresAt: null });
  });

  it('preserves legacy records while hiding overflow beyond 12 visible widgets', () => {
    const widgets = Array.from({ length: 15 }, (_, index) => ({ id: `legacy-${index}`, label: `Label ${index}`, value: String(index), sub: `Info ${index}`, tone: 'cyan' }));
    const normalized = ProtocolStateSchema.parse({ ...initialState(), widgets }).widgets;
    expect(normalized).toHaveLength(15);
    expect(normalized.map(widget => widget.id)).toEqual(widgets.map(widget => widget.id));
    expect(normalized.slice(0, 12).every(widget => widget.visible)).toBe(true);
    expect(normalized.slice(12).every(widget => !widget.visible)).toBe(true);
    expect(normalized[14]).toMatchObject({ title: 'Label 14', content: { label: 'Label 14', value: '14', caption: 'Info 14' } });
  });

  it('rejects malformed legacy widget objects instead of discarding unknown fields', () => {
    const good = { id: 'legacy', label: 'Label', value: '1', sub: 'Info', tone: 'cyan' };
    for (const widget of [
      { ...good, extra: true },
      { ...good, value: 1 },
      { ...good, tone: 'neon' },
      { id: 'legacy', label: 'Label', value: '1', sub: 'Info' },
    ]) {
      expect(ProtocolStateSchema.safeParse({ ...initialState(), widgets: [widget] }).success).toBe(false);
    }
  });

  it('validates every structured content kind and enforces content bounds', () => {
    const base = { version: 1, id: 'valid', owner: 'owner', title: 'Title', placement: 'primary', visible: true, createdAt: 0, updatedAt: 0, expiresAt: null };
    for (const content of [{ kind: 'text', text: 'Hi' }, { kind: 'status', label: 'Ready', tone: 'success' }, { kind: 'metric', label: 'Count', value: '3' }, { kind: 'progress', label: 'Work', value: null }, { kind: 'visual', primitives: [{ kind: 'rect', x: 0, y: 0, width: 100, height: 100, color: 'cyan' }] }]) {
      expect(ProtocolStateSchema.safeParse({ ...initialState(), widgets: [{ ...base, content }] }).success).toBe(true);
    }
    expect(ProtocolStateSchema.safeParse({ ...initialState(), widgets: [{ ...base, version: 2, content: { kind: 'text', text: 'x' } }] }).success).toBe(false);
    expect(ProtocolStateSchema.safeParse({ ...initialState(), widgets: [{ ...base, content: { kind: 'progress', label: 'Work', value: 101 } }] }).success).toBe(false);
    expect(ProtocolStateSchema.safeParse({ ...initialState(), widgets: [{ ...base, content: { kind: 'status', label: 'Ready', tone: 'neon' } }] }).success).toBe(false);
    expect(ProtocolStateSchema.safeParse({ ...initialState(), widgets: [{ ...base, placement: 'overlay', content: { kind: 'text', text: 'x' } }] }).success).toBe(false);
    expect(ProtocolStateSchema.safeParse({ ...initialState(), widgets: [{ ...base, content: { kind: 'unknown', text: 'x' } }] }).success).toBe(false);
    expect(ProtocolStateSchema.safeParse({ ...initialState(), widgets: [{ ...base, content: { kind: 'visual', primitives: [{ kind: 'rect', x: 0, y: 0, width: 1, height: 1, color: 'neon' }] } }] }).success).toBe(false);
    expect(ProtocolStateSchema.safeParse({ ...initialState(), widgets: [{ ...base, content: { kind: 'text', text: 'x'.repeat(4097) } }] }).success).toBe(false);
    expect(ProtocolStateSchema.safeParse({ ...initialState(), widgets: [{ ...base, content: { kind: 'visual', primitives: Array(65).fill({ kind: 'circle', cx: 1, cy: 1, radius: 1, color: 'cyan' }) } }] }).success).toBe(false);
    expect(ProtocolStateSchema.safeParse({ ...initialState(), widgets: Array(13).fill({ ...base, content: { kind: 'text', text: 'x' } }) }).success).toBe(false);
  });
});
