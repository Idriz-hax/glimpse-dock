import net from 'node:net';

export type WyomingEvent = { type: string; data?: Record<string, unknown>; payload?: Buffer };
export type PcmAudio = { pcm: Buffer; rate: number; width: number; channels: number };
const MAX_HEADER = 16 * 1024;
const MAX_DATA = 64 * 1024;
const MAX_PAYLOAD = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

function endpoint(uri: string) {
  let u: URL;
  try { u = new URL(uri); } catch { throw new Error('Invalid Wyoming endpoint'); }
  if (u.protocol !== 'tcp:' || !['127.0.0.1', 'localhost'].includes(u.hostname) || !u.port) throw new Error('Wyoming endpoints must use loopback TCP');
  return { host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) };
}

export class WyomingVoiceClient {
  private readonly services: Record<'wake' | 'stt' | 'tts', ReturnType<typeof endpoint>>;
  constructor(services: { wake: string; stt: string; tts: string }) {
    this.services = { wake: endpoint(services.wake), stt: endpoint(services.stt), tts: endpoint(services.tts) };
  }
  listWakeModels(): Promise<Array<{ name: string; phrase: string }>> {
    return this.info('wake').then(info => {
      const rows = info.wake ?? info.wake_word ?? info.wake_words ?? info.models;
      if (!Array.isArray(rows)) return [];
      return rows.flatMap((v: any) => {
        const models = Array.isArray(v?.models) ? v.models : [v];
        return models.flatMap((m: any) => typeof m?.name === 'string' ? [{ name: m.name, phrase: typeof m.phrase === 'string' ? m.phrase : m.name }] : []);
      });
    });
  }
  listVoices(): Promise<string[]> {
    return this.info('tts').then(info => {
      const services = Array.isArray(info.tts) ? info.tts : [info];
      return services.flatMap((service: any) => Array.isArray(service.voices) ? service.voices.flatMap((v: any) => typeof v === 'string' ? [v] : typeof v?.name === 'string' ? [v.name] : []) : []);
    });
  }
  async detectWake(audio: AsyncIterable<Buffer>, signal: AbortSignal, onDetection: (name: string, timestamp: number) => void, configuredName = 'hey_hermes'): Promise<string | undefined> {
    return this.run('wake', signal, async (send, next) => {
      const installed = await this.listWakeModels();
      const model = installed.find(m => m.name === configuredName);
      if (!model) throw new Error(`Wake model is not installed: ${configuredName}`);
      send({ type: 'detect', data: { names: [model.name] } });
      send({ type: 'audio-start', data: { rate: 16000, width: 2, channels: 1 } });
      let detected: string | undefined;
      const iterator = audio[Symbol.asyncIterator]();
      let stopFeeding!: () => void;
      const stopped = new Promise<void>(resolve => { stopFeeding = resolve; });
      const feeding = (async () => {
        try { while (!signal.aborted && !detected) { const result = await Promise.race([iterator.next(), stopped.then(() => null)]); if (!result || result.done || signal.aborted || detected) break; if (result.value.length > MAX_PAYLOAD) throw new Error('Audio frame too large'); send({ type: 'audio-chunk' }, result.value); } }
        catch (error) { if (!detected && !signal.aborted) throw error; }
      })();
      try {
        while (true) {
          const e = await next();
          if (e.type === 'detection') { detected = typeof e.data?.name === 'string' ? e.data.name : model.name; stopFeeding(); onDetection(detected, Number(e.data?.timestamp ?? Date.now())); send({ type: 'audio-stop' }); void iterator.return?.(); void feeding; return detected; }
          if (e.type === 'not-detected') { stopFeeding(); void iterator.return?.(); send({ type: 'audio-stop' }); await feeding; return; }
        }
       } finally { if (detected) { stopFeeding(); void iterator.return?.(); } void feeding; }
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
  async synthesize(text: string, voice: string, signal: AbortSignal): Promise<PcmAudio> {
    if (Buffer.byteLength(text) > 16_384 || voice.length > 256) throw new Error('Synthesis input too large');
    return this.run('tts', signal, async (send, next) => {
      send({ type: 'synthesize', data: { text, voice: { name: voice } } });
      const chunks: Buffer[] = []; let total = 0; let format = { rate: 0, width: 0, channels: 0 };
      while (true) {
        const e = await next();
        if (e.type === 'audio-start') format = { rate: Number(e.data?.rate), width: Number(e.data?.width), channels: Number(e.data?.channels) };
        if (e.type === 'audio-chunk' && e.payload) { total += e.payload.length; if (total > MAX_PAYLOAD) throw new Error('Synthesis payload too large'); chunks.push(e.payload); }
        if (e.type === 'audio-stop') return { pcm: Buffer.concat(chunks, total), ...format };
      }
    });
  }
  private info(service: 'wake' | 'tts'): Promise<Record<string, any>> {
    return this.run(service, AbortSignal.timeout(TIMEOUT_MS), async (send, next) => { send({ type: 'describe' }); while (true) { const e = await next(); if (e.type === 'info') return e.data ?? {}; } });
  }
  private async run<T>(service: 'wake' | 'stt' | 'tts', signal: AbortSignal, operation: (send: (event: object, payload?: Buffer) => void, next: () => Promise<WyomingEvent>) => Promise<T>): Promise<T> {
    if (signal.aborted) throw new Error('Wyoming operation aborted');
    const socket = net.createConnection(this.services[service]);
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('Wyoming operation timed out')));
    const abort = () => socket.destroy(new Error('Wyoming operation aborted'));
    signal.addEventListener('abort', abort, { once: true });
    const queue: WyomingEvent[] = []; let waiter: ((v: WyomingEvent) => void) | undefined; let failure: Error | undefined; let buffer = Buffer.alloc(0); let header: any = null;
    const finish = (error: Error) => { failure ??= error; waiter?.(Promise.reject(error) as any); waiter = undefined; };
    const next = () => new Promise<WyomingEvent>((resolve, reject) => { if (queue.length) resolve(queue.shift()!); else if (failure) reject(failure); else waiter = resolve; });
    const send = (event: object, payload?: Buffer) => {
      const { data, ...rest } = event as any; const dataBytes = data === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(data)); const bytes = payload ?? Buffer.alloc(0);
      if (dataBytes.length > MAX_DATA || bytes.length > MAX_PAYLOAD) throw new Error('Wyoming message too large');
      const h = { ...rest, ...(data === undefined ? {} : { data_length: dataBytes.length }), ...(bytes.length ? { payload_length: bytes.length } : {}), version: '1.0' };
      if (signal.aborted) throw new Error('Wyoming operation aborted');
      socket.write(Buffer.concat([Buffer.from(JSON.stringify(h) + '\n'), dataBytes, bytes]));
    };
    socket.on('data', chunk => {
      if (buffer.length + chunk.length > MAX_HEADER + MAX_DATA + MAX_PAYLOAD + 1024) { socket.destroy(new Error('Wyoming message too large')); return; }
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        if (!header) {
          const i = buffer.indexOf(10); if (i < 0) { if (buffer.length > MAX_HEADER) socket.destroy(new Error('Wyoming header too large')); return; }
          if (i > MAX_HEADER) { socket.destroy(new Error('Wyoming header too large')); return; }
          try { header = JSON.parse(buffer.subarray(0, i).toString()); } catch { socket.destroy(new Error('Invalid Wyoming header')); return; }
          if (!header || typeof header !== 'object' || Array.isArray(header) || typeof header.type !== 'string') { socket.destroy(new Error('Invalid Wyoming header')); return; }
          buffer = buffer.subarray(i + 1);
          for (const key of ['data_length', 'payload_length']) if (header[key] !== undefined && (!Number.isSafeInteger(header[key]) || header[key] < 0)) { socket.destroy(new Error('Invalid Wyoming length')); return; }
          if ((header.data_length ?? 0) > MAX_DATA || (header.payload_length ?? 0) > MAX_PAYLOAD) { socket.destroy(new Error('Wyoming message too large')); return; }
          header.remaining = (header.data_length ?? 0) + (header.payload_length ?? 0);
        }
        if (buffer.length < header.remaining) return;
        const dl = header.data_length ?? 0; const dataBytes = buffer.subarray(0, dl); const payload = buffer.subarray(dl, header.remaining); buffer = buffer.subarray(header.remaining);
        let data = header.data && typeof header.data === 'object' ? header.data : {};
        if (dl) { try { const extra = JSON.parse(dataBytes.toString()); if (extra && typeof extra === 'object' && !Array.isArray(extra)) data = { ...data, ...extra }; } catch { socket.destroy(new Error('Invalid Wyoming data')); return; } }
        const e: WyomingEvent = { type: header.type, ...(data && typeof data === 'object' ? { data: data as Record<string, unknown> } : {}), ...(header.payload_length ? { payload: payload as Buffer } : {}) };
        header = null; if (waiter) { const w = waiter; waiter = undefined; w(e); } else queue.push(e);
      }
    });
    socket.on('close', () => finish(new Error('Wyoming connection closed'))); socket.on('error', err => finish(err));
    try { await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); }); return await operation(send, next); }
    finally { signal.removeEventListener('abort', abort); socket.destroy(); }
  }
}
