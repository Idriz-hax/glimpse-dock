import { describe, expect, it } from 'vitest';
import { bootstrapSession } from '../src/auth/bootstrap';

describe('local auto-access bootstrap', () => {
  it('checks the session first, bootstraps only when anonymous, then trusts only the refreshed session', async () => {
    const calls: string[] = [];
    const session = await bootstrapSession(async path => {
      calls.push(path);
      if (path === '/api/session') return calls.length === 1 ? { role: null, setupRequired: false } : { role: 'owner', csrf: 'server-csrf', ownerAutoAccess: true };
      return { role: 'owner', csrf: 'must-not-be-trusted' };
    });
    expect(calls).toEqual(['/api/session', '/api/local-auto-access', '/api/session']);
    expect(session).toMatchObject({ role: 'owner', csrf: 'server-csrf', ownerAutoAccess: true });
  });

  it('does not attempt auto-access for an existing authenticated session', async () => {
    const calls: string[] = [];
    const session = await bootstrapSession(async path => { calls.push(path); return { role: 'owner', ownerAutoAccess: false }; });
    expect(calls).toEqual(['/api/session']);
    expect(session.role).toBe('owner');
  });

  it('silently falls back to setup/login when the optional bootstrap route is rejected', async () => {
    const calls: string[] = [];
    const session = await bootstrapSession(async path => {
      calls.push(path);
      if (path === '/api/local-auto-access') throw new Error('403 Forbidden');
      return { role: null, setupRequired: true };
    });
    expect(calls).toEqual(['/api/session', '/api/local-auto-access']);
    expect(session).toMatchObject({ role: null, setupRequired: true });
  });
});
