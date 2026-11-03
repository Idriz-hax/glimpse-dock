import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../server/server.ts';

const ORIGIN = { origin: 'http://localhost:80' };
function fakes() {
  let nextId = 0;
  return {
    hermes: { createSession: vi.fn(async () => `private-session-${++nextId}`) },
    wyoming: {
      listWakeModels: vi.fn(async () => [{ name: 'hey_hermes', phrase: 'Hey Hermes' }, { name: 'computer', phrase: 'Computer' }]),
      listVoices: vi.fn(async () => ['en_US-lessac-medium', 'en_US-amy-medium']),
    },
  };
}
async function owner(app: Awaited<ReturnType<typeof createServer>>) {
  const response = await app.inject({ method: 'POST', url: '/api/setup', headers: ORIGIN, payload: { secret: 'bootstrap', password: 'long-enough-password' } });
  return { cookie: String(response.headers['set-cookie']).split(';')[0]!, csrf: response.json().csrf };
}

describe('owner voice REST routes', () => {
  let app: Awaited<ReturnType<typeof createServer>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('returns owner-only redacted readiness and installed model/voice names', async () => {
    vi.stubEnv('HERMES_API_SERVER_URL', 'http://127.0.0.1:9987');
    vi.stubEnv('HERMES_API_SERVER_KEY', 'test-server-secret');
    const clients = fakes();
    app = await createServer({ database: ':memory:', bootstrapSecret: 'bootstrap', voiceClients: clients });
    const session = await owner(app);
    const response = await app.inject({ url: '/api/voice/status', headers: { cookie: session.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ availability: { hermes: true, wyoming: true }, wakeModels: ['hey_hermes', 'computer'], voices: ['en_US-lessac-medium', 'en_US-amy-medium'] });
    const raw = response.body;
    expect(raw).not.toContain('private-session');
    expect(raw).not.toContain('test-server-secret');
    expect(raw).not.toContain('127.0.0.1:9987');
    expect((await app.inject({ url: '/api/voice/status' })).statusCode).toBe(403);
  });

  it('stores validated non-secret preferences and rejects unknown model, voice, or malformed settings', async () => {
    const clients = fakes();
    app = await createServer({ database: ':memory:', bootstrapSecret: 'bootstrap', voiceClients: clients });
    const session = await owner(app);
    const save = (payload: object) => app!.inject({ method: 'POST', url: '/api/voice/settings', headers: { ...ORIGIN, cookie: session.cookie }, payload: { csrf: session.csrf, ...payload } });
    expect((await save({ enabled: true, wakeModel: 'hey_hermes', voice: 'en_US-lessac-medium' })).statusCode).toBe(200);
    expect((await save({ enabled: true, wakeModel: 'unknown', voice: 'en_US-lessac-medium' })).statusCode).toBe(400);
    expect((await save({ enabled: true, wakeModel: 'hey_hermes', voice: 'unknown' })).statusCode).toBe(400);
    expect((await save({ enabled: 'yes', wakeModel: 'hey_hermes', voice: 'en_US-lessac-medium' })).statusCode).toBe(400);
    expect(clients.wyoming.listWakeModels).toHaveBeenCalled();
    expect(clients.wyoming.listVoices).toHaveBeenCalled();
  });

  it('requires owner, same-loopback Origin, and CSRF before calling voice clients', async () => {
    const clients = fakes();
    app = await createServer({ database: ':memory:', bootstrapSecret: 'bootstrap', voiceClients: clients });
    const session = await owner(app);
    const payload = { enabled: true, wakeModel: 'hey_hermes', voice: 'en_US-lessac-medium' };
    expect((await app.inject({ method: 'POST', url: '/api/voice/settings', headers: { cookie: session.cookie, origin: 'http://evil.example' }, payload: { csrf: session.csrf, ...payload } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/voice/settings', headers: { ...ORIGIN, cookie: session.cookie }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/voice/session', headers: { ...ORIGIN, authorization: 'Bearer agent-secret' }, payload: { csrf: session.csrf } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/voice/session/reset', headers: { ...ORIGIN, cookie: session.cookie }, payload: {} })).statusCode).toBe(403);
    expect(clients.hermes.createSession).not.toHaveBeenCalled();
    expect(clients.wyoming.listWakeModels).not.toHaveBeenCalled();
    expect(clients.wyoming.listVoices).not.toHaveBeenCalled();
  });

  it('allows only owner cookie for settings and rejects paired displays before voice calls', async () => {
    const clients = fakes();
    app = await createServer({ database: ':memory:', bootstrapSecret: 'bootstrap', voiceClients: clients });
    const session = await owner(app);
    const pair = await app.inject({ method: 'POST', url: '/api/display/pair', headers: { ...ORIGIN, cookie: session.cookie }, payload: { csrf: session.csrf } });
    const display = await app.inject({ method: 'POST', url: '/api/display/redeem', headers: ORIGIN, payload: { code: pair.json().code } });
    const displayCookie = String(display.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ url: '/api/voice/status', headers: { cookie: displayCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/voice/settings', headers: { ...ORIGIN, cookie: displayCookie }, payload: { csrf: display.json().csrf, enabled: true, wakeModel: 'hey_hermes', voice: 'en_US-lessac-medium' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/voice/session/reset', headers: { ...ORIGIN, cookie: displayCookie }, payload: { csrf: display.json().csrf } })).statusCode).toBe(403);
    expect(clients.hermes.createSession).not.toHaveBeenCalled();
    expect(clients.wyoming.listWakeModels).not.toHaveBeenCalled();
  });

  it('creates and reuses one private Hermes session; reset replaces it without exposing IDs', async () => {
    const clients = fakes();
    app = await createServer({ database: ':memory:', bootstrapSecret: 'bootstrap', voiceClients: clients });
    const session = await owner(app);
    const post = () => app!.inject({ method: 'POST', url: '/api/voice/session', headers: { ...ORIGIN, cookie: session.cookie }, payload: { csrf: session.csrf } });
    const first = await post(), second = await post();
    expect(first.json()).toEqual({ ready: true }); expect(second.json()).toEqual({ ready: true });
    expect(clients.hermes.createSession).toHaveBeenCalledTimes(1);
    const reset = await app.inject({ method: 'POST', url: '/api/voice/session/reset', headers: { ...ORIGIN, cookie: session.cookie }, payload: { csrf: session.csrf } });
    expect(reset.json()).toEqual({ ready: true });
    expect(clients.hermes.createSession).toHaveBeenCalledTimes(2);
    const state = await app.inject({ url: '/api/state', headers: { cookie: session.cookie } });
    for (const raw of [first.body, second.body, reset.body, state.body]) {
      expect(raw).not.toContain('private-session');
      expect(raw).not.toContain('private-run');
      expect(raw).not.toContain('HERMES_API_SERVER_KEY');
      expect(raw).not.toContain('127.0.0.1:8642');
    }
  });

  it('fails closed when server credentials or Wyoming endpoints are missing', async () => {
    vi.stubEnv('HERMES_API_SERVER_KEY', '');
    vi.stubEnv('HERMES_API_SERVER_URL', 'http://127.0.0.1:8642');
    vi.stubEnv('WYOMING_WAKE_URI', ''); vi.stubEnv('WYOMING_STT_URI', ''); vi.stubEnv('WYOMING_TTS_URI', '');
    app = await createServer({ database: ':memory:', bootstrapSecret: 'bootstrap' });
    const session = await owner(app);
    const status = await app.inject({ url: '/api/voice/status', headers: { cookie: session.cookie } });
    expect(status.json()).toMatchObject({ availability: { hermes: false, wyoming: false }, wakeModels: [], voices: [] });
    const response = await app.inject({ method: 'POST', url: '/api/voice/session', headers: { ...ORIGIN, cookie: session.cookie }, payload: { csrf: session.csrf } });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('8642');
  });
});
