import { describe, expect, it } from 'vitest';
import { PcmQueue } from '../server/voice/pcm-queue.js';

const frame = (...bytes: number[]) => Buffer.from(bytes);

describe('PcmQueue', () => {
  it('delivers frames once, in FIFO order', async () => {
    const queue = new PcmQueue();
    const first = frame(1, 2), second = frame(3, 4);
    queue.push(first); queue.push(second);
    expect(await queue.next()).toEqual({ done: false, value: first });
    expect(await queue.next()).toEqual({ done: false, value: second });
    queue.end();
    expect(await queue.next()).toEqual({ done: true, value: undefined });
  });

  it('delivers to a pending waiter', async () => {
    const queue = new PcmQueue();
    const pending = queue.next();
    const audio = frame(8, 9);
    queue.push(audio);
    expect(await pending).toEqual({ done: false, value: audio });
  });

  it('gracefully ends after draining queued frames', async () => {
    const queue = new PcmQueue();
    queue.push(frame(1, 2)); queue.end();
    expect(await queue.next()).toMatchObject({ done: false });
    expect(await queue.next()).toEqual({ done: true, value: undefined });
    expect(() => queue.push(frame(3, 4))).toThrow();
  });

  it('discards frames and resolves a pending next as done', async () => {
    const queue = new PcmQueue();
    queue.push(frame(1, 2)); queue.discard();
    expect(await queue.next()).toEqual({ done: true, value: undefined });
    const pending = new PcmQueue();
    const waiting = pending.next(); pending.discard();
    expect(await waiting).toEqual({ done: true, value: undefined });
  });

  it('throws on byte or frame-count overflow without dropping frames', () => {
    const bytes = new PcmQueue();
    for (let i = 0; i < 4; i++) bytes.push(Buffer.alloc(16 * 1024));
    expect(() => bytes.push(frame(1, 2))).toThrow();
    const frames = new PcmQueue();
    for (let i = 0; i < 256; i++) frames.push(frame(1, 2));
    expect(() => frames.push(frame(3, 4))).toThrow();
    expect(frames.bufferedFrames).toBe(256);
  });

  it('rejects empty, odd-length, oversized, and non-buffer frames', () => {
    const queue = new PcmQueue();
    for (const input of [Buffer.alloc(0), Buffer.alloc(1), Buffer.alloc(16 * 1024 + 2), 'pcm']) {
      expect(() => queue.push(input as Buffer)).toThrow();
    }
  });

  it('is an async iterable over its next method', async () => {
    const queue = new PcmQueue();
    queue.push(frame(1, 2)); queue.end();
    const result: Buffer[] = [];
    for await (const value of queue) result.push(value);
    expect(result).toEqual([frame(1, 2)]);
  });
});
