import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('frames mono PCM at 16 kHz and ends once at the 15-second cap', async () => {
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
  const capped = new Processor();
  for (let offset = 0; offset < 720_000; offset += 128) {
    capped.process([[new Float32Array(Math.min(128, 720_000 - offset))]]);
  }
  capped.port.onmessage?.({ data: 'end' });
  expect(messages.filter(message => message.type === 'end')).toHaveLength(1);
  expect(messages.filter(message => message.type === 'audio').reduce((count, message) => count + (message.pcm?.length ?? 0), 0)).toBe(240_000);
});
