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

  it('parses allowlisted SSE events and ignores unknown fields', async () => {
    const stream = 'event: subagent.start\ndata: {"name":"worker","private":"ignore"}\n\nevent: message.delta\ndata: {"delta":"Hi","private":"ignore"}\n\nevent: run.completed\ndata: {"status":"completed"}\n\n';
    const fetch = vi.fn(async () => response(stream, 200, { 'content-type': 'text/event-stream' }));
    const client = new HermesApiClient('http://127.0.0.1:8642', 'key', fetch as typeof globalThis.fetch);
    const events: unknown[] = [];
    await client.readRunEvents('run-1', new AbortController().signal, event => events.push(event));
    expect(events).toEqual([
      { type: 'subagent.start', name: 'worker' },
      { type: 'message.delta', delta: 'Hi' },
      { type: 'run.completed', status: 'completed' },
    ]);
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
    const fetch = vi.fn(async () => response(''));
    const client = new HermesApiClient('http://127.0.0.1:8642', 'key', fetch as typeof globalThis.fetch);
    const controller = new AbortController();
    await client.readRunEvents('run', controller.signal, () => {});
    expect(fetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});
