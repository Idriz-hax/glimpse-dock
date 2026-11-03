import { describe, expect, it, vi } from 'vitest';
import { createDemoState, transitionDemo } from '../server/adapters/demo.ts';

describe('Demo adapter', () => {
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
    vi.restoreAllMocks();
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
    vi.restoreAllMocks();
  });

  it('sets activity and completion consistently for demo actions', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1 / 4);
    const original = createDemoState();
    expect(transitionDemo(original, { v: 1, requestId: 'tool', type: 'demo.simulate', payload: {} }).activity).toBe('tool-use');
    vi.spyOn(Math, 'random').mockReturnValue(1 / 3);
    const completed = transitionDemo(original, { v: 1, requestId: 'complete', type: 'demo.simulate', payload: {} });
    expect(completed).toMatchObject({ progress: 100, activity: 'completed' });
    expect(transitionDemo(completed, { v: 1, requestId: 'pause', type: 'demo.set-enabled', payload: { enabled: false } })).toMatchObject({ progress: 100, activity: 'completed', running: false });
    vi.restoreAllMocks();
  });

  it('starts a fresh task when resuming or simulating from a terminal state', () => {
    const completed = { ...createDemoState(), activity: 'completed' as const, progress: 100, task: 'Finished task' };
    const errored = { ...completed, activity: 'error' as const };
    vi.spyOn(Math, 'random').mockReturnValue(1 / 4);
    for (const terminal of [completed, errored]) {
      expect(transitionDemo(terminal, { v: 1, requestId: 'resume', type: 'demo.set-enabled', payload: { enabled: true } }))
        .toMatchObject({ activity: 'thinking', progress: 0, task: 'Preparing visual summary for the workspace', running: true });
      expect(transitionDemo(terminal, { v: 1, requestId: 'simulate', type: 'demo.simulate', payload: {} }))
        .toMatchObject({ activity: 'thinking', progress: 0, task: 'Preparing visual summary for the workspace' });
    }
    vi.restoreAllMocks();
  });
});
