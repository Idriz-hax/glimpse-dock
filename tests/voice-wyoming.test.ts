import { afterEach, describe, expect, it, vi } from 'vitest';
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
          const dl = header.data_length ?? 0;
          if (dl) header.data = { ...(header.data ?? {}), ...JSON.parse(input.subarray(0, dl).toString()) };
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
const audio = (...chunks: Buffer[]): AsyncIterable<Buffer> => ({ async *[Symbol.asyncIterator]() { yield* chunks; } });

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
    expect(await c.transcribe(audio(Buffer.from([0, 0])), new AbortController().signal)).toBe('hello');
    expect(await c.synthesize('hello', 'voice', new AbortController().signal)).toEqual({ pcm: Buffer.from([1, 2]), rate: 22050, width: 2, channels: 1 });
  });
  it('streams bounded chunks and accepts VAD transcript before source end', async () => {
    const seen: any[] = []; let closed = false;
    let stopReceived!: () => void;
    const stopped = new Promise<void>(resolve => { stopReceived = resolve; });
    const uri = await fake((e, send) => { seen.push(e); if (e.type === 'audio-chunk') send({ type: 'transcript', data: { text: 'early' } }); if (e.type === 'audio-stop') stopReceived(); });
    let first = true;
    const source = { [Symbol.asyncIterator]() { return { next: () => first ? (first = false, Promise.resolve({ done: false as const, value: Buffer.alloc(8) })) : new Promise<IteratorResult<Buffer>>(() => {}), return: async () => { closed = true; return { done: true as const, value: undefined }; } }; } };
    await expect(new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).transcribe(source, new AbortController().signal)).resolves.toBe('early');
    await stopped;
    expect(seen.map(e => e.type)).toEqual(['transcribe', 'audio-start', 'audio-chunk', 'audio-stop']);
    expect(closed).toBe(true);
  });
  it('rejects an utterance exceeding the aggregate byte limit', async () => {
    const uri = await fake(() => {});
    await expect(new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).transcribe(audio(Buffer.alloc(64 * 1024), Buffer.alloc(64 * 1024), Buffer.alloc(64 * 1024), Buffer.alloc(64 * 1024), Buffer.alloc(64 * 1024), Buffer.alloc(64 * 1024), Buffer.alloc(64 * 1024), Buffer.alloc(64 * 1024)), new AbortController().signal)).rejects.toThrow(/utterance too large/);
  });
  it('detects wake after sending model selection and audio frames, then closes the iterator', async () => {
    const received: any[] = [];
    const uri = await fake((e, send) => {
      if (e.type === 'describe') send({ type: 'info', data: { wake: [{ models: [{ name: 'hey_hermes' }] }] } });
      received.push(e);
      if (e.type === 'audio-chunk') send({ type: 'detection', data: { name: 'hey_hermes', timestamp: 123 } });
    });
    let callback: string | undefined; let iteratorClosed = false;
    let first = true;
    const audio = { [Symbol.asyncIterator]: () => ({ next: () => first ? (first = false, Promise.resolve({ done: false as const, value: Buffer.from([1, 2]) })) : new Promise<IteratorResult<Buffer>>(() => {}), return: async () => { iteratorClosed = true; return { done: true as const, value: undefined }; } }) };
    const result = await new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).detectWake(audio, new AbortController().signal, name => { callback = name; });
    expect(result).toBe('hey_hermes'); expect(callback).toBe('hey_hermes'); expect(iteratorClosed).toBe(true);
    expect(received.map(e => e.type)).toEqual(['describe', 'detect', 'audio-start', 'audio-chunk']);
    expect(received.find(e => e.type === 'detect').data).toEqual({ names: ['hey_hermes'] });
  });
  it('stops a pending audio iterator when the service reports not-detected', async () => {
    const uri = await fake((e, send) => { if (e.type === 'describe') send({ type: 'info', data: { wake: [{ name: 'hey_hermes' }] } }); if (e.type === 'audio-start') send({ type: 'not-detected' }); });
    let closed = false;
    const audio = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Buffer>>(() => {}), return: async () => { closed = true; return { done: true as const, value: undefined }; } }) };
    await expect(new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).detectWake(audio, new AbortController().signal, () => {})).resolves.toBeUndefined();
    expect(closed).toBe(true);
  });
  it('rejects oversized transcriptions and invalid declared lengths', async () => {
    const uri = await fake((e, send) => {});
    const client = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri });
    await expect(client.transcribe(audio(Buffer.alloc(64 * 1024 + 1)), new AbortController().signal)).rejects.toThrow(/too large/);
  });
  it('rejects pending reads on abort and malformed declared lengths', async () => {
    const uri = await fake(() => {});
    const client = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri });
    const controller = new AbortController();
    const pending = client.transcribe(audio(Buffer.from([0])), controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toThrow(/aborted/);
    const bad = net.createServer(socket => socket.once('data', () => socket.write('{"type":"transcript","data_length":-1}\n')));
    bad.listen(0, '127.0.0.1'); servers.push(bad);
    const badUri = await new Promise<string>(resolve => bad.once('listening', () => resolve(`tcp://127.0.0.1:${(bad.address() as net.AddressInfo).port}`)));
    await expect(new WyomingVoiceClient({ wake: badUri, stt: badUri, tts: badUri }).transcribe(audio(Buffer.from([0])), new AbortController().signal)).rejects.toThrow(/Invalid Wyoming length/);
  });
  it('rejects malformed JSON header shapes safely', async () => {
    for (const line of ['null', '[]', '{"type":3}', '{}']) {
      const bad = net.createServer(socket => socket.once('data', () => socket.write(`${line}\n`)));
      bad.listen(0, '127.0.0.1'); servers.push(bad);
      const uri = await new Promise<string>(resolve => bad.once('listening', () => resolve(`tcp://127.0.0.1:${(bad.address() as net.AddressInfo).port}`)));
      await expect(new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).transcribe(audio(Buffer.from([0])), new AbortController().signal)).rejects.toThrow(/Invalid Wyoming header/);
    }
  });
  it('rejects already-aborted calls before connecting', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(new WyomingVoiceClient({ wake: 'tcp://127.0.0.1:1', stt: 'tcp://127.0.0.1:1', tts: 'tcp://127.0.0.1:1' }).transcribe(audio(Buffer.from([1])), controller.signal)).rejects.toThrow(/aborted/);
  });
  it('does not write additional audio frames after abort during wake setup', async () => {
    const controller = new AbortController(); let started!: () => void;
    const audioStarted = new Promise<void>(resolve => { started = resolve; });
    const uri = await fake((e, send) => { if (e.type === 'describe') send({ type: 'info', data: { wake: [{ name: 'hey_hermes' }] } }); if (e.type === 'audio-start') { started(); controller.abort(); } });
    const audio = { async *[Symbol.asyncIterator]() { yield Buffer.from([1, 2]); yield Buffer.from([3, 4]); } };
    const pending = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).detectWake(audio, controller.signal, () => {});
    await audioStarted;
    await expect(pending).rejects.toThrow(/aborted/);
  });
  it('closes a pending audio iterator when wake detection is aborted', async () => {
    const controller = new AbortController(); let infoSent!: () => void; let reading!: () => void; let closed = false;
    const described = new Promise<void>(resolve => { infoSent = resolve; });
    const audioRead = new Promise<void>(resolve => { reading = resolve; });
    const uri = await fake((e, send) => {
      if (e.type === 'describe') { send({ type: 'info', data: { wake: [{ name: 'hey_hermes' }] } }); infoSent(); }
    });
    const audio = { [Symbol.asyncIterator]: () => ({ next: () => { reading(); return new Promise<IteratorResult<Buffer>>(() => {}); }, return: async () => { closed = true; return { done: true as const, value: undefined }; } }) };
    const pending = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).detectWake(audio, controller.signal, () => {});
    await described; await audioRead; controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
    expect(closed).toBe(true);
  });
  it('waits for socket drain before requesting the next wake audio frame', async () => {
    const uri = await fake((e, send) => { if (e.type === 'describe') send({ type: 'info', data: { wake: [{ name: 'hey_hermes' }] } }); });
    const originalWrite = net.Socket.prototype.write;
    let chunkBlocked = false;
    vi.spyOn(net.Socket.prototype, 'write').mockImplementation(function (this: net.Socket, chunk: any, ...args: any[]) {
      const result = originalWrite.call(this, chunk, ...args as [any]);
      if (!chunkBlocked && Buffer.isBuffer(chunk) && chunk.includes(Buffer.from('audio-chunk'))) {
        chunkBlocked = true;
        setTimeout(() => this.emit('drain'), 40);
        return false;
      }
      return result;
    });
    let requested = 0;
    const audio = { async *[Symbol.asyncIterator]() { requested++; yield Buffer.from([1]); requested++; yield Buffer.from([2]); await new Promise<void>(() => {}); } };
    const controller = new AbortController();
    const pending = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).detectWake(audio, controller.signal, () => {});
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(requested).toBe(1);
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
    vi.restoreAllMocks();
  });
  it('aborts model discovery without opening the wake detection connection', async () => {
    let connects = 0; let described!: () => void;
    const started = new Promise<void>(resolve => { described = resolve; });
    const server = net.createServer(socket => { connects++; socket.on('data', () => described()); });
    server.listen(0, '127.0.0.1'); servers.push(server);
    const uri = await new Promise<string>(resolve => server.once('listening', () => resolve(`tcp://127.0.0.1:${(server.address() as net.AddressInfo).port}`)));
    const controller = new AbortController();
    const pending = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).detectWake({ async *[Symbol.asyncIterator]() {} }, controller.signal, () => {});
    await started; controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(connects).toBe(1);
  });
  it('times out an unresponsive Wyoming service', async () => {
    const originalTimeout = net.Socket.prototype.setTimeout;
    vi.spyOn(net.Socket.prototype, 'setTimeout').mockImplementation(function (this: net.Socket, _timeout: number, callback?: () => void) {
      return originalTimeout.call(this, 100, callback);
    });
    let requestReceived!: () => void;
    const received = new Promise<void>(resolve => { requestReceived = resolve; });
    const uri = await fake(e => { if (e.type === 'audio-stop') requestReceived(); });
    try {
      const pending = new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).transcribe(audio(Buffer.from([0])), new AbortController().signal);
      await received;
      await expect(pending).rejects.toThrow(/timed out/);
    } finally { vi.restoreAllMocks(); }
  });
  it('does not log raw audio or recognized transcripts', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    try {
      const uri = await fake((e, send) => { if (e.type === 'audio-stop') send({ type: 'transcript', data: { text: 'private transcript' } }); });
      await new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).transcribe(audio(Buffer.from('private audio')), new AbortController().signal);
      expect(spies.flatMap(spy => spy.mock.calls.flat()).join(' ')).not.toMatch(/private audio|private transcript/);
    } finally { spies.forEach(spy => spy.mockRestore()); }
  });
  it('merges header data with JSON data bytes', async () => {
    const bytes = Buffer.from('{"extra":true}');
    const header = JSON.stringify({ type: 'info', data: { wake: [{ name: 'hey_hermes' }] }, data_length: bytes.length });
    const server = net.createServer(socket => socket.once('data', () => socket.write(Buffer.concat([Buffer.from(`${header}\n`), bytes]))));
    server.listen(0, '127.0.0.1'); servers.push(server);
    const uri = await new Promise<string>(resolve => server.once('listening', () => resolve(`tcp://127.0.0.1:${(server.address() as net.AddressInfo).port}`)));
    await expect(new WyomingVoiceClient({ wake: uri, stt: uri, tts: uri }).listWakeModels()).resolves.toEqual([{ name: 'hey_hermes', phrase: 'hey_hermes' }]);
  });
  it('rejects endpoints outside the configured loopback hosts', () => {
    expect(() => new WyomingVoiceClient({ wake: 'tcp://example.com:1', stt: 'tcp://127.0.0.1:1', tts: 'tcp://127.0.0.1:1' })).toThrow();
    expect(() => new WyomingVoiceClient({ wake: 'tcp://[::1]:1', stt: 'tcp://127.0.0.1:1', tts: 'tcp://127.0.0.1:1' })).toThrow();
  });
});
