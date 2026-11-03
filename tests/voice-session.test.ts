import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceSession } from '../server/voice/session.js';

const deferred = <T = void,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
const frame = (n: number) => Buffer.from([n, 0]);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(transcript = 'hello') {
  const sent: Array<string | Buffer> = [];
  const socket = { send: vi.fn((data: string | Buffer) => sent.push(data)), close: vi.fn() };
  let detection!: (name: string) => void;
  const wakeDone = deferred();
  const wakeStarted = deferred();
  const consumed: number[] = [];
  const transcribeSignals: AbortSignal[] = [];
  const transcribe = vi.fn(async (audio: AsyncIterable<Buffer>, signal: AbortSignal) => {
    transcribeSignals.push(signal);
    for await (const chunk of audio) { consumed.push(chunk[0]!); }
    return transcript;
  });
  const eventsDone = deferred();
  const eventsStarted = deferred();
  let terminal!: (event: any) => void;
  const hermes = {
    startRun: vi.fn(async () => ({ runId: 'private-run-id' })),
    stopRun: vi.fn(async () => ({ status: 'stopping' })),
    readRunEvents: vi.fn(async (_id: string, _signal: AbortSignal, onEvent: (event: any) => void) => {
      terminal = onEvent; eventsStarted.resolve(); await eventsDone.promise;
    }),
  };
  let detectorCount = 0;
  const wyoming = {
    detectWake: vi.fn(async (_audio: AsyncIterable<Buffer>, signal: AbortSignal, onDetection: (name: string) => void) => {
      detectorCount++; detection = onDetection; wakeStarted.resolve();
      await Promise.race([wakeDone.promise, new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))]);
    }),
    transcribe,
    synthesize: vi.fn(async () => ({ pcm: Buffer.from([4, 0]), rate: 16000, width: 2, channels: 1 })),
  };
  const session = new VoiceSession({ socket, hermes, wyoming, sessionId: 'private-session', settings: { wakeModel: 'hey', voice: 'voice' } });
  const message = (value: string | Buffer, binary = false) => session.message(value, binary);
  const finishCapture = async () => { await vi.advanceTimersByTimeAsync(15_000); await flush(); };
  return { session, socket, sent, hermes, wyoming, consumed, transcribeSignals, wakeStarted, wakeDone, triggerWake: (name = 'hey') => detection(name), emit: (event: any) => terminal(event), eventsDone, eventsStarted, message, finishCapture, get detectorCount() { return detectorCount; } };
}

afterEach(() => vi.useRealTimers());

