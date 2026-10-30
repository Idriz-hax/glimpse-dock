import { describe, expect, it } from 'vitest';
import { initialState } from '../src/demo-state';
import { CommandRequestSchema, ErrorResponseSchema, StateMessageSchema } from '../src/shared/protocol';

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
  });

  it('validates versioned full-state snapshots and provenance', () => {
    const log = { id: 1, time: 'now', title: 't', detail: 'd', level: 'info' as const };
    expect(StateMessageSchema.safeParse({ v: 1, type: 'snapshot', revision: 0, source: 'demo', state: initialState() }).success).toBe(true);
    expect(StateMessageSchema.safeParse({ v: 2, type: 'snapshot', revision: 0, source: 'demo', state: initialState() }).success).toBe(false);
    expect(StateMessageSchema.safeParse({ v: 1, type: 'snapshot', revision: -1, source: 'demo', state: initialState() }).success).toBe(false);
    expect(StateMessageSchema.safeParse({ v: 1, type: 'snapshot', revision: 1, source: 'invented', state: initialState() }).success).toBe(false);
    expect(StateMessageSchema.safeParse({ v: 1, type: 'state', revision: 1, source: 'owner', state: { ...initialState(), progress: Infinity } }).success).toBe(false);
    expect(StateMessageSchema.safeParse({ v: 1, type: 'state', revision: 1, source: 'owner', state: { ...initialState(), logs: Array(41).fill(log) } }).success).toBe(false);
  });

  it('validates structured errors', () => {
    expect(ErrorResponseSchema.safeParse({ v: 1, error: { code: 'FORBIDDEN', message: 'Not allowed', requestId: 'r1' } }).success).toBe(true);
    expect(ErrorResponseSchema.safeParse({ v: 1, error: { code: 'SQL_ERROR', message: 'internal details', requestId: 'r1' } }).success).toBe(false);
  });
});
