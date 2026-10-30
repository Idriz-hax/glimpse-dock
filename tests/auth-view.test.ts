import { describe, expect, it } from 'vitest';
import { renderOwnerGate, renderDisplayGate } from '../src/auth/view';

describe('auth gate views', () => {
  it('renders labeled setup and login modes with safe feedback', () => {
    const html = renderOwnerGate({ mode: 'setup', error: '<script>bad</script>' });
    expect(html).toContain('name="secret"');
    expect(html).toContain('name="password"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(html).toContain('data-auth-mode="login"');
  });
  it('renders redeem form with persistent accessible feedback', () => {
    const html = renderDisplayGate({ error: 'Try again' });
    expect(html).toContain('name="code"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('Try again');
  });
});
