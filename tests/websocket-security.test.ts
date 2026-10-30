import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import WebSocket from 'ws';
import { createServer } from '../server/server.ts';

describe('WebSocket session security', () => {
  let app: Awaited<ReturnType<typeof createServer>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('closes a revoked display session and rejects oversized client frames', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'secret' });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    const base = `http://127.0.0.1:${address.port}`;
    const setup = await fetch(`${base}/api/setup`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'secret', password: 'long-enough-password' }) });
    const ownerCookie = setup.headers.get('set-cookie')!.split(';')[0];
    const csrf = (await setup.json() as {csrf:string}).csrf;
    const pair = async () => {
      const response = await fetch(`${base}/api/display/pair`, { method: 'POST', headers: { cookie: ownerCookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ csrf }) });
      const redeem = await fetch(`${base}/api/display/redeem`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ code: (await response.json() as {code:string}).code }) });
      return redeem.headers.get('set-cookie')!.split(';')[0];
    };
    const open = (cookie: string) => new WebSocket(`${base.replace('http:', 'ws:')}/api/stream`, { headers: { cookie, origin: base } });
    const displayCookie = await pair();
    const socket = open(displayCookie);
    const snapshot = new Promise<void>(resolve => socket.once('message', () => resolve()));
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await snapshot;
    const sessions = await fetch(`${base}/api/sessions`, { headers: { cookie: ownerCookie } });
    const display = (await sessions.json() as {sessions:{id:string;role:string}[]}).sessions.find(session => session.role === 'display')!;
    const closed = new Promise<number>(resolve => socket.once('close', code => resolve(code)));
    const revoke = await fetch(`${base}/api/sessions/${display.id}`, { method: 'DELETE', headers: { cookie: ownerCookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ csrf }) });
    expect(revoke.status).toBe(200);
    expect(await closed).toBe(1008);

    const oversized = open(await pair());
    await new Promise<void>((resolve, reject) => { oversized.once('open', resolve); oversized.once('error', reject); });
    const oversizedClose = new Promise<number>(resolve => oversized.once('close', code => resolve(code)));
    oversized.send('x'.repeat(16_385));
    expect(await oversizedClose).toBe(1009);
  });

  it('closes connected sockets during graceful shutdown', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'secret' });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    const base = `http://127.0.0.1:${address.port}`;
    const setup = await fetch(`${base}/api/setup`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'secret', password: 'long-enough-password' }) });
    const cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const socket = new WebSocket(`${base.replace('http:', 'ws:')}/api/stream`, { headers: { cookie, origin: base } });
    const snapshot = new Promise<void>(resolve => socket.once('message', () => resolve()));
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await snapshot;
    const closed = new Promise<number>(resolve => socket.once('close', code => resolve(code)));
    await app.close();
    app = undefined;
    expect(await closed).toBe(1001);
  });

  it('terminates a peer that does not complete the WebSocket close handshake', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'secret' });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    const base = `http://127.0.0.1:${address.port}`;
    const setup = await fetch(`${base}/api/setup`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'secret', password: 'long-enough-password' }) });
    const cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const raw = net.connect(address.port, '127.0.0.1');
    await new Promise<void>(resolve => raw.once('connect', resolve));
    let response = '';
    const upgraded = new Promise<void>((resolve, reject) => {
      raw.on('data', chunk => { response += chunk.toString('latin1'); if (response.includes('\r\n\r\n')) resolve(); });
      raw.once('error', reject);
    });
    raw.write(`GET /api/stream HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${base}\r\nCookie: ${cookie}\r\n\r\n`);
    await upgraded;
    expect(response).toContain('101 Switching Protocols');
    const closed = new Promise<void>(resolve => raw.once('close', () => resolve()));
    const started = Date.now();
    await app.close();
    app = undefined;
    await closed;
    expect(Date.now() - started).toBeLessThan(2_500);
  });
});
