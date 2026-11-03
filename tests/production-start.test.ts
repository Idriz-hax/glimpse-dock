import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

const children: ReturnType<typeof spawn>[] = [];
const tempDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
    await Promise.race([new Promise<void>((resolve) => child.once('exit', () => resolve())), new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
  }));
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

describe('production launcher', () => {
  it('starts server in production mode and serves built pages', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'glimpse-dock-start-'));
    tempDirectories.push(directory);
    const port = await availablePort();
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', GLIMPSE_DB: join(directory, 'test.sqlite') };
    delete env.NODE_ENV;
    const child = spawn(process.execPath, ['start-production.mjs'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.stderr?.on('data', (chunk) => { output += chunk; });
    const deadline = Date.now() + 10000;
    let health: Response | undefined;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Launcher exited ${child.exitCode}: ${output}`);
      try {
        health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
        if (health.ok) break;
      } catch { /* server is still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(health?.status, output).toBe(200);
    for (const route of ['/', '/admin', '/display']) {
      const page = await fetch(`http://127.0.0.1:${port}${route}`);
      expect(page.status, route).toBe(200);
      expect(await page.text()).toContain('<html');
    }
  }, 15000);
});
