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
      const { data, ...rest } = event as any;
      const dataBytes = data === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(data));
      const bytes = payload ?? Buffer.alloc(0);
      socket.write(Buffer.concat([Buffer.from(JSON.stringify({ ...rest, ...(data === undefined ? {} : { data_length: dataBytes.length }), ...(bytes.length ? { payload_length: bytes.length } : {}), version: '1.0' }) + '\n'), dataBytes, bytes]));
    }
  });
  server.listen(0, '127.0.0.1'); servers.push(server);
  return new Promise<string>(resolve => server.once('listening', () => resolve(`tcp://127.0.0.1:${(server.address() as net.AddressInfo).port}`)));
}
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r())))); });

describe('WyomingVoiceClient', () => {
  it('discovers wake models and Piper voices from describe/info', async () => {
    const uri = await fake((e, send) => { if (e.type === 'describe') send({ type: 'info', data: { wake: [{ name: 'openwakeword', models: [{ name: 'hey_hermes', phrase: 'Hey Hermes' }] }] } }); });
    const client = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri });
    expect(await client.listWakeModels()).toEqual([{ name: 'hey_hermes', phrase: 'Hey Hermes' }]);
  });
  it('discovers voices nested under Piper tts services', async () => {
    const uri = await fake((e, send) => { if (e.type === 'describe') send({ type: 'info', data: { tts: [{ voices: [{ name: 'en_US-lessac-medium' }] }] } }); });
    expect(await new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).listVoices()).toEqual(['en_US-lessac-medium']);
  });
  it('transcribes audio and synthesizes using returned format', async () => {
    const uri = await fake((e, send) => {
      if (e.type === 'audio-stop') send({ type: 'transcript', data: { text: 'hello' } });
      if (e.type === 'synthesize') { send({ type: 'audio-start', data: { rate: 22050, width: 2, channels: 1 } }); send({ type: 'audio-chunk' }, Buffer.from([1, 2])); send({ type: 'audio-stop' }); }
    });
    const c = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri });
    expect(await c.transcribe(Buffer.from([0, 0]), new AbortController().signal)).toBe('hello');
    expect(await c.synthesize('hello', 'voice', new AbortController().signal)).toEqual({ pcm: Buffer.from([1, 2]), rate: 22050, width: 2, channels: 1 });
  });
  it('selects the advertised wake model and stops feeding when detection arrives', async () => {
    let chunks = 0;
    const uri = await fake((e, send) => {
      if (e.type === 'describe') send({ type: 'info', data: { wake: [{ models: [{ name: 'hey_hermes' }] }] } });
      if (e.type === 'audio-start') send({ type: 'detection', data: { name: 'hey_hermes', timestamp: 123 } });
      if (e.type === 'audio-chunk') chunks++;
    });
    let callback: string | undefined; let iteratorClosed = false;
    const audio = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Buffer>>(() => {}), return: async () => { iteratorClosed = true; return { done: true, value: undefined }; } }) };
    const result = await new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).detectWake(audio, new AbortController().signal, name => { callback = name; });
    expect(result).toBe('hey_hermes'); expect(callback).toBe('hey_hermes'); expect(iteratorClosed).toBe(true); expect(chunks).toBe(0);
  });
  it('rejects oversized transcriptions and invalid declared lengths', async () => {
    const uri = await fake((e, send) => {});
    const client = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri });
    await expect(client.transcribe(Buffer.alloc(8 * 1024 * 1024 + 1), new AbortController().signal)).rejects.toThrow(/too large/);
  });
  it('rejects pending reads on abort and malformed declared lengths', async () => {
    const uri = await fake(() => {});
    const client = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri });
    const controller = new AbortController();
    const pending = client.transcribe(Buffer.from([0]), controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toThrow(/aborted/);
    const bad = net.createServer(socket => socket.once('data', () => socket.write('{"type":"transcript","data_length":-1}\n')));
    bad.listen(0, '127.0.0.1'); servers.push(bad);
    const badUri = await new Promise<string>(resolve => bad.once('listening', () => resolve(`tcp://127.0.0.1:${(bad.address() as net.AddressInfo).port}`)));
    await expect(new WyomingVoiceClient({ wake: badUri, stt: badUri, tts: badUri }).transcribe(Buffer.from([0]), new AbortController().signal)).rejects.toThrow(/Invalid Wyoming length/);
  });
  it('merges header data with JSON data bytes', async () => {
    const bytes = Buffer.from('{"extra":true}');
    const header = JSON.stringify({ type: 'info', data: { wake: [{ name: 'hey_hermes' }] }, data_length: bytes.length });
    const server = net.createServer(socket => socket.once('data', () => socket.write(Buffer.concat([Buffer.from(`${header}\n`), bytes]))));
    server.listen(0, '127.0.0.1'); servers.push(server);
    const uri = await new Promise<string>(resolve => server.once('listening', () => resolve(`tcp://127.0.0.1:${(server.address() as net.AddressInfo).port}`)));
    await expect(new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).listWakeModels()).resolves.toEqual([{ name: 'hey_hermes', phrase: 'hey_hermes' }]);
  });
  it('rejects non-loopback endpoints', () => { expect(() => new WyomingVoiceClient({ wake: 'tcp://example.com:1', stt: 'tcp://127.0.0.1:1', tts: 'tcp://127.0.0.1:1' })).toThrow(); });
});
