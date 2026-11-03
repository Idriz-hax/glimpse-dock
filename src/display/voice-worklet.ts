declare const sampleRate: number;
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;
declare class AudioWorkletProcessor { port: MessagePort; }

class VoiceFrameProcessor extends AudioWorkletProcessor {
  private pending: number[] = [];
  private inputCount = 0;
  private outputCount = 0;
  private previous = 0;
  private ended = false;
  private readonly frameSize = 1600;
  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => { if (event.data === 'end' && !this.ended) { this.ended = true; this.flush(); this.port.postMessage({ type: 'end' }); } };
  }
  private flush() {
    if (!this.pending.length) return;
    const pcm = new Int16Array(this.pending.length);
    this.pending.forEach((v, i) => { pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767))); });
    this.port.postMessage({ type: 'audio', pcm }, [pcm.buffer]); this.pending = [];
  }
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel || this.ended) return true;
    for (const sample of channel) {
      if (this.outputCount >= 240_000) { this.ended = true; this.flush(); this.port.postMessage({ type: 'end' }); return true; }
      const position = this.outputCount * sampleRate / 16000;
      while (position <= this.inputCount) {
        const fraction = this.inputCount === 0 ? 0 : position - (this.inputCount - 1);
        const value = this.inputCount === 0 ? sample : this.previous + (sample - this.previous) * fraction;
        this.pending.push(value); this.outputCount++;
        if (this.pending.length === this.frameSize) this.flush();
        if (this.outputCount >= 240_000) { this.ended = true; this.flush(); this.port.postMessage({ type: 'end' }); return true; }
        if (this.outputCount * sampleRate / 16000 > this.inputCount) break;
      }
      this.previous = sample; this.inputCount++;
    }
    return true;
  }
}
registerProcessor('voice-frame-processor', VoiceFrameProcessor);
