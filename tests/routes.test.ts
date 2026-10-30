import { describe, expect, it } from 'vitest';
import { resolveRoute } from '../src/routes';

describe('resolveRoute', () => {
  it.each([
    ['/', 'display'],
    ['/admin', 'admin'],
    ['/display', 'display'],
    ['/admin/', 'admin'],
    ['/display/', 'display'],
  ] as const)('resolves %s to %s', (pathname, expected) => {
    expect(resolveRoute(pathname)).toBe(expected);
  });
});