describe('VoiceSession', () => {
  it('switches to a fresh queue synchronously on detection and sends cleanup-time frames to STT once', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.message(JSON.stringify({ type: 'resume' })); await h.wakeStarted.promise;
    h.message(frame(1), true); // belongs only to wake detection
    h.triggerWake();
    h.message(frame(2), true); h.message(frame(3), true); // arrive while detector is cleaning up
    h.wakeDone.resolve(); await flush(); await h.finishCapture();
    expect(h.consumed).toEqual([2, 3]);
    expect(h.hermes.startRun).toHaveBeenCalledTimes(1);
    h.session.close();
  });

  it('installs manual capture before aborting wake and does not let stale detector cleanup stomp phase', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.message(JSON.stringify({ type: 'resume' })); await h.wakeStarted.promise;
    h.message(JSON.stringify({ type: 'manual-start' }));
    h.message(frame(9), true); await flush(); await h.finishCapture();
    expect(h.consumed).toEqual([9]);
    const states = h.sent.filter((x): x is string => typeof x === 'string').map(x => JSON.parse(x)).filter(x => x.type === 'state');
    expect(states.map(x => x.phase)).toContain('capturing');
    expect(states.at(-1)?.phase).not.toBe('paused');
    h.session.close();
  });

  it('ends at the capture cap and does not submit an empty transcript', async () => {
    vi.useFakeTimers();
    const h = harness('');
    h.message(JSON.stringify({ type: 'manual-start' })); h.message(frame(1), true);
    await h.finishCapture();
    expect(h.hermes.startRun).not.toHaveBeenCalled();
    expect(h.wyoming.transcribe).toHaveBeenCalledTimes(1);
    h.session.close();
  });

  it('ends the queue at the aggregate byte cap without dropping frames', async () => {
    vi.useFakeTimers();
    const h = harness('');
    h.message(JSON.stringify({ type: 'manual-start' }));
    let total = 0;
    while (total < 480_000) {
      const size = Math.min(16 * 1024, 480_000 - total);
      h.message(Buffer.alloc(size, 2), true); total += size;
      await flush();
    }
    await flush();
    expect(h.wyoming.transcribe).toHaveBeenCalledTimes(1);
    expect(h.hermes.startRun).not.toHaveBeenCalled();
    expect(h.sent.filter((x): x is string => typeof x === 'string').map(x => JSON.parse(x)).some(x => x.type === 'state' && x.phase === 'transcribing')).toBe(true);
    h.session.close();
  });

  it('streams only allowlisted run events, speaks completed output, and gates wake on matching ack', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.message(JSON.stringify({ type: 'manual-start' })); h.message(frame(5), true); await h.finishCapture();
    await h.eventsStarted.promise;
    h.message(JSON.stringify({ type: 'manual-start' }));
    expect(h.hermes.startRun).toHaveBeenCalledTimes(1);
    h.emit({ type: 'message.delta', text: 'delta', private: 'discard' });
    h.emit({ type: 'subagent.start', subagentId: 'agent-1', private: 'discard' });
    h.emit({ type: 'run.completed', status: 'completed', output: 'spoken output', private: 'discard' });
    h.eventsDone.resolve(); await flush();
    const data = h.sent.filter((x): x is string => typeof x === 'string').map(x => JSON.parse(x));
    expect(data.some(x => x.type === 'assistant.delta' && x.text === 'delta')).toBe(true);
    expect(data.some(x => x.type === 'subagent' && x.action === 'start' && x.subagentId === 'agent-1')).toBe(true);
    expect(h.wyoming.synthesize).toHaveBeenCalledWith('spoken output', 'voice', expect.any(AbortSignal));
    expect(h.sent).toContainEqual(Buffer.from([4, 0]));
    expect(JSON.stringify(h.sent)).not.toContain('private-session');
    expect(JSON.stringify(h.sent)).not.toContain('private-run-id');
    const speaking = data.findLast(x => x.type === 'state' && x.phase === 'speaking');
    expect(speaking).toBeTruthy();
    h.message(JSON.stringify({ type: 'playback-ended', turn: 'wrong' }));
    expect(h.detectorCount).toBe(0);
    h.message(JSON.stringify({ type: 'playback-ended', turn: speaking.turn }));
    await flush();
    expect(h.detectorCount).toBe(1);
    h.session.close();
  });

  it('stops a remote run but retains admission gate until terminal event', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.message(JSON.stringify({ type: 'manual-start' })); h.message(frame(5), true); await h.finishCapture(); await h.eventsStarted.promise;
    h.message(JSON.stringify({ type: 'stop' }));
    expect(h.hermes.stopRun).toHaveBeenCalledWith('private-run-id');
    h.message(JSON.stringify({ type: 'manual-start' }));
    expect(h.hermes.startRun).toHaveBeenCalledTimes(1);
    h.emit({ type: 'run.cancelled', status: 'cancelled' }); h.eventsDone.resolve(); await flush();
    h.message(JSON.stringify({ type: 'manual-start' }));
    expect(h.hermes.startRun).toHaveBeenCalledTimes(1); // second utterance must finish before submission
    await h.finishCapture();
    expect(h.hermes.startRun).toHaveBeenCalledTimes(2);
    h.session.close();
  });

  it('aborts local capture when paused and fails closed on ambiguous run admission', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.message(JSON.stringify({ type: 'manual-start' }));
    h.message(frame(6), true); await flush();
    expect(h.transcribeSignals[0]?.aborted).toBe(false);
    h.message(JSON.stringify({ type: 'pause' })); await flush();
    expect(h.transcribeSignals[0]?.aborted).toBe(true);
    expect(h.hermes.startRun).not.toHaveBeenCalled();
    h.session.close();

    const broken = harness();
    broken.hermes.startRun.mockRejectedValue(new Error('untrusted upstream detail'));
    broken.message(JSON.stringify({ type: 'manual-start' })); broken.message(frame(1), true); await broken.finishCapture();
    broken.message(JSON.stringify({ type: 'manual-start' }));
    expect(broken.hermes.startRun).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(broken.sent)).not.toContain('untrusted upstream detail');
    broken.session.close();
  });

  it('rejects malformed PCM safely and aborts local work on close', async () => {
    const h = harness();
    h.message(JSON.stringify({ type: 'manual-start' }));
    h.message(Buffer.alloc(1), true);
    expect(h.sent.filter(x => typeof x === 'string').join()).toContain('INVALID_AUDIO');
    h.session.close();
    h.message(JSON.stringify({ type: 'resume' }));
    expect(h.wyoming.detectWake).not.toHaveBeenCalled();
  });
});
