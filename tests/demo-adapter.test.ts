import { describe, expect, it, vi } from 'vitest';
import { createDemoState, transitionDemo } from '../server/adapters/demo.ts';

describe('Demo adapter', () => {
  it('starts with explicit demo labeling, seeded widgets and retained seed activity', () => {
    const state = createDemoState();
    expect(state.agent).toBe('Hermes (Demo)');
    expect(state.widgets.map(widget => widget.id)).toEqual(['tasks', 'tools', 'runtime']);
    expect(state.logs).toHaveLength(3);
    expect(state.logs[0].title).toBe('Connection established');
  });

  it('simulates a bounded action and supports pause and reset through the same command boundary', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const original = createDemoState();
    const advanced = transitionDemo(original, { v: 1, requestId: '1', type: 'demo.simulate', payload: {} });
    expect(advanced.progress).toBe(75);
    expect(advanced.logs.length).toBeGreaterThan(original.logs.length);
    const paused = transitionDemo(advanced, { v: 1, requestId: '2', type: 'demo.set-enabled', payload: { enabled: false } });
    expect(paused.running).toBe(false);
    expect(transitionDemo(original, { v: 1, requestId: 'widget', type: 'demo.add-widget', payload: {} }).widgets).toHaveLength(4);
    expect(transitionDemo(paused, { v: 1, requestId: '3', type: 'demo.reset', payload: {} })).toEqual(original);
    vi.restoreAllMocks();
  });
});
