import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../server/server.ts';
import { ErrorResponseSchema } from '../src/shared/protocol.ts';

describe('backend', () => {
  let app: Awaited<ReturnType<typeof createServer>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });
  it('serves health and requires out-of-band bootstrap setup', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'test-secret' });
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/setup', payload: { secret: 'wrong', password: 'password123' } })).statusCode).toBe(403);
  });
  it('requires authentication for mutation', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'test-secret' });
    const result = await app.inject({ method: 'POST', url: '/api/command', payload: { v: 1, requestId: 'x', type: 'task.update', payload: { task: 'bad' } } });
    expect(result.statusCode).toBe(401);
  });
  it('returns structured versioned protocol errors for invalid input', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'test-secret' });
    const response = await app.inject({ method: 'POST', url: '/api/setup', headers: { origin: 'http://localhost:80' }, payload: { secret: 'test-secret', password: 'weak' } });
    expect(ErrorResponseSchema.safeParse(response.json()).success).toBe(true);
  });
  it('exposes only the current browser role and CSRF token for the session', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'test-secret' });
    expect((await app.inject('/api/session')).json()).toMatchObject({ role: null, demoEnabled: false, setupRequired: true });
    const setup = await app.inject({ method: 'POST', url: '/api/setup', headers: { origin: 'http://localhost:80' }, payload: { secret: 'test-secret', password: 'long-enough-password' } });
    const cookie = String(setup.headers['set-cookie']).split(';')[0];
    const session = (await app.inject({ url: '/api/session', headers: { cookie } })).json();
    expect(session.role).toBe('owner');
    expect(session.csrf).toBe(setup.json().csrf);
  });
  it('rejects weak setup passwords and requests without an exact browser Origin', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'test-secret' });
    expect((await app.inject({method:'POST',url:'/api/setup',headers:{origin:'http://localhost:80'},payload:{secret:'test-secret',password:'weak'}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/setup',headers:{origin:'http://evil.test'},payload:{secret:'test-secret',password:'long-enough-password'}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/setup',payload:{secret:'test-secret',password:'long-enough-password'}})).statusCode).toBe(403);
  });
  it('rejects ambiguous agent and owner credentials', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'test-secret' });
    const setup=await app.inject({method:'POST',url:'/api/setup',headers:{origin:'http://localhost:80'},payload:{secret:'test-secret',password:'long-enough-password'}});
    const cookie=String(setup.headers['set-cookie']).split(';')[0];
    const agent=await app.inject({method:'POST',url:'/api/agents',headers:{cookie,origin:'http://localhost:80'},payload:{csrf:setup.json().csrf}});
    expect(agent.statusCode).toBe(200);
    const result=await app.inject({method:'POST',url:'/api/command',headers:{cookie,authorization:`Bearer ${agent.json().secret}`,origin:'http://localhost:80'},payload:{csrf:setup.json().csrf,v:1,requestId:'x',type:'task.update',payload:{task:'x'}}});
    expect(result.statusCode).toBe(403);
  });
  it('rejects a matching attacker Origin and Host on owner mutation routes', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'test-secret' });
    const setup = await app.inject({ method: 'POST', url: '/api/setup', headers: { origin: 'http://localhost:80' }, payload: { secret: 'test-secret', password: 'long-enough-password' } });
    const cookie = String(setup.headers['set-cookie']).split(';')[0];
    const result = await app.inject({ method: 'POST', url: '/api/command', headers: { cookie, origin: 'http://attacker.test', host: 'attacker.test' }, payload: { csrf: setup.json().csrf, v: 1, requestId: 'origin', type: 'task.update', payload: { task: 'cross-site' } } });
    expect(result.statusCode).toBe(403);
  });
  it('keeps fake activity disabled by default and runs Demo commands only when explicitly enabled', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'test-secret' });
    const setup = await app.inject({ method: 'POST', url: '/api/setup', headers: { origin: 'http://localhost:80' }, payload: { secret: 'test-secret', password: 'long-enough-password' } });
    const cookie = String(setup.headers['set-cookie']).split(';')[0];
    const denied = await app.inject({ method: 'POST', url: '/api/command', headers: { cookie, origin: 'http://localhost:80' }, payload: { csrf: setup.json().csrf, v: 1, requestId: 'demo-disabled', type: 'demo.simulate', payload: {} } });
    expect(denied.statusCode).toBe(403);
    expect((await app.inject({ url: '/api/state', headers: { cookie } })).json().state.agent).toBe('');
    await app.close();

    app = await createServer({ database: ':memory:', bootstrapSecret: 'test-secret', demo: true });
    const demoSetup = await app.inject({ method: 'POST', url: '/api/setup', headers: { origin: 'http://localhost:80' }, payload: { secret: 'test-secret', password: 'long-enough-password' } });
    const demoCookie = String(demoSetup.headers['set-cookie']).split(';')[0];
    const demoState = (await app.inject({ url: '/api/state', headers: { cookie: demoCookie } })).json();
    expect(demoState).toMatchObject({ source: 'demo', state: { agent: 'Hermes (Demo)' } });
    expect(demoState.state.logs[0].title).toBe('Connection established');
  });
  it('applies allowlisted metric commands instead of accepting them as no-ops', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'test-secret', demo: true });
    const setup = await app.inject({ method: 'POST', url: '/api/setup', headers: { origin: 'http://localhost:80' }, payload: { secret: 'test-secret', password: 'long-enough-password' } });
    const cookie = String(setup.headers['set-cookie']).split(';')[0];
    const result = await app.inject({ method: 'POST', url: '/api/command', headers: { cookie, origin: 'http://localhost:80' }, payload: { csrf: setup.json().csrf, v: 1, requestId: 'metric', type: 'metric.set-value', payload: { id: 'tasks', value: 45 } } });
    expect(result.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/state', headers: { cookie } })).json().state.widgets.find((widget: {id:string}) => widget.id === 'tasks').value).toBe('45');
  });
  it('persists accepted commands before reporting success and denies display writes', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'test-secret' });
    const setup = await app.inject({ method: 'POST', url: '/api/setup', headers: { origin: 'http://localhost:80' }, payload: { secret: 'test-secret', password: 'long-enough-password' } });
    expect(setup.statusCode).toBe(200);
    const cookie = String(setup.headers['set-cookie']).split(';')[0];
    const csrf = setup.json().csrf;
    const write = await app.inject({ method: 'POST', url: '/api/command', headers: { cookie, origin: 'http://localhost:80' }, payload: { csrf, v: 1, requestId: 'one', type: 'task.update', payload: { task: 'persisted' } } });
    expect(write.statusCode).toBe(200);
    const state = await app.inject({ url: '/api/state', headers: { cookie } });
    expect(state.json().state.task).toBe('persisted');
    expect(state.json().revision).toBe(1);
    const paired = await app.inject({ method: 'POST', url: '/api/display/pair', headers: { cookie, origin:'http://localhost:80' }, payload: { csrf } });
    expect(paired.headers['set-cookie']).toBeUndefined();
    const redeemed=await app.inject({method:'POST',url:'/api/display/redeem',headers:{origin:'http://localhost:80'},payload:{code:paired.json().code}});
    const displayCookie = String(redeemed.headers['set-cookie']).split(';')[0];
    const denied = await app.inject({ method: 'POST', url: '/api/command', headers: { cookie: displayCookie, origin: 'http://localhost:80' }, payload: { csrf: redeemed.json().csrf, v: 1, requestId: 'two', type: 'task.update', payload: { task: 'nope' } } });
    expect(denied.statusCode).toBe(403);
    expect((await app.inject({ url: '/api/state', headers: { cookie: displayCookie } })).statusCode).toBe(200);
  });
});
