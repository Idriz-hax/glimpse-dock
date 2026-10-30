import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import { createServer } from '../server/server.ts';

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

  it('does not report or publish a state transition when the SQLite transaction fails', async () => {
    directory = await mkdtemp(join(tmpdir(), 'glimpse-backend-'));
    const database = join(directory, 'state.sqlite');
    const base = await start(database);
    const { cookie, csrf } = await setup(base);
    const sabotage = new Database(database);
    sabotage.exec("CREATE TRIGGER fail_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'forced write failure'); END;");
    const response = await fetch(`${base}/api/command`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ csrf, v: 1, requestId: 'failure', type: 'task.update', payload: { task: 'must not be accepted' } }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: 'PERSISTENCE_FAILED' } });
    const snapshot = await fetch(`${base}/api/state`, { headers: { cookie } });
    expect(await snapshot.json()).toMatchObject({ revision: 0, state: { task: '' } });
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
