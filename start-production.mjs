import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'production';
const tsx = fileURLToPath(new URL('./node_modules/tsx/dist/cli.mjs', import.meta.url));
const server = fileURLToPath(new URL('./server/server.ts', import.meta.url));
const child = spawn(process.execPath, [tsx, server], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 128 + (osConstants.signals[signal] ?? 1) : 1);
});
