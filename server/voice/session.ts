import { randomUUID } from 'node:crypto';
import { PcmQueue } from './pcm-queue.js';
import type { HermesRunEvent } from './hermes-api.js';
import type { PcmAudio } from './wyoming.js';

type Phase = 'paused' | 'wake' | 'capturing' | 'transcribing' | 'running' | 'speaking' | 'closed';
type SocketLike = { send(data: string | Buffer): unknown; close(code?: number, reason?: string): unknown };
type Hermes = {
  startRun(sessionId: string, input: string, idempotencyKey: string, signal?: AbortSignal): Promise<{ runId: string }>;
  stopRun(runId: string, signal?: AbortSignal): Promise<unknown>;
  readRunEvents(runId: string, signal: AbortSignal, onEvent: (event: HermesRunEvent) => void): Promise<void>;
};
type Wyoming = {
  detectWake(audio: AsyncIterable<Buffer>, signal: AbortSignal, onDetection: (name: string, timestamp: number) => void, name?: string): Promise<unknown>;
  transcribe(audio: AsyncIterable<Buffer>, signal: AbortSignal): Promise<string>;
  synthesize(text: string, voice: string, signal: AbortSignal): Promise<PcmAudio>;
};
export type VoiceSessionOptions = {
  socket: SocketLike;
  hermes: Hermes;
  wyoming: Wyoming;
  sessionId: string;
  settings: { enabled?: boolean; wakeModel: string; voice: string };
  onRemoteSettled?: () => void;
};

const MAX_FRAME = 16 * 1024;
const MAX_CAPTURE_BYTES = 480_000;
const MAX_CAPTURE_MS = 15_000;
const MAX_TEXT = 16_384;
const MAX_TTS_BYTES = 8 * 1024 * 1024;
const json = (value: object) => JSON.stringify(value);

/** One socket's synchronous ingress dispatcher and fenced voice-turn lifecycle. */
export class VoiceSession {
  private phase: Phase = 'paused';
  private turn?: number;
  private turnCounter = 0;
  private generation = 0;
  private currentQueue?: PcmQueue;
  private wakeQueue?: PcmQueue;
  private wakeController?: AbortController;
  private wakeTask?: Promise<void>;
  private captureTimer?: ReturnType<typeof setTimeout>;
  private captureBytes = 0;
  private turnController?: AbortController;
  private remoteController?: AbortController;
  private remoteActive = false;
  private remoteRunId?: string;
  private remoteStopRequested = false;
  private closed = false;
  private settledNotified = false;
  constructor(private readonly options: VoiceSessionOptions) {}

  get hasActiveRun(): boolean { return this.remoteActive; }

  message(data: unknown, isBinary: boolean): void {
    if (this.closed) return;
    if (isBinary) {
      if (this.phase !== 'capturing' || !this.currentQueue) return;
      if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_FRAME || data.length % 2) {
        this.fail('INVALID_AUDIO'); return;
      }
      if (this.captureBytes + data.length > MAX_CAPTURE_BYTES) { this.endCapture(); return; }
      try {
        this.currentQueue.push(data); this.captureBytes += data.length;
        if (this.captureBytes === MAX_CAPTURE_BYTES) this.endCapture();
      }
      catch { this.fail('AUDIO_OVERFLOW'); }
      return;
    }
    if (Buffer.byteLength(typeof data === 'string' ? data : Buffer.isBuffer(data) ? data : '') > 1024) {
      this.send({ type: 'error', code: 'INVALID_MESSAGE', turn: this.turn ?? null }); return;
    }
    let control: unknown;
    try { control = JSON.parse(typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : ''); }
    catch { this.send({ type: 'error', code: 'INVALID_MESSAGE', turn: this.turn ?? null }); return; }
    if (!control || typeof control !== 'object' || Array.isArray(control)) {
      this.send({ type: 'error', code: 'INVALID_MESSAGE', turn: this.turn ?? null }); return;
    }
    const value = control as Record<string, unknown>;
    const keys = Object.keys(value);
    if (keys.some(key => key !== 'type' && !(value.type === 'playback-ended' && key === 'turn')) ||
      (value.type === 'playback-ended' && (!Number.isSafeInteger(value.turn) || typeof value.turn !== 'number'))) {
      this.send({ type: 'error', code: 'INVALID_MESSAGE', turn: this.turn ?? null }); return;
    }
    switch (value.type) {
      case 'resume': if (this.phase === 'paused' && !this.remoteActive && this.options.settings.enabled !== false) this.startWake(); break;
      case 'pause': case 'stop': this.pause(); break;
      case 'manual-start': this.manualStart(); break;
      case 'playback-ended': if (this.phase === 'speaking' && value.turn === this.turn) { this.turn = undefined; this.setPhase('wake'); this.startWake(); } break;
      default: this.send({ type: 'error', code: 'INVALID_MESSAGE', turn: this.turn ?? null });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    this.clearCaptureTimer();
    this.currentQueue?.discard(); this.currentQueue = undefined;
    this.wakeQueue?.discard(); this.wakeQueue = undefined;
    this.wakeController?.abort(); this.turnController?.abort();
    this.stopRemote();
    if (!this.remoteActive) this.notifySettled();
    this.phase = 'closed';
  }

