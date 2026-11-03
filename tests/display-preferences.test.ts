import { describe, expect, it } from 'vitest';
import { initialState, loadState } from '../src/demo-state';
import { DisplayPreferencesSchema, ProtocolStateSchema } from '../src/shared/protocol';

const defaults = { scale: 'normal', reducedMotion: false, intensity: 'balanced', showClock: true, showWidgets: true, layout: 'balanced' } as const;

describe('display preferences', () => {
  it('uses the documented defaults', () => {
    expect(DisplayPreferencesSchema.parse({})).toEqual(defaults);
    expect(initialState().displayPreferences).toEqual(defaults);
  });

  it('accepts valid preferences and rejects invalid or unknown input', () => {
    expect(DisplayPreferencesSchema.safeParse({ ...defaults, scale: 'large', reducedMotion: true, intensity: 'vivid', layout: 'compact' }).success).toBe(true);
    expect(DisplayPreferencesSchema.safeParse({ ...defaults, scale: 'huge' }).success).toBe(false);
    expect(DisplayPreferencesSchema.safeParse({ ...defaults, reducedMotion: 'no' }).success).toBe(false);
    expect(DisplayPreferencesSchema.safeParse({ ...defaults, extra: true }).success).toBe(false);
  });

  it('defaults preferences when reading a legacy snapshot', () => {
    const { displayPreferences: _preferences, ...legacyState } = initialState();
    expect(ProtocolStateSchema.parse(legacyState).displayPreferences).toEqual(defaults);
  });

  it('defaults absent preferences in persisted snapshots and rejects malformed preferences', () => {
    const { displayPreferences: _preferences, ...legacy } = initialState();
    expect(loadState(JSON.stringify(legacy)).displayPreferences).toEqual(defaults);
    const fallback = { ...initialState(), task: 'fallback sentinel' };
    for (const displayPreferences of [{ ...defaults, scale: 'enormous' }, { ...defaults, extra: true }, null]) {
      expect(loadState(JSON.stringify({ ...initialState(), displayPreferences }), fallback)).toEqual(fallback);
    }
  });
});
