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
      expect(html).toContain('width:0%');
      expect(html).toContain('0% progress');
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('Infinity');
    }
  });
});
