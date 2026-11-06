import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoState, transitionDemo } from '../server/adapters/demo.ts';

describe('Demo adapter', () => {
  afterEach(() => vi.restoreAllMocks());
  it('starts with explicit demo labeling, seeded widgets and retained seed activity', () => {
    const state = createDemoState(1234);
    expect(state.agent).toBe('Hermes (Demo)');
    expect(state.widgets.map(widget => widget.id)).toEqual(['tasks', 'tools', 'runtime']);
    expect(state.logs).toHaveLength(3);
    expect(state.logs[0].title).toBe('Connection established');
  });

  it('simulates demo widget create, repeated create as update, and remove through the lifecycle', () => {
    const original = createDemoState(100);
    const command = { v: 1 as const, requestId: 'widget', type: 'demo.simulate' as const, payload: {} };
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const created = transitionDemo(original, command, 200);
    expect(created.widgets.find(widget => widget.id === 'demo-status')).toMatchObject({ owner: 'demo', createdAt: 200, updatedAt: 200 });
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const updated = transitionDemo(created, command, 300);
    expect(updated.widgets.filter(widget => widget.id === 'demo-status')).toHaveLength(1);
    expect(updated.widgets.find(widget => widget.id === 'demo-status')?.updatedAt).toBe(300);
    vi.spyOn(Math, 'random').mockReturnValue(0.95);
    expect(transitionDemo(updated, command, 400).widgets.some(widget => widget.id === 'demo-status')).toBe(false);
  });

  it('simulates a bounded action and supports pause and reset through the same command boundary', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const original = createDemoState(123);
    const advanced = transitionDemo(original, { v: 1, requestId: '1', type: 'demo.simulate', payload: {} });
    expect(advanced.progress).toBe(75);
    expect(advanced.logs.length).toBeGreaterThan(original.logs.length);
    const paused = transitionDemo(advanced, { v: 1, requestId: '2', type: 'demo.set-enabled', payload: { enabled: false } });
    expect(paused.running).toBe(false);
    expect(transitionDemo(original, { v: 1, requestId: 'widget', type: 'widget.create', payload: { widget: { version: 1, id: 'extra', title: 'Extra', content: { kind: 'metric', label: 'Extra', value: '0' }, placement: 'secondary', expiresAt: null } } }).widgets).toHaveLength(3);
    expect(transitionDemo(paused, { v: 1, requestId: '3', type: 'demo.reset', payload: {} }, 123)).toEqual(original);
  });

  it('sets activity and completion consistently for demo actions', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1 / 4);
    const original = { ...createDemoState(123), activity: 'completed' as const, progress: 100, turnStartedAt: null };
    expect(transitionDemo(original, { v: 1, requestId: 'resume', type: 'demo.set-enabled', payload: { enabled: true } }, 456).turnStartedAt).toBe(456);
    const active = { ...createDemoState(456), turnStartedAt: 456 };
    expect(transitionDemo(active, { v: 1, requestId: 'tool', type: 'demo.simulate', payload: {} }, 789).activity).toBe('tool-use');
    expect(transitionDemo(active, { v: 1, requestId: 'pause', type: 'demo.set-enabled', payload: { enabled: false } }, 789).turnStartedAt).toBe(456);
    vi.spyOn(Math, 'random').mockReturnValue(1 / 3);
    const completed = transitionDemo(createDemoState(123), { v: 1, requestId: 'complete', type: 'demo.simulate', payload: {} });
    expect(completed).toMatchObject({ progress: 100, activity: 'completed' });
    expect(completed.turnStartedAt).toBeNull();
    expect(transitionDemo(completed, { v: 1, requestId: 'pause', type: 'demo.set-enabled', payload: { enabled: false } })).toMatchObject({ progress: 100, activity: 'completed', running: false });
  });

  it('starts a fresh task when resuming or simulating from a terminal state', () => {
    const completed = { ...createDemoState(), activity: 'completed' as const, progress: 100, task: 'Finished task', toolCategory: 'shell' as const, turnStartedAt: null };
    const errored = { ...completed, activity: 'error' as const };
    vi.spyOn(Math, 'random').mockReturnValue(1 / 4);
    for (const terminal of [completed, errored]) {
      expect(transitionDemo(terminal, { v: 1, requestId: 'resume', type: 'demo.set-enabled', payload: { enabled: true } }))
        .toMatchObject({ activity: 'thinking', progress: 0, task: 'Preparing visual summary for the workspace', toolCategory: null, running: true });
      expect(transitionDemo(terminal, { v: 1, requestId: 'resume', type: 'demo.set-enabled', payload: { enabled: true } }, 789).turnStartedAt).toBe(789);
      expect(transitionDemo(terminal, { v: 1, requestId: 'simulate', type: 'demo.simulate', payload: {} }))
        .toMatchObject({ activity: 'thinking', progress: 0, task: 'Preparing visual summary for the workspace', toolCategory: null });
    }
  });

  it('clears a tool category when resetting the demo', () => {
    const state = { ...createDemoState(), toolCategory: 'search' as const };
    expect(transitionDemo(state, { v: 1, requestId: 'reset', type: 'demo.reset', payload: {} }).toolCategory).toBeNull();
  });
});