  private startWake(): void {
    if (this.closed || this.remoteActive || this.phase !== 'wake' && this.phase !== 'paused') return;
    this.setPhase('wake');
    const queue = new PcmQueue(), controller = new AbortController(), generation = ++this.generation;
    this.wakeQueue = queue; this.wakeController = controller;
    this.wakeTask = (async () => {
      try {
        await this.options.wyoming.detectWake(queue, controller.signal, name => {
          if (this.closed || generation !== this.generation || this.phase !== 'wake') return;
          this.beginCapture('wake', name);
        }, this.options.settings.wakeModel);
      } catch {
        if (!controller.signal.aborted && generation === this.generation) this.fail('VOICE_UNAVAILABLE');
      } finally {
        queue.discard();
        if (generation === this.generation && this.phase === 'wake') this.pause();
      }
    })();
  }

  private manualStart(): void {
    if (this.closed || this.options.settings.enabled === false || this.remoteActive || !['paused', 'wake'].includes(this.phase)) return;
    const fromWake = this.phase === 'wake';
    const previousWake = this.wakeTask;
    this.beginCapture('manual');
    if (fromWake) {
      this.wakeController?.abort();
      const generation = this.generation;
      void Promise.resolve(previousWake).finally(() => {
        if (!this.closed && generation === this.generation && (this.phase === 'capturing' || this.phase === 'transcribing')) this.startTranscription();
      });
    } else this.startTranscription();
  }

  private beginCapture(source: 'manual' | 'wake', wakeName?: string): void {
    this.clearCaptureTimer();
    const queue = new PcmQueue();
    this.currentQueue = queue;
    this.captureBytes = 0;
    this.turn = ++this.turnCounter;
    const generation = ++this.generation;
    this.setPhase('capturing');
    if (source === 'wake') this.send({ type: 'wake', name: this.safeName(wakeName), turn: this.turn });
    this.captureTimer = setTimeout(() => {
      if (generation === this.generation && this.phase === 'capturing') this.endCapture();
    }, MAX_CAPTURE_MS);
    if (source === 'wake') this.startTranscription();
  }

  private startTranscription(): void {
    const queue = this.currentQueue, turn = this.turn, generation = this.generation;
    if (!queue || !turn || !['capturing', 'transcribing'].includes(this.phase)) return;
    const controller = new AbortController(); this.turnController = controller;
    void (async () => {
      try {
        const transcript = await this.options.wyoming.transcribe(queue, controller.signal);
        if (!this.isCurrent(generation, turn) || controller.signal.aborted) return;
        this.clearCaptureTimer();
        if (typeof transcript !== 'string' || !transcript.trim()) { this.currentQueue = undefined; this.turnController = undefined; this.turn = undefined; this.setPhase('wake'); this.startWake(); return; }
        const text = transcript.slice(0, MAX_TEXT);
        this.send({ type: 'transcript', text, turn });
        await this.runHermes(text, turn, generation);
      } catch {
        if (this.isCurrent(generation, turn) && !controller.signal.aborted) this.fail('VOICE_UNAVAILABLE');
      } finally {
        queue.discard();
        if (this.turnController === controller && this.phase !== 'running' && this.phase !== 'speaking') this.turnController = undefined;
      }
    })();
  }

