declare const sampleRate: number;
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;
declare class AudioWorkletProcessor { port: MessagePort; }

class VoiceFrameProcessor extends AudioWorkletProcessor {
  private samples: number[] = [];
  private pending: number[] = [];
  private inputCount = 0;
  private outputCount = 0;
  private readonly frameSize = 1600;
  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => { if (event.data === 'end') { this.flush(); this.port.postMessage({ type: 'end' }); } };
  }
  private flush() {
    if (!this.pending.length) return;
    const pcm = new Int16Array(this.pending.length);
    this.pending.forEach((v, i) => { pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767))); });
    this.port.postMessage({ type: 'audio', pcm }, [pcm.buffer]); this.pending = [];
  }
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      this.samples.push(sample); this.inputCount++;
      const target = Math.floor(this.inputCount * 16000 / sampleRate);
      while (this.outputCount < target) {
        this.pending.push(this.samples[0] ?? sample); this.outputCount++;
        if (this.pending.length === this.frameSize) this.flush();
      }
      if (this.inputCount % 3 === 0) this.samples.shift();
    }
    if (this.outputCount >= 240_000) { this.flush(); this.port.postMessage({ type: 'end' }); this.inputCount = 0; this.outputCount = 0; this.samples = []; }
    return true;
  }
}
registerProcessor('voice-frame-processor', VoiceFrameProcessor);
