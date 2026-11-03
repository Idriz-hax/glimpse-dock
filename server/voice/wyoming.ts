import net from 'node:net';

export type WyomingEvent = { type: string; data?: Record<string, unknown>; payload?: Buffer };
const MAX_HEADER = 16 * 1024;
const MAX_DATA = 64 * 1024;
const MAX_PAYLOAD = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

function endpoint(uri: string) {
  let u: URL;
  try { u = new URL(uri); } catch { throw new Error('Invalid Wyoming endpoint'); }
  if (u.protocol !== 'tcp:' || !['127.0.0.1', 'localhost', '::1'].includes(u.hostname) || !u.port) throw new Error('Wyoming endpoints must use loopback TCP');
  return { host: u.hostname, port: Number(u.port) };
}

export class WyomingVoiceClient {
  private readonly services: Record<'wake' | 'stt' | 'tts', ReturnType<typeof endpoint>>;
  constructor(services: { wake: string; stt: string; tts: string }) {
    this.services = { wake: endpoint(services.wake), stt: endpoint(services.stt), tts: endpoint(services.tts) };
  }
  listWakeModels(): Promise<Array<{ name: string; phrase: string }>> {
    return this.info('wake').then(info => {
      const rows = info.wake_word ?? info.wake_words ?? info.models;
      if (!Array.isArray(rows)) return [];
      return rows.flatMap((v: any) => typeof v?.name === 'string' ? [{ name: v.name, phrase: typeof v.phrase === 'string' ? v.phrase : v.name }] : []);
    });
  }
  listVoices(): Promise<string[]> {
    return this.info('tts').then(info => {
      const rows = info.voices;
      if (!Array.isArray(rows)) return [];
      return rows.flatMap((v: any) => typeof v === 'string' ? [v] : typeof v?.name === 'string' ? [v.name] : []);
    });
  }
  async detectWake(audio: AsyncIterable<Buffer>, signal: AbortSignal, onDetection: (name: string, timestamp: number) => void): Promise<void> {
    await this.run('wake', signal, async (send, next) => {
      send({ type: 'detect', data: { names: (await this.listWakeModels()).map(m => m.name) } });
      send({ type: 'audio-start', data: { rate: 16000, width: 2, channels: 1 } });
      const feeding = (async () => { for await (const frame of audio) { if (signal.aborted) break; if (frame.length > MAX_PAYLOAD) throw new Error('Audio frame too large'); send({ type: 'audio-chunk' }, frame); } send({ type: 'audio-stop' }); })();
      try { while (true) { const e = await next(); if (e.type === 'detection') { const d = e.data ?? {}; onDetection(String(d.name ?? ''), Number(d.timestamp ?? Date.now())); return; } if (e.type === 'not-detected') return; } } finally { await feeding; }
    });
  }
  async transcribe(audio: Buffer, signal: AbortSignal): Promise<string> {
    if (audio.length > MAX_PAYLOAD) throw new Error('Audio payload too large');
    return this.run('stt', signal, async (send, next) => {
      send({ type: 'transcribe' }); send({ type: 'audio-start', data: { rate: 16000, width: 2, channels: 1 } });
      send({ type: 'audio-chunk' }, audio); send({ type: 'audio-stop' });
      while (true) { const e = await next(); if (e.type === 'transcript') return typeof e.data?.text === 'string' ? e.data.text : ''; }
    });
  }
  async synthesize(text: string, voice: string, signal: AbortSignal): Promise<Buffer> {
    if (Buffer.byteLength(text) > 16_384 || voice.length > 256) throw new Error('Synthesis input too large');
    return this.run('tts', signal, async (send, next) => {
      send({ type: 'synthesize', data: { text, voice: { name: voice } } });
      const chunks: Buffer[] = []; let total = 0;
      while (true) { const e = await next(); if (e.type === 'audio-chunk' && e.payload) { total += e.payload.length; if (total > MAX_PAYLOAD) throw new Error('Synthesis payload too large'); chunks.push(e.payload); } if (e.type === 'audio-stop') return Buffer.concat(chunks); }
    });
  }
  private info(service: 'wake' | 'tts'): Promise<Record<string, any>> {
    return this.run(service, AbortSignal.timeout(TIMEOUT_MS), async (send, next) => { send({ type: 'describe' }); while (true) { const e = await next(); if (e.type === 'info') return e.data ?? {}; } });
  }
  private async run<T>(service: 'wake' | 'stt' | 'tts', signal: AbortSignal, operation: (send: (event: object, payload?: Buffer) => void, next: () => Promise<WyomingEvent>) => Promise<T>): Promise<T> {
    const socket = net.createConnection(this.services[service]);
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('Wyoming operation timed out')));
    const abort = () => socket.destroy(new Error('Wyoming operation aborted'));
    signal.addEventListener('abort', abort, { once: true });
    const queue: WyomingEvent[] = []; let waiter: ((v: WyomingEvent) => void) | undefined; let buffer = Buffer.alloc(0); let header: any = null; let ended = false;
    const next = () => new Promise<WyomingEvent>((resolve, reject) => { if (queue.length) resolve(queue.shift()!); else if (ended) reject(new Error('Wyoming connection closed')); else waiter = resolve; });
    const send = (event: object, payload?: Buffer) => { const p = payload ?? Buffer.alloc(0); socket.write(Buffer.concat([Buffer.from(JSON.stringify({ ...event, ...(p.length ? { payload_length: p.length } : {}) }) + '\n'), p])); };
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        if (!header) { const i = buffer.indexOf(10); if (i < 0) { if (buffer.length > MAX_HEADER) socket.destroy(new Error('Wyoming header too large')); return; } if (i > MAX_HEADER) { socket.destroy(new Error('Wyoming header too large')); return; }
          try { header = JSON.parse(buffer.subarray(0, i).toString()); } catch { socket.destroy(new Error('Invalid Wyoming header')); return; } buffer = buffer.subarray(i + 1);
          if ((header.data_length ?? 0) > MAX_DATA || (header.payload_length ?? 0) > MAX_PAYLOAD) { socket.destroy(new Error('Wyoming message too large')); return; }
          header.remaining = (header.data_length ?? 0) + (header.payload_length ?? 0); header.raw = Buffer.alloc(0);
        }
        const take = Math.min(buffer.length, header.remaining); header.raw = Buffer.concat([header.raw, buffer.subarray(0, take)]); buffer = buffer.subarray(take); header.remaining -= take;
        if (header.remaining) return;
        const dl = header.data_length ?? 0; let data = header.data ?? {};
        if (dl) { try { data = JSON.parse(header.raw.subarray(0, dl).toString()); } catch { socket.destroy(new Error('Invalid Wyoming data')); return; } }
        const e: WyomingEvent = { type: header.type, ...(data && typeof data === 'object' ? { data } : {}), ...(header.payload_length ? { payload: header.raw.subarray(dl) } : {}) };
        header = null; if (waiter) { const w = waiter; waiter = undefined; w(e); } else queue.push(e);
      }
    });
    socket.on('close', () => { ended = true; }); socket.on('error', () => { ended = true; });
    try { await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); }); return await operation(send, next); }
    finally { signal.removeEventListener('abort', abort); socket.destroy(); }
  }
}
