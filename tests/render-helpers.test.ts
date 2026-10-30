import { describe, expect, it } from 'vitest';
import { escapeHTML, safeProgress } from '../src/shared/render-helpers';

describe('render boundaries', () => {
  it('escapes HTML text and attribute delimiters', () => {
    expect(escapeHTML(`<img src="x" onerror='x'>&`)).toBe('&lt;img src=&quot;x&quot; onerror=&#39;x&#39;&gt;&amp;');
  });
  it('accepts only finite progress in range', () => {
    expect([0, 64, 100].map(safeProgress)).toEqual([0, 64, 100]);
    for (const value of [-1, 101, Infinity, NaN]) expect(() => safeProgress(value)).toThrow();
  });
});
