import { describe, expect, it } from 'vitest';
import { createServer as createNetServer } from 'node:net';
import { connect as tlsConnect, createServer as createTlsServer } from 'node:tls';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateListenerConfig } from '../server/server.ts';

describe('LAN HTTPS listener', () => {
  const httpsConfig = (cert: string) => validateListenerConfig({ GLIMPSE_LAN_MODE: 'https', HOST: '192.168.1.20', PORT: '4174', GLIMPSE_TRUSTED_CIDR: '192.168.1.0/24', GLIMPSE_LAN_ORIGIN: 'https://192.168.1.20:4174', GLIMPSE_TLS_CERT: resolve(`tests/fixtures/${cert}-cert.pem`), GLIMPSE_TLS_KEY: resolve(`tests/fixtures/${cert}-key.pem`) } as NodeJS.ProcessEnv, { en0: [{ address: '192.168.1.20' }] } as any);

  it('rejects a certificate whose SAN does not cover the configured host', () => {
    expect(() => validateListenerConfig({ GLIMPSE_LAN_MODE: 'https', HOST: '192.168.1.21', PORT: '4174', GLIMPSE_TRUSTED_CIDR: '192.168.1.0/24', GLIMPSE_LAN_ORIGIN: 'https://192.168.1.21:4174', GLIMPSE_TLS_CERT: resolve('tests/fixtures/lan-valid-cert.pem'), GLIMPSE_TLS_KEY: resolve('tests/fixtures/lan-valid-key.pem') } as NodeJS.ProcessEnv, { en0: [{ address: '192.168.1.21' }] } as any)).toThrow();
  });

  it('rejects an expired certificate', () => {
    expect(() => httpsConfig('lan-expired')).toThrow();
  });

  it('accepts a currently valid certificate with the configured IP SAN', () => {
    expect(httpsConfig('lan-valid').secure).toBe(true);
  });

  it('accepts raw IPv6 loopback by default but rejects the IPv6 wildcard', () => {
    const listener = validateListenerConfig({ HOST: '::1' } as NodeJS.ProcessEnv, {});
    expect(listener).toMatchObject({ host: '::1', secure: false, lan: false });
    expect(() => validateListenerConfig({ HOST: '::' } as NodeJS.ProcessEnv, {})).toThrow();
    expect(() => validateListenerConfig({ HOST: '::', GLIMPSE_LAN_MODE: 'http' } as NodeJS.ProcessEnv, {})).toThrow();
  });

  it('performs a real TLS handshake independently of LAN identity policy', async () => {
    const port = await new Promise<number>((resolvePort, reject) => {
      const probe = createNetServer(); probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => { const address = probe.address(); if (!address || typeof address === 'string') return reject(new Error('No TCP address')); const selected = address.port; probe.close(error => error ? reject(error) : resolvePort(selected)); });
    });
    const cert = resolve('tests/fixtures/lan-test-cert.pem'), key = resolve('tests/fixtures/lan-test-key.pem');
    const server=createTlsServer({cert:readFileSync(cert),key:readFileSync(key)}, socket=>socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok'));
    await new Promise<void>((resolveListen,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolveListen);});
    try {
      const encrypted = await new Promise<boolean>((resolveHandshake, reject) => {
        const socket = tlsConnect({ host:'127.0.0.1', port, rejectUnauthorized:false });
        socket.once('secureConnect', () => { resolveHandshake(socket.encrypted); socket.end(); });
        socket.once('error', reject);
      });
      expect(encrypted).toBe(true);
    } finally { await new Promise<void>(resolveClose=>server.close(()=>resolveClose())); }
  });
});
