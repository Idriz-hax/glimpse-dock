import { describe, expect, it } from 'vitest';
import { initialState } from '../src/demo-state';
import { renderDisplay } from '../src/display/view';

describe('display render boundary', () => {
  it('keeps demo copy by default and uses neutral copy outside demo mode', () => {
    expect(renderDisplay(initialState())).toContain('LOCAL DEMO • NOT CONNECTED TO HERMES');
    expect(renderDisplay(initialState(), false)).toContain('LOCAL WORKSPACE');
    expect(renderDisplay(initialState(), false)).not.toContain('NOT CONNECTED TO HERMES');
  });

  it('renders malformed progress safely without exposing it in style or text', () => {
    for (const progress of [NaN, Infinity, -1, 101]) {
      const html = renderDisplay({ ...initialState(), progress });
      expect(html).not.toContain('width:0%');
      expect(html).not.toContain('0% progress');
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('Infinity');
    }
  });

  it('presents every activity explicitly without inferring completion from progress', () => {
    const titles = ['Standing by.', 'Thinking.', 'Using a tool.', 'Responding.', 'Waiting.', 'Task complete.', 'Something went wrong.'];
    const activities = ['idle', 'thinking', 'tool-use', 'responding', 'waiting', 'completed', 'error'] as const;
    activities.forEach((activity, i) => {
      const html = renderDisplay({ ...initialState(), activity, progress: 100 });
      expect(html).toContain(titles[i]);
    });
    expect(renderDisplay({ ...initialState(), progress: null })).not.toContain('display-progress');
    expect(renderDisplay(initialState())).toContain('64% progress');
  });

  it('supports both display styles and a disconnected status', () => {
    expect(renderDisplay({ ...initialState(), displayStyle: 'quiet' })).toContain('display--quiet');
    expect(renderDisplay({ ...initialState(), displayStyle: 'ambient' })).toContain('display--ambient');
    expect(renderDisplay(initialState(), true, false)).toContain('Connection lost');
  });
});
