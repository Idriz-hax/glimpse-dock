import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('frames 16 kHz PCM continuously past 15 seconds and flushes once at lifecycle end', async () => {
  const messages: Array<{ type: string; pcm?: Int16Array }> = [];
  class WorkletBase {
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (message: { type: string; pcm?: Int16Array }) => messages.push(message),
    };
  }
  let Processor!: new () => WorkletBase;
  vi.stubGlobal('AudioWorkletProcessor', WorkletBase);
  vi.stubGlobal('sampleRate', 48_000);
  vi.stubGlobal('registerProcessor', (_name: string, constructor: new () => WorkletBase) => { Processor = constructor; });
  await import('../src/display/voice-worklet.ts');

  const processor = new Processor();
  processor.process([[new Float32Array(4_800).fill(0.25)]]);
  const frame = messages.find(message => message.type === 'audio')?.pcm;
  expect(frame).toBeInstanceOf(Int16Array);
  expect(frame).toHaveLength(1_600);
  expect(frame?.[0]).toBe(8_192);

  messages.length = 0;
  const continuous = new Processor();
  for (let offset = 0; offset < 768_000; offset += 128) {
    continuous.process([[new Float32Array(Math.min(128, 768_000 - offset))]]);
  }
  continuous.port.onmessage?.({ data: 'end' });
  continuous.port.onmessage?.({ data: 'end' });
  expect(messages.filter(message => message.type === 'end')).toHaveLength(1);
  expect(messages.filter(message => message.type === 'audio').reduce((count, message) => count + (message.pcm?.length ?? 0), 0)).toBe(256_000);
  continuous.process([[new Float32Array(128)]]);
  expect(messages.filter(message => message.type === 'audio').reduce((count, message) => count + (message.pcm?.length ?? 0), 0)).toBe(256_000);

  const nextLifecycle = new Processor();
  nextLifecycle.process([[new Float32Array(4_800)]]);
  expect(messages.filter(message => message.type === 'audio').at(-1)?.pcm).toHaveLength(1_600);
});
