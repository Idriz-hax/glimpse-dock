import { describe, expect, it } from 'vitest';
import { initialState, loadState, maxLogId, validateState } from '../src/demo-state';

describe('demo state validation', () => {
  it('advances the local log id after receiving newer synchronized logs', () => {
    expect(maxLogId([{ id: 12 }], 3)).toBe(12);
    expect(maxLogId([{ id: 2 }], 12)).toBe(12);
  });

  it('restores valid saved state', () => {
    const saved = { ...initialState(), progress: 42, widgets: [{ id: 'x', label: 'X', value: '1', sub: 's', tone: 'cyan' }], logs: [{ id: 2, time: 'now', title: 't', detail: 'd', level: 'warning' }] };
    expect(loadState(JSON.stringify(saved))).toMatchObject({ progress: 42, widgets: [{ version: 1, id: 'x', owner: 'owner', title: 'X', content: { kind: 'metric', value: '1', caption: 's' }, placement: 'secondary' }], logs: saved.logs });
  });

  it('normalizes saved legacy widgets and preserves their display text', () => {
    const saved = { ...initialState(), widgets: [{ id: 'old', label: 'Old label', value: '7', sub: 'Old info', tone: 'cyan' }] };
    expect(loadState(JSON.stringify(saved)).widgets[0]).toEqual({ version: 1, id: 'old', owner: 'owner', title: 'Old label', content: { kind: 'metric', label: 'Old label', value: '7', caption: 'Old info' }, placement: 'secondary', visible: true, createdAt: 0, updatedAt: 0, expiresAt: null });
  });

  it('falls back to defaults for malformed JSON or invalid state', () => {
    expect(loadState('{')).toEqual(initialState());
    expect(loadState(JSON.stringify({ ...initialState(), progress: 101 }))).toEqual(initialState());
  });

  it('preserves seeded fallback state when saved data is absent or invalid', () => {
    const fallback = { ...initialState(), logs: [{ id: 1, time: 'now', title: 'seed', detail: 'seeded log', level: 'success' as const }] };
    expect(loadState(null, fallback)).toEqual(fallback);
    expect(loadState('{', fallback)).toEqual(fallback);
  });

  it('normalizes valid persisted agent strings to the demo agent', () => {
    const saved = { ...initialState(), agent: 'other agent' };
    expect(loadState(JSON.stringify(saved)).agent).toBe('Hermes (Demo)');
  });

  it('adds activity and display defaults to older saved states', () => {
    const { activity: _activity, displayStyle: _style, ...oldState } = initialState();
    expect(loadState(JSON.stringify(oldState))).toMatchObject({ activity: 'idle', displayStyle: 'quiet' });
  });

  it('rejects more than 40 persisted log entries', () => {
    const state = initialState();
    const logs = Array.from({ length: 41 }, (_, id) => ({ id, time: '', title: '', detail: '', level: 'info' as const }));
    expect(validateState({ ...state, logs })).toBeNull();
  });

  it('rejects invalid nested entries, enums, runtime types, progress, and unsafe log IDs', () => {
    const state = initialState();
    expect(validateState({ ...state, widgets: [{ ...state.widgets[0], tone: 'red' }] })).toBeNull();
    expect(validateState({ ...state, logs: [{ id: 1, time: '', title: '', detail: '', level: 'debug' }] })).toBeNull();
    expect(validateState({ ...state, running: 'yes' })).toBeNull();
    expect(validateState({ ...state, agent: 1 })).toBeNull();
    expect(validateState({ ...state, task: null })).toBeNull();
    for (const progress of [NaN, Infinity, -1, 101]) expect(validateState({ ...state, progress })).toBeNull();
    for (const id of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(validateState({ ...state, logs: [{ ...state.logs[0], id }] })).toBeNull();
  });
});
