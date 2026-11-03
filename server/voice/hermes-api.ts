export type HermesRunEvent =
  | { type: 'message.delta'; text: string }
  | { type: 'subagent.start' | 'subagent.complete'; subagentId: string }
  | { type: 'run.completed'; status: string; output?: string }
  | { type: 'run.failed' | 'run.cancelled' | 'run.interrupted'; status: string };

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
const MAX_EVENT_BYTES = 128 * 1024;

export class HermesApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly key: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async createSession(signal?: AbortSignal): Promise<string> {
    const data = await this.requestJson('/api/sessions', { method: 'POST', signal });
    const id = data.session_id ?? data.id;
    if (typeof id !== 'string' || !id) throw new Error('Invalid Hermes session response');
    return id;
  }

  async startRun(sessionId: string, input: string, idempotencyKey: string, signal?: AbortSignal): Promise<{ runId: string }> {
    const data = await this.requestJson('/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ input, session_id: sessionId }),
      signal,
    });
    if (typeof data.run_id !== 'string' || !data.run_id) throw new Error('Invalid Hermes run response');
    return { runId: data.run_id };
  }

  async stopRun(runId: string, signal?: AbortSignal): Promise<{ status: string }> {
    const data = await this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST', signal });
    return { status: typeof data.status === 'string' ? data.status.slice(0, 128) : 'stopping' };
  }

  async readRunEvents(runId: string, signal: AbortSignal, onEvent: (event: HermesRunEvent) => void): Promise<void> {
    const response = await this.request(`/v1/runs/${encodeURIComponent(runId)}/events`, { method: 'GET', signal });
    if (!response.body) throw new Error('Invalid Hermes event stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = '';
    let data = '';
    let total = 0;
    let terminal = false;
    const abort = () => { void reader.cancel(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    const dispatch = () => {
      if (!data) { eventName = ''; return; }
      let value: unknown;
      try { value = JSON.parse(data); } catch { throw new Error('Malformed Hermes event'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed Hermes event');
      const obj = value as Record<string, unknown>;
      const type = eventName;
      const text = (key: string) => typeof obj[key] === 'string' ? obj[key] as string : '';
      if (type === 'message.delta' && text('text')) onEvent({ type, text: text('text').slice(0, 16_384) });
      else if (type === 'subagent.start' || type === 'subagent.complete') {
        onEvent({ type, subagentId: text('subagent_id').slice(0, 256) });
      } else if (type === 'run.completed' || type === 'run.failed' || type === 'run.cancelled' || type === 'run.interrupted') {
        terminal = true;
        if (type === 'run.completed') onEvent({ type, status: text('status').slice(0, 128) || 'completed', ...(text('output') ? { output: text('output').slice(0, 16_384) } : {}) });
        else onEvent({ type, status: text('status').slice(0, 128) || type.slice(4) });
      }
      eventName = ''; data = '';
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) throw new Error('Hermes event stream too large');
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > MAX_LINE_BYTES && !buffer.includes('\n')) throw new Error('Hermes event line too large');
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
          if (new TextEncoder().encode(line).byteLength > MAX_LINE_BYTES) throw new Error('Hermes event line too large');
          if (!line) dispatch();
          else if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) {
            data += (data ? '\n' : '') + line.slice(5).trimStart();
            if (new TextEncoder().encode(data).byteLength > MAX_EVENT_BYTES) throw new Error('Hermes event too large');
          }
        }
      }
      if (buffer || data) dispatch();
      if (!terminal) throw new Error('Hermes event stream ended before run completed');
    } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  }

  private async requestJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await this.request(path, init);
    let data: unknown;
    try { data = await response.json(); } catch { throw new Error('Invalid Hermes JSON response'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Hermes JSON response');
    return data as Record<string, unknown>;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try { response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${this.key}` } }); }
    catch (error) { if (init.signal?.aborted) throw error; throw new Error('Hermes API request failed'); }
    if (!response.ok) throw new Error(`Hermes API returned HTTP ${response.status}`);
    return response;
  }
}
