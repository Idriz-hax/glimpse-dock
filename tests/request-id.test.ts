import { describe, expect, it } from 'vitest';
import { requestId } from '../src/request-id';

describe('requestId', () => {
  it('uses a non-secret fallback when secure-context UUID is unavailable', () => {
    expect(requestId({} as Crypto)).toMatch(/^req-[a-z0-9]+-[a-z0-9]+$/);
  });
});