  private async runHermes(text: string, turn: number, generation: number): Promise<void> {
    if (this.remoteActive || !this.isCurrent(generation, turn)) return;
    this.remoteActive = true; // Fail closed from before startRun until a terminal event is observed.
    this.remoteStopRequested = false;
    const startController = this.turnController ?? new AbortController();
    let runId: string;
    try { ({ runId } = await this.options.hermes.startRun(this.options.sessionId, text, randomUUID(), startController.signal)); }
    catch { if (this.isCurrent(generation, turn)) this.fail('HERMES_UNAVAILABLE'); return; }
    this.remoteRunId = runId;
    if (startController.signal.aborted || this.remoteStopRequested || this.closed) void this.stopRemote();
    const remoteController = new AbortController();
    this.remoteController = remoteController;
    const remoteSignal = remoteController.signal;
    let terminal = false, completion: Extract<HermesRunEvent, { type: 'run.completed' }> | undefined;
    const deliver = (event: HermesRunEvent) => {
      if (this.remoteController !== remoteController || terminal) return;
      if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled' || event.type === 'run.interrupted') {
        terminal = true; if (event.type === 'run.completed') completion = event;
        this.remoteActive = false; this.remoteRunId = undefined;
        this.remoteController = undefined;
        this.notifySettled();
      }
      if (!this.isCurrent(generation, turn) || this.remoteStopRequested || this.closed) return;
      if (event.type === 'message.delta') this.send({ type: 'assistant.delta', text: event.text.slice(0, MAX_TEXT), turn });
      else if (event.type === 'subagent.start' || event.type === 'subagent.complete') this.send({ type: 'subagent', action: event.type === 'subagent.start' ? 'start' : 'complete', subagentId: event.subagentId.slice(0, 256), turn });
      else if (event.type !== 'run.completed') this.fail('HERMES_FAILED');
    };
    this.setPhase('running');
    try {
      await this.options.hermes.readRunEvents(runId, remoteSignal, deliver);
      if (!terminal) throw new Error('terminal event missing');
    } catch {
      if (!terminal) { this.remoteActive = true; if (this.isCurrent(generation, turn)) this.fail('HERMES_UNAVAILABLE'); return; }
    }
    if (!terminal || !completion || !this.isCurrent(generation, turn) || this.remoteStopRequested) return;
    const output = typeof completion.output === 'string' ? completion.output.slice(0, MAX_TEXT) : '';
    if (!output.trim()) { this.turn = undefined; this.setPhase('wake'); this.startWake(); return; }
    this.setPhase('speaking');
    try {
      const audio = await this.options.wyoming.synthesize(output, this.options.settings.voice, this.turnController?.signal ?? new AbortController().signal);
      if (!this.isCurrent(generation, turn) || this.turnController?.signal.aborted) return;
      if (!Buffer.isBuffer(audio.pcm) || audio.pcm.length > MAX_TTS_BYTES || !Number.isInteger(audio.rate) || audio.rate < 8_000 || audio.rate > 96_000 || audio.width !== 2 || audio.channels !== 1) throw new Error('invalid audio');
      this.send({ type: 'tts-start', rate: audio.rate, width: audio.width, channels: audio.channels, bytes: audio.pcm.length, turn });
      this.options.socket.send(audio.pcm);
      this.send({ type: 'tts-end', turn });
    } catch { if (this.isCurrent(generation, turn)) this.fail('VOICE_UNAVAILABLE'); }
  }

  private endCapture(): void {
    this.clearCaptureTimer();
    this.currentQueue?.end();
    if (this.phase === 'capturing') this.setPhase('transcribing');
  }

  private pause(): void {
    if (this.closed) return;
    this.generation++;
    this.clearCaptureTimer();
    this.currentQueue?.discard(); this.currentQueue = undefined;
    this.wakeQueue?.discard(); this.wakeQueue = undefined;
    this.wakeController?.abort(); this.wakeController = undefined;
    this.turnController?.abort(); this.turnController = undefined;
    this.turn = undefined;
    this.setPhase('paused');
    this.stopRemote();
  }

  private stopRemote(): void {
    if (!this.remoteActive) return;
    this.remoteStopRequested = true;
    const id = this.remoteRunId;
    if (id) void this.options.hermes.stopRun(id).catch(() => {});
  }

  private notifySettled(): void {
    if (this.settledNotified) return;
    this.settledNotified = true;
    this.options.onRemoteSettled?.();
  }

  private fail(code: string): void {
    const turn = this.turn;
    if (!this.closed) this.send({ type: 'error', code, turn: turn ?? null });
    this.pause();
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    if (phase !== 'closed') this.send({ type: 'state', phase, turn: this.turn ?? null });
  }

  private isCurrent(generation: number, turn: number): boolean { return !this.closed && this.generation === generation && this.turn === turn; }
  private clearCaptureTimer(): void { if (this.captureTimer) clearTimeout(this.captureTimer); this.captureTimer = undefined; }
  private safeName(name: unknown): string { return typeof name === 'string' ? name.slice(0, 128) : this.options.settings.wakeModel.slice(0, 128); }
  private send(event: object): void { if (!this.closed) this.options.socket.send(json(event)); }
}
