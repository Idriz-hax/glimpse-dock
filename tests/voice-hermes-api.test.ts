import { describe, expect, it, vi } from 'vitest';
import { HermesApiClient } from '../server/voice/hermes-api.js';

const response = (body: string, status = 200, headers?: HeadersInit) =>
  new Response(body, { status, headers });

describe('HermesApiClient', () => {
  it('creates a session with bearer auth', async () => {
    const fetch = vi.fn(async () => response('{"session_id":"session-1"}'));
    const client = new HermesApiClient('http://127.0.0.1:8642', 'key', fetch as typeof globalThis.fetch);
    await expect(client.createSession()).resolves.toBe('session-1');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8642/api/sessions', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer key' }),
    }));
  });

  it('starts a run with an idempotency key', async () => {
    const fetch = vi.fn(async () => response('{"run_id":"run-1","status":"accepted"}'));
    const client = new HermesApiClient('http://127.0.0.1:8642', 'key', fetch as typeof globalThis.fetch);
    await expect(client.startRun('session-1', 'hello', 'idem')).resolves.toEqual({ runId: 'run-1' });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer key', 'Idempotency-Key': 'idem' });
    expect(JSON.parse(String(init.body))).toEqual({ input: 'hello', session_id: 'session-1' });
  });

  it('parses documented SSE events and ignores unknown fields', async () => {
    const chunks = [
      'event: subagent.', 'start\ndata: {"name":"worker","private":"ignore"}\n',
      '\nevent: message.delta\ndata: {"text":', '"Hi","private":"ignore"}\n\nevent: run.completed\n',
      'data: {"status":"completed","output":"Done"}\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const fetch = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const client = new HermesApiClient('http://127.0.0.1:8642', 'key', fetch as typeof globalThis.fetch);
    const events: unknown[] = [];
    await client.readRunEvents('run-1', new AbortController().signal, event => events.push(event));
    expect(events).toEqual([
      { type: 'subagent.start', subagentId: '' },
      { type: 'message.delta', text: 'Hi' },
      { type: 'run.completed', status: 'completed', output: 'Done' },
    ]);
  });


  it('rejects non-terminal EOF and accepts failed terminal', async () => {
    const stream = (text: string) => new Response(text, { headers: { 'content-type': 'text/event-stream' } });
    const eof = new HermesApiClient('http://127.0.0.1', 'key', vi.fn(async () => stream('event: message.delta\ndata: {\"text\":\"x\"}\n\n')) as typeof fetch);
    await expect(eof.readRunEvents('r', new AbortController().signal, () => {})).rejects.toThrow('ended before run completed');
    const failed = new HermesApiClient('http://127.0.0.1', 'key', vi.fn(async () => stream('event: run.failed\ndata: {\"status\":\"failed\"}\n\n')) as typeof fetch);
    const events: unknown[] = [];
    await failed.readRunEvents('r', new AbortController().signal, event => events.push(event));
    expect(events).toEqual([{ type: 'run.failed', status: 'failed' }]);
  });

  it('stops a run with authenticated bodyless POST and forwards abort signals', async () => {
    const fetch = vi.fn(async () => response('{"status":"stopping"}'));
    const client = new HermesApiClient('http://127.0.0.1', 'key', fetch as typeof globalThis.fetch);
    const controller = new AbortController();
    await expect(client.stopRun('run/one', controller.signal)).resolves.toEqual({ status: 'stopping' });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1/v1/runs/run%2Fone/stop', expect.objectContaining({ method: 'POST', signal: controller.signal, headers: expect.objectContaining({ Authorization: 'Bearer key' }) }));
    const sessionFetch = vi.fn(async () => response('{"session_id":"s"}'));
    await new HermesApiClient('http://127.0.0.1', 'key', sessionFetch as typeof fetch).createSession(controller.signal);
    expect(sessionFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
    const runFetch = vi.fn(async () => response('{"run_id":"r"}'));
    await new HermesApiClient('http://127.0.0.1', 'key', runFetch as typeof fetch).startRun('s', 'x', 'i', controller.signal);
    expect(runFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it('sanitizes HTTP and malformed JSON/SSE failures', async () => {
    const denied = new HermesApiClient('http://127.0.0.1:8642', 'key', vi.fn(async () => response('secret response', 500)) as typeof fetch);
    await expect(denied.createSession()).rejects.not.toThrow('secret response');
    const malformed = new HermesApiClient('http://127.0.0.1:8642', 'key', vi.fn(async () => response('{')) as typeof fetch);
    await expect(malformed.createSession()).rejects.toThrow();
    const badSse = new HermesApiClient('http://127.0.0.1:8642', 'key', vi.fn(async () => response('data: {\n\n', 200, { 'content-type': 'text/event-stream' })) as typeof fetch);
    await expect(badSse.readRunEvents('r', new AbortController().signal, () => {})).rejects.toThrow();
  });

  it('passes abort signals to fetch', async () => {
    const fetch = vi.fn(async () => response('event: run.completed\ndata: {"status":"completed"}\n\n'));
    const client = new HermesApiClient('http://127.0.0.1:8642', 'key', fetch as typeof globalThis.fetch);
    const controller = new AbortController();
    await client.readRunEvents('run', controller.signal, () => {});
    expect(fetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it('rejects promptly when aborted while waiting for the next stream chunk', async () => {
    let reading!: () => void;
    const isReading = new Promise<void>(resolve => { reading = resolve; });
    const mockFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          reading();
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true });
        },
      });
      return new Response(body);
    });
    const client = new HermesApiClient('http://127.0.0.1:8642', 'key', mockFetch as typeof fetch);
    const controller = new AbortController();
    const pending = client.readRunEvents('run', controller.signal, () => {});
    await isReading;
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
