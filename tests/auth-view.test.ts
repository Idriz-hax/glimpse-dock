import { describe, expect, it } from 'vitest';
import { renderOwnerGate, renderDisplayGate, renderRestoredOwnerConsent } from '../src/auth/view';

describe('auth gate views', () => {
  it('renders labeled setup and login modes with safe feedback', () => {
    const html = renderOwnerGate({ mode: 'setup', error: '<script>bad</script>' });
    expect(html).toContain('name="secret"');
    expect(html).toContain('name="password"');
    expect(html).toContain('name="username"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(html).toContain('data-auth-mode="login"');
  });
  it('renders username for login and the legacy identity upgrade', () => {
    expect(renderOwnerGate({ mode: 'login' })).toContain('name="username"');
    expect(renderOwnerGate({ mode: 'upgrade' } as any)).toContain('data-mode="upgrade"');
  });
  it('requires deliberate acknowledgement for LAN HTTP and displays its interception warning', () => {
    const html = renderOwnerGate({ mode:'login', transport:'http-insecure' } as any);
    expect(html).toContain('required');
    expect(html).toContain('credentials and session cookies can be intercepted');
    expect(html).toContain('HTTPS is recommended');
  });
  it('gates restored owners with an explicit unchecked consent before Admin access', () => {
    const html = renderRestoredOwnerConsent();
    expect(html).toContain('name="http-risk-acknowledged"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('type="button"');
    expect(html).toContain('disabled');
    expect(html).toContain('credentials and session cookies can be intercepted and replayed');
    expect(html).toContain('before continuing');
  });
  it('renders redeem form with persistent accessible feedback', () => {
    const html = renderDisplayGate({ error: 'Try again' });
    expect(html).toContain('name="code"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('Try again');
  });
});
