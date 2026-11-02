import { describe, expect, it } from 'vitest';
import { initialState } from '../src/demo-state';
import { CommandRequestSchema, ErrorResponseSchema, ProtocolStateSchema, StateMessageSchema } from '../src/shared/protocol';

describe('protocol v1', () => {
  it('accepts only known bounded commands', () => {
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r1', type: 'metric.set-value', payload: { id: 'tasks', value: 42 } }).success).toBe(true);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r2', type: 'state.set-progress', payload: { progress: 100 } }).success).toBe(true);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r3', type: 'task.update', payload: { task: 'Summarize files' } }).success).toBe(true);
    expect(CommandRequestSchema.safeParse({ v: 2, requestId: 'r4', type: 'state.set-progress', payload: { progress: 20 } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r5', type: 'state.set-progress', payload: { progress: 101 } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r6', type: 'unknown', payload: {} }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r7', type: 'task.update', payload: { task: 'x'.repeat(2049) } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r8', type: 'task.update' }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r9', type: 'metric.set-value', payload: { id: 'runtime', value: 10 } }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r10', type: 'task.complete', payload: {}, extra: true }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ v: 1, requestId: 'r11', type: 'demo.add-widget', payload: {} }).success).toBe(true);
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
  });

  it('validates structured errors', () => {
    expect(ErrorResponseSchema.safeParse({ v: 1, error: { code: 'FORBIDDEN', message: 'Not allowed', requestId: 'r1' } }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ v: 1, error: { code: 'SQL_ERROR', message: 'internal details', requestId: 'r1' } }).success).toBe(false);
  });
});
