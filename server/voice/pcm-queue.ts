const MAX_FRAME_BYTES = 16 * 1024;
const MAX_BUFFERED_BYTES = 64 * 1024;
const MAX_BUFFERED_FRAMES = 256;

/** A bounded, single-consumer queue for mono PCM16 frames. */
export class PcmQueue implements AsyncIterable<Buffer>, AsyncIterator<Buffer> {
  private frames: Buffer[] = [];
  private waiters: Array<(result: IteratorResult<Buffer>) => void> = [];
  private bytes = 0;
  private closed = false;

  get bufferedFrames(): number { return this.frames.length; }
  get bufferedBytes(): number { return this.bytes; }

  push(frame: Buffer): void {
    if (this.closed || !Buffer.isBuffer(frame) || frame.length === 0 || frame.length % 2 !== 0 || frame.length > MAX_FRAME_BYTES) {
      throw new Error('Invalid PCM frame');
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value: Buffer.from(frame) });
      return;
    }
    if (this.frames.length >= MAX_BUFFERED_FRAMES || this.bytes + frame.length > MAX_BUFFERED_BYTES) {
      throw new Error('PCM queue overflow');
    }
    const copy = Buffer.from(frame);
    this.frames.push(copy);
    this.bytes += copy.length;
  }

  next(): Promise<IteratorResult<Buffer>> {
    const frame = this.frames.shift();
    if (frame) {
      this.bytes -= frame.length;
      if (this.closed && !this.frames.length) this.resolveWaiters();
      return Promise.resolve({ done: false, value: frame });
    }
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise(resolve => this.waiters.push(resolve));
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.frames.length) this.resolveWaiters();
  }

  discard(): void {
    this.closed = true;
    this.frames = [];
    this.bytes = 0;
    this.resolveWaiters();
  }

  return(): Promise<IteratorResult<Buffer>> {
    this.discard();
    return Promise.resolve({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<Buffer> { return this; }

  private resolveWaiters(): void {
    for (const resolve of this.waiters.splice(0)) resolve({ done: true, value: undefined });
  }
}
