import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import { createServer } from '../server/server.ts';
import { createDemoState } from '../server/adapters/demo.ts';

describe('backend persistence and websocket integration', () => {
  let app: Awaited<ReturnType<typeof createServer>> | undefined;
  let directory: string | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function start(database: string) {
    app = await createServer({ database, bootstrapSecret: 'test-secret' });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    return `http://127.0.0.1:${address.port}`;
  }

  async function setup(base: string) {
    const response = await fetch(`${base}/api/setup`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ secret: 'test-secret', password: 'long-enough-password' }),
    });
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    return { cookie, csrf: (await response.json() as { csrf: string }).csrf };
  }

  function receive(socket: WebSocket) {
    return new Promise<Record<string, any>>((resolve, reject) => {
      socket.once('message', data => resolve(JSON.parse(data.toString())));
      socket.once('error', reject);
    });
  }

  it('restores accepted state and revision after reopening the SQLite database', async () => {
    directory = await mkdtemp(join(tmpdir(), 'glimpse-backend-'));
    const database = join(directory, 'state.sqlite');
    let base = await start(database);
    const { cookie, csrf } = await setup(base);
    const write = await fetch(`${base}/api/command`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ csrf, v: 1, requestId: 'persist', type: 'task.update', payload: { task: 'survives restart' } }),
    });
    expect(write.status).toBe(200);
    await app!.close();
    app = undefined;

    base = await start(database);
    const login = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ password: 'long-enough-password' }),
    });
    const loginCookie = login.headers.get('set-cookie')!.split(';')[0];
    const restored = await fetch(`${base}/api/state`, { headers: { cookie: loginCookie } });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ revision: 1, state: { task: 'survives restart' } });
  });

  it('backfills a legacy agent identity transactionally and keeps it stable on restart', async () => {
    directory = await mkdtemp(join(tmpdir(), 'glimpse-backend-'));
    const database = join(directory, 'legacy.sqlite');
    const legacy = new Database(database);
    legacy.exec("CREATE TABLE agents (digest TEXT PRIMARY KEY, revoked INTEGER NOT NULL DEFAULT 0); INSERT INTO agents(digest,revoked) VALUES ('legacy-digest',0);");
    legacy.close();
    app = await createServer({ database });
    const db = new Database(database);
    const id = (db.prepare('SELECT agent_id FROM agents WHERE digest=?').get('legacy-digest') as { agent_id: string }).agent_id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((db.prepare('SELECT version FROM schema_migrations WHERE version=2').get() as { version: number }).version).toBe(2);
    db.close();
    await app.close(); app = undefined;
    app = await createServer({ database });
    const reopened = new Database(database);
    expect((reopened.prepare('SELECT agent_id FROM agents WHERE digest=?').get('legacy-digest') as { agent_id: string }).agent_id).toBe(id);
    reopened.close();
  });

  it('cleans expired widgets at startup using the injected clock and commits once', async () => {
    directory = await mkdtemp(join(tmpdir(), 'glimpse-backend-'));
    const database = join(directory, 'expiry.sqlite');
    const seeded = createDemoState();
    seeded.widgets[0].expiresAt = 99;
    const db = new Database(database);
    db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const put = db.prepare('INSERT INTO kv(key,value) VALUES (?,?)');
    put.run('state', JSON.stringify(seeded)); put.run('revision', '4'); put.run('source', 'demo'); db.close();
    app = await createServer({ database, now: () => 100 });
    const check = new Database(database);
    expect(JSON.parse((check.prepare("SELECT value FROM kv WHERE key='state'").get() as { value: string }).value).widgets.map((widget: { id: string }) => widget.id)).toEqual(['tools', 'runtime']);
    expect((check.prepare("SELECT value FROM kv WHERE key='revision'").get() as { value: string }).value).toBe('5');
    check.close();
  });

  it('persists display style across restart and broadcasts the style transition', async () => {
    directory = await mkdtemp(join(tmpdir(), 'glimpse-backend-'));
    const database = join(directory, 'state.sqlite');
    const base = await start(database);
    const { cookie, csrf } = await setup(base);
    const socket = new WebSocket(`${base.replace('http:', 'ws:')}/api/stream`, { headers: { cookie, origin: base } });
    const initialMessage = receive(socket);
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await initialMessage;
    const broadcast = receive(socket);
    const response = await fetch(`${base}/api/command`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ csrf, v: 1, requestId: 'style', type: 'display.set-style', payload: { style: 'ambient' } }),
    });
    expect(response.status).toBe(200);
    expect(await broadcast).toMatchObject({ type: 'state', revision: 1, state: { displayStyle: 'ambient' } });
    const socketClosed = new Promise<void>(resolve => socket.once('close', () => resolve()));
    socket.close();
    await socketClosed;
    await app!.close();
    app = undefined;

    const restarted = await start(database);
    const login = await fetch(`${restarted}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: restarted },
      body: JSON.stringify({ password: 'long-enough-password' }),
    });
    const loginCookie = login.headers.get('set-cookie')!.split(';')[0];
    const restored = await fetch(`${restarted}/api/state`, { headers: { cookie: loginCookie } });
    expect(await restored.json()).toMatchObject({ revision: 1, state: { displayStyle: 'ambient' } });
  });

  it('persists owner display preferences across restart', async () => {
    directory = await mkdtemp(join(tmpdir(), 'glimpse-backend-'));
    const database = join(directory, 'preferences.sqlite');
    let base = await start(database);
    const { cookie, csrf } = await setup(base);
    const preferences = { scale: 'large', reducedMotion: true, intensity: 'vivid', showClock: false, showWidgets: false, layout: 'compact' };
    const write = await fetch(`${base}/api/command`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ csrf, v: 1, requestId: 'prefs-save', type: 'display.preferences.set', payload: { preferences } }) });
    expect(write.status).toBe(200);
    await app!.close(); app = undefined;
    base = await start(database);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: 'long-enough-password' }) });
    const restored = await fetch(`${base}/api/state`, { headers: { cookie: login.headers.get('set-cookie')!.split(';')[0] } });
    expect(await restored.json()).toMatchObject({ revision: 1, state: { displayPreferences: preferences } });
  });

  it('broadcasts preference changes to an authorized paired display', async () => {
    directory = await mkdtemp(join(tmpdir(), 'glimpse-backend-'));
    const base = await start(join(directory, 'paired.sqlite'));
    const owner = await setup(base);
    const pair = await fetch(`${base}/api/display/pair`, { method: 'POST', headers: { cookie: owner.cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ csrf: owner.csrf }) });
    const redeemed = await fetch(`${base}/api/display/redeem`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ code: (await pair.json() as {code:string}).code }) });
    const displayCookie = redeemed.headers.get('set-cookie')!.split(';')[0];
    const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/stream', { headers: { cookie: displayCookie, origin: base } });
    const initial = receive(socket);
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await initial;
    const update = receive(socket);
    const preferences = { scale: 'compact', reducedMotion: true, intensity: 'subtle', showClock: true, showWidgets: false, layout: 'compact' };
    const response = await fetch(`${base}/api/command`, { method: 'POST', headers: { cookie: owner.cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ csrf: owner.csrf, v: 1, requestId: 'paired-prefs', type: 'display.preferences.set', payload: { preferences } }) });
    expect(response.status).toBe(200);
    expect(await update).toMatchObject({ type: 'state', revision: 1, state: { displayPreferences: preferences } });
    const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
    socket.close();
    await closed;
  });

  it('does not report or publish a state transition when the SQLite transaction fails', async () => {
    directory = await mkdtemp(join(tmpdir(), 'glimpse-backend-'));
    const database = join(directory, 'state.sqlite');
    const base = await start(database);
    const { cookie, csrf } = await setup(base);
    const pair = await fetch(`${base}/api/display/pair`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ csrf }) });
    const redeemed = await fetch(`${base}/api/display/redeem`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ code: (await pair.json() as { code: string }).code }) });
    const displayCookie = redeemed.headers.get('set-cookie')!.split(';')[0];
    const socket = new WebSocket(`${base.replace('http:', 'ws:')}/api/stream`, { headers: { cookie: displayCookie, origin: base } });
    const initialSnapshot = receive(socket);
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    expect(await initialSnapshot).toMatchObject({ type: 'snapshot', revision: 0 });
    const transitions: Record<string, any>[] = [];
    socket.on('message', data => transitions.push(JSON.parse(data.toString())));
    const sabotage = new Database(database);
    sabotage.exec("CREATE TRIGGER fail_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'forced write failure'); END;");
    const response = await fetch(`${base}/api/command`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ csrf, v: 1, requestId: 'failure', type: 'display.preferences.set', payload: { preferences: { scale: 'large', reducedMotion: true, intensity: 'vivid', showClock: false, showWidgets: false, layout: 'compact' } } }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'PERSISTENCE_FAILED' } });
    const snapshot = await fetch(`${base}/api/state`, { headers: { cookie } });
    expect(await snapshot.json()).toMatchObject({ revision: 0, state: { task: '', displayPreferences: { scale: 'normal' } } });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(transitions).toEqual([]);
    const socketClosed = new Promise<void>(resolve => socket.once('close', () => resolve()));
    socket.close();
    await socketClosed;
    sabotage.close();
  });

  it('sends the initial snapshot, fans out an authenticated command, and snapshots latest state on reconnect', async () => {
    directory = await mkdtemp(join(tmpdir(), 'glimpse-backend-'));
    const base = await start(join(directory, 'state.sqlite'));
    const { cookie, csrf } = await setup(base);
    const url = base.replace('http:', 'ws:') + '/api/stream';
    const connect = () => new WebSocket(url, { headers: { cookie, origin: base } });
    const socket = connect();
    const initialMessage = receive(socket);
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const initial = await initialMessage;
    expect(initial).toMatchObject({ type: 'snapshot', revision: 0, state: { task: '' } });
    const secondSocket = connect();
    const secondInitial = receive(secondSocket);
    await new Promise<void>((resolve, reject) => { secondSocket.once('open', resolve); secondSocket.once('error', reject); });
    expect(await secondInitial).toMatchObject({ type: 'snapshot', revision: 0, state: { task: '' } });

    const fanoutMessage = receive(socket);
    const secondFanoutMessage = receive(secondSocket);
    const write = await fetch(`${base}/api/command`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ csrf, v: 1, requestId: 'fanout', type: 'task.update', payload: { task: 'latest task' } }),
    });
    expect(write.status).toBe(200);
    expect(await fanoutMessage).toMatchObject({ type: 'state', revision: 1, state: { task: 'latest task' } });
    expect(await secondFanoutMessage).toMatchObject({ type: 'state', revision: 1, state: { task: 'latest task' } });
    const socketClosed = new Promise<void>(resolve => socket.once('close', () => resolve()));
    socket.close();
    await socketClosed;
    secondSocket.close();

    const reconnect = connect();
    const snapshot = receive(reconnect);
    await new Promise<void>((resolve, reject) => { reconnect.once('open', resolve); reconnect.once('error', reject); });
    expect(await snapshot).toMatchObject({ type: 'snapshot', revision: 1, state: { task: 'latest task' } });
    reconnect.close();
  });
});
