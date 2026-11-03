import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../server/server.ts';
import WebSocket from 'ws';

const ORIGIN = { origin: 'http://localhost:80' };
function fakes() {
  let nextId = 0;
  let nextRun = 0;
  return {
    hermes: {
      createSession: vi.fn(async () => `private-session-${++nextId}`),
      startRun: vi.fn(async () => ({ runId: `private-run-${++nextRun}` })),
      stopRun: vi.fn(async () => ({ status: 'stopping' })),
      readRunEvents: vi.fn(async (_id: string, _signal: AbortSignal, emit: (event: any) => void) => {
        emit({ type: 'message.delta', text: 'assistant delta' });
        emit({ type: 'run.completed', status: 'completed', output: 'spoken reply' });
      }),
    },
    wyoming: {
      listWakeModels: vi.fn(async () => [{ name: 'hey_hermes', phrase: 'Hey Hermes' }, { name: 'computer', phrase: 'Computer' }]),
      listVoices: vi.fn(async () => ['en_US-lessac-medium', 'en_US-amy-medium']),
      detectWake: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => 'private transcript'),
      synthesize: vi.fn(async () => ({ pcm: Buffer.from([1, 0, 2, 0]), rate: 16_000, width: 2, channels: 1 })),
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

describe('owner voice websocket route', () => {
  let app: Awaited<ReturnType<typeof createServer>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });
  it('delivers private owner turn events and one raw PCM frame, then resumes wake only after matching playback ack', async () => {
    const clients = fakes();
    app = await createServer({ database: ':memory:', bootstrapSecret: 'bootstrap', voiceClients: clients as any });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as import('node:net').AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const setup = await fetch(`${base}/api/setup`, { method:'POST', headers:{ origin:base, 'content-type':'application/json' }, body:JSON.stringify({ secret:'bootstrap', password:'long-enough-password' }) });
    const cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
    const csrf = (await setup.json() as any).csrf;
    const post = (url: string, payload: object) => fetch(`${base}${url}`, { method:'POST', headers:{ cookie, origin:base, 'content-type':'application/json' }, body:JSON.stringify({ csrf, ...payload }) });
    await post('/api/voice/settings', { enabled:true, wakeModel:'hey_hermes', voice:'en_US-lessac-medium' });
    await post('/api/voice/session', {});
    const pairResponse=await fetch(`${base}/api/display/pair`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({csrf})});
    const pair=await pairResponse.json() as any;
    const redeemed=await fetch(`${base}/api/display/redeem`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({code:pair.code})});
    const displayCookie=redeemed.headers.get('set-cookie')!.split(';')[0]!;
    const display=new WebSocket(`${base.replace('http:','ws:')}/api/stream`,{headers:{cookie:displayCookie,origin:base}});
    const displayFrames:string[]=[]; display.on('message',data=>displayFrames.push(data.toString()));
    await new Promise<void>((resolve,reject)=>{display.once('open',resolve);display.once('error',reject);});
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/api/voice/session`, { headers:{ cookie, origin:base } });
    const messages: Array<string|Buffer> = [];
    ws.on('message', data => messages.push(data as Buffer));
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const second=new WebSocket(`${base.replace('http:','ws:')}/api/voice/session`,{headers:{cookie,origin:base}});
    const secondStatus = await new Promise<number>(resolve => {
      second.once('unexpected-response', (_req, response) => { resolve(response.statusCode); response.resume(); });
      second.once('open', () => { second.close(); resolve(101); });
    });
    expect(secondStatus).toBe(409);
    ws.send(JSON.stringify({ type:'manual-start' })); ws.send(Buffer.from([3, 0]));
    const until = async (predicate: () => boolean) => { const end=Date.now()+2000; while(!predicate() && Date.now()<end) await new Promise(r=>setTimeout(r,10)); expect(predicate()).toBe(true); };
    await until(() => messages.some(m => Buffer.isBuffer(m) && m.equals(Buffer.from([1,0,2,0]))));
    const texts = messages.filter((m): m is Buffer => Buffer.isBuffer(m)).filter(m => m.length !== 4).map(m => m.toString());
    const events = texts.map(x => JSON.parse(x));
    expect(events.some(x => x.type==='transcript' && x.text==='private transcript')).toBe(true);
    expect(events.some(x => x.type==='assistant.delta' && x.text==='assistant delta')).toBe(true);
    expect(events.some(x => x.type==='tts-start')).toBe(true);
    expect(events.some(x => x.type==='tts-end')).toBe(true);
    expect(displayFrames).toHaveLength(1);
    expect(displayFrames.join()).not.toContain('private transcript');
    expect(displayFrames.join()).not.toContain('assistant delta');
    const speaking = events.findLast(x => x.type==='state' && x.phase==='speaking');
    ws.send(JSON.stringify({ type:'playback-ended', turn:speaking.turn }));
    await until(() => clients.wyoming.detectWake.mock.calls.length > 0);
    ws.close();
    display.close();
  });
  it('holds reset lease after socket close until remote run terminal event', async () => {
    const clients = fakes();
    let emit!: (event: any) => void;
    let finish!: () => void;
    let started!: () => void;
    const runStarted = new Promise<void>(resolve => { started=resolve; });
    const remoteDone = new Promise<void>(resolve => { finish=resolve; });
    clients.hermes.readRunEvents.mockImplementation(async (_id, _signal, callback) => { emit=callback; started(); await remoteDone; });
    app = await createServer({ database: ':memory:', bootstrapSecret: 'bootstrap', voiceClients: clients as any });
    await app.listen({ host:'127.0.0.1', port:0 });
    const address=app.server.address() as import('node:net').AddressInfo, base=`http://127.0.0.1:${address.port}`;
    const setup=await fetch(`${base}/api/setup`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({secret:'bootstrap',password:'long-enough-password'})});
    const cookie=setup.headers.get('set-cookie')!.split(';')[0]!, csrf=(await setup.json() as any).csrf;
    const post=(url:string,payload:object)=>fetch(`${base}${url}`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({csrf,...payload})});
    await post('/api/voice/settings',{enabled:true,wakeModel:'hey_hermes',voice:'en_US-lessac-medium'}); await post('/api/voice/session',{});
    const ws=new WebSocket(`${base.replace('http:','ws:')}/api/voice/session`,{headers:{cookie,origin:base}});
    await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    ws.send(JSON.stringify({type:'manual-start'})); ws.send(Buffer.from([1,0])); await runStarted;
    const closed=new Promise<void>(resolve=>ws.once('close',()=>resolve())); ws.close(); await closed;
    const reset=()=>post('/api/voice/session/reset',{});
    expect((await reset()).status).toBe(409);
    emit({type:'run.cancelled',status:'cancelled'}); finish();
    const deadline=Date.now()+1000; let response:Response;
    do { response=await reset(); if(response.status===200) break; await new Promise(r=>setTimeout(r,10)); } while(Date.now()<deadline);
    expect(response!.status).toBe(200);
  });
  it('closes the owner voice socket on logout and enforces the 16KiB inbound limit', async () => {
    const clients=fakes();
    app=await createServer({database:':memory:',bootstrapSecret:'bootstrap',voiceClients:clients as any});
    await app.listen({host:'127.0.0.1',port:0});
    const address=app.server.address() as import('node:net').AddressInfo, base=`http://127.0.0.1:${address.port}`;
    const setup=await fetch(`${base}/api/setup`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({secret:'bootstrap',password:'long-enough-password'})});
    const cookie=setup.headers.get('set-cookie')!.split(';')[0]!, csrf=(await setup.json() as any).csrf;
    const login=await fetch(`${base}/api/login`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({password:'long-enough-password'})});
    const secondCookie=login.headers.get('set-cookie')!.split(';')[0]!, secondCsrf=(await login.json() as any).csrf;
    const post=(url:string,payload:object)=>fetch(`${base}${url}`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({csrf,...payload})});
    await post('/api/voice/settings',{enabled:true,wakeModel:'hey_hermes',voice:'en_US-lessac-medium'}); await post('/api/voice/session',{});
    const ws=new WebSocket(`${base.replace('http:','ws:')}/api/voice/session`,{headers:{cookie,origin:base}});
    await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    const tooLarge=new Promise<number>(resolve=>ws.once('close',code=>resolve(code)));
    ws.send('x'.repeat(16_385));
    expect(await tooLarge).toBe(1009);
    const again=new WebSocket(`${base.replace('http:','ws:')}/api/voice/session`,{headers:{cookie,origin:base}});
    await new Promise<void>((resolve,reject)=>{again.once('open',resolve);again.once('error',reject);});
    const closed=new Promise<number>(resolve=>again.once('close',code=>resolve(code)));
    await post('/api/logout',{});
    expect(await closed).toBe(1008);
    const revoked=new WebSocket(`${base.replace('http:','ws:')}/api/voice/session`,{headers:{cookie:secondCookie,origin:base}});
    await new Promise<void>((resolve,reject)=>{revoked.once('open',resolve);revoked.once('error',reject);});
    const revokeClose=new Promise<number>(resolve=>revoked.once('close',code=>resolve(code)));
    const sessions=await fetch(`${base}/api/sessions`,{headers:{cookie:secondCookie}});
    const own=(await sessions.json() as any).sessions.find((s:any)=>s.role==='owner');
    await fetch(`${base}/api/sessions/${own.id}`,{method:'DELETE',headers:{cookie:secondCookie,origin:base,'content-type':'application/json'},body:JSON.stringify({csrf:secondCsrf})});
    expect(await revokeClose).toBe(1008);
    expect(clients.wyoming.transcribe).not.toHaveBeenCalled();
  });
  it('closes an owner socket when the expiry deadline is already due', async () => {
    const clients=fakes();
    app=await createServer({database:':memory:',bootstrapSecret:'bootstrap',voiceClients:clients as any,now:()=>Date.now()+86_400_001});
    await app.listen({host:'127.0.0.1',port:0});
    const address=app.server.address() as import('node:net').AddressInfo, base=`http://127.0.0.1:${address.port}`;
    const setup=await fetch(`${base}/api/setup`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({secret:'bootstrap',password:'long-enough-password'})});
    const cookie=setup.headers.get('set-cookie')!.split(';')[0]!, csrf=(await setup.json() as any).csrf;
    const post=(url:string,payload:object)=>fetch(`${base}${url}`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({csrf,...payload})});
    await post('/api/voice/settings',{enabled:true,wakeModel:'hey_hermes',voice:'en_US-lessac-medium'}); await post('/api/voice/session',{});
    const ws=new WebSocket(`${base.replace('http:','ws:')}/api/voice/session`,{headers:{cookie,origin:base}});
    await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    expect(await new Promise<number>(resolve=>ws.once('close',code=>resolve(code)))).toBe(1008);
  });
  it('rejects missing owner and non-loopback origins before voice clients are called', async () => {
    const clients = fakes();
    app = await createServer({ database: ':memory:', bootstrapSecret: 'bootstrap', voiceClients: clients as any });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as import('node:net').AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const attempt = (headers: Record<string,string>) => new Promise<number>(resolve => {
      const ws = new WebSocket(`${base.replace('http:', 'ws:')}/api/voice/session`, { headers });
      ws.once('unexpected-response', (_req, res) => { resolve(res.statusCode ?? 0); res.resume(); });
      ws.once('close', code => resolve(code));
    });
    expect(await attempt({ origin: base })).toBe(403);
    const setup = await fetch(`${base}/api/setup`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ secret:'bootstrap', password:'long-enough-password' }) });
    const cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
    const csrf = (await setup.json() as any).csrf;
    expect(await attempt({ cookie, origin: 'http://evil.example' })).toBe(403);
    const pairResponse=await fetch(`${base}/api/display/pair`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({csrf})});
    const pair=await pairResponse.json() as any;
    const redeemed=await fetch(`${base}/api/display/redeem`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({code:pair.code})});
    const displayCookie=redeemed.headers.get('set-cookie')!.split(';')[0]!;
    expect(await attempt({cookie:displayCookie,origin:base})).toBe(403);
    expect(clients.hermes.createSession).not.toHaveBeenCalled();
    expect(clients.wyoming.listWakeModels).not.toHaveBeenCalled();
  });
});
