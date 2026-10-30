import { describe, expect, it } from 'vitest';
import { commandForInput, parseStateMessage } from './frontend-client';

describe('frontend protocol helpers', () => {
  it('maps parser commands without changing text into markup', () => {
    expect(commandForInput('set tasks to 12', 'request')).toMatchObject({ type: 'metric.set-value', payload: { id: 'tasks', value: 12 } });
    expect(commandForInput('complete task', 'request')).toMatchObject({ type: 'task.complete' });
    expect(commandForInput('set progress to 42', 'request')).toMatchObject({ type: 'state.set-progress', payload: { progress: 42 } });
  });
  it('rejects malformed or incomplete snapshots', () => {
    expect(parseStateMessage({ v: 1, type: 'snapshot', revision: 0, source: 'owner', state: {} })).toBeNull();
  });
});
