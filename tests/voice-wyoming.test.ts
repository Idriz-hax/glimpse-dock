import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { WyomingVoiceClient } from '../server/voice/wyoming.js';

const servers: net.Server[] = [];
function fake(handler: (event: any, send: (event: unknown, payload?: Buffer) => void, socket: net.Socket) => void) {
  const server = net.createServer((socket) => {
    let input = Buffer.alloc(0);
    let expected = 0;
    socket.on('data', chunk => {
      input = Buffer.concat([input, chunk]);
      while (input.length) {
        if (!expected) {
          const end = input.indexOf(10);
          if (end < 0) return;
          const header = JSON.parse(input.subarray(0, end).toString());
          input = input.subarray(end + 1);
          expected = (header.data_length ?? 0) + (header.payload_length ?? 0);
          (socket as any).nextHeader = header;
          if (expected) continue;
          handler(header, send, socket);
        } else if (input.length >= expected) {
          const header = (socket as any).nextHeader;
          input = input.subarray(expected); expected = 0;
          handler(header, send, socket);
        } else return;
      }
    });
    function send(event: unknown, payload?: Buffer) {
      const bytes = payload ?? Buffer.alloc(0);
      socket.write(Buffer.from(JSON.stringify({ ...event as object, ...(bytes.length ? { payload_length: bytes.length } : {}) }) + '\n'));
      if (bytes.length) socket.write(bytes);
    }
  });
  server.listen(0, '127.0.0.1'); servers.push(server);
  return new Promise<string>(resolve => server.once('listening', () => resolve(`tcp://127.0.0.1:${(server.address() as net.AddressInfo).port}`)));
}
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r())))); });

describe('WyomingVoiceClient', () => {
  it('discovers wake models and Piper voices from describe/info', async () => {
    const uri = await fake((e, send) => { if (e.type === 'describe') send({ type: 'info', data: { wake_word: [{ name: 'hey_hermes', phrase: 'Hey Hermes' }] } }); });
    const client = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri });
    expect(await client.listWakeModels()).toEqual([{ name: 'hey_hermes', phrase: 'Hey Hermes' }]);
  });
  it('transcribes audio and synthesizes using returned format', async () => {
    const uri = await fake((e, send) => {
      if (e.type === 'audio-stop') send({ type: 'transcript', data: { text: 'hello' } });
      if (e.type === 'synthesize') { send({ type: 'audio-start', data: { rate: 22050, width: 2, channels: 1 } }); send({ type: 'audio-chunk' }, Buffer.from([1, 2])); send({ type: 'audio-stop' }); }
    });
    const c = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri });
    expect(await c.transcribe(Buffer.from([0, 0]), new AbortController().signal)).toBe('hello');
    expect(await c.synthesize('hello', 'voice', new AbortController().signal)).toEqual(Buffer.from([1, 2]));
  });
  it('rejects non-loopback endpoints', () => { expect(() => new WyomingVoiceClient({ wake: 'tcp://example.com:1', stt: 'tcp://127.0.0.1:1', tts: 'tcp://127.0.0.1:1' })).toThrow(); });
});
