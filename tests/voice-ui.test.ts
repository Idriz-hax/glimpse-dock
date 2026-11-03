import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountVoice } from '../src/display/voice';

class Element {
  disabled = false; textContent = ''; text = ''; dataset: Record<string, string> = {}; children: Element[] = []; listeners: Record<string, (event?: unknown) => void> = {};
  addEventListener(type: string, listener: (event?: unknown) => void) { this.listeners[type] = listener; }
  click() { return this.listeners.click?.(); }
  append(child: Element) { this.children.push(child); }
  replaceChildren(...children: Element[]) { this.children = children; }
}

describe('owner voice controls', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('does not request a microphone until explicit enable and announces denial', async () => {
    const els = Object.fromEntries(['[data-voice-status]', '[data-voice-error]', '[data-transcript]', '[data-subagents]', '[data-voice-enable]', '[data-voice-manual]', '[data-voice-pause]', '[data-voice-mute]', '[data-voice-stop]'].map(key => [key, new Element()]));
    const root = { querySelector: (selector: string) => els[selector as keyof typeof els] };
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } }); vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const cleanup = mountVoice(root as never);
    expect(getUserMedia).not.toHaveBeenCalled();
    await els['[data-voice-enable]'].click();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    expect(els['[data-voice-error]'].textContent).toContain('permission was denied');
    cleanup();
  });

  it('follows the wire controls, ignores stale turns, and acknowledges playback only for its turn', async () => {
    const selectors = ['[data-voice-status]', '[data-voice-error]', '[data-transcript]', '[data-subagents]', '[data-voice-enable]', '[data-voice-manual]', '[data-voice-pause]', '[data-voice-mute]', '[data-voice-stop]'];
    const els = Object.fromEntries(selectors.map(key => [key, new Element()]));
    const root = { querySelector: (selector: string) => els[selector as keyof typeof els] };
    let socket!: FakeSocket, worklet!: FakeWorklet, source!: FakeBufferSource;
    class FakeSocket {
      static OPEN = 1; static CLOSING = 2; readyState = 0; binaryType = ''; onopen?: () => void; onmessage?: (event: { data: string | ArrayBuffer }) => void; onclose?: () => void; onerror?: () => void; sent: (string | ArrayBuffer)[] = [];
      constructor() { socket = this; }
      send(data: string | ArrayBuffer) { this.sent.push(data); }
      close() { this.readyState = 3; this.onclose?.(); }
      open() { this.readyState = 1; this.onopen?.(); }
      receive(value: object | ArrayBuffer) { this.onmessage?.({ data: value instanceof ArrayBuffer ? value : JSON.stringify(value) }); }
    }
    class FakeWorklet { port: { onmessage?: (event: { data: unknown }) => void; postMessage: ReturnType<typeof vi.fn> } = { postMessage: vi.fn() }; connect() {} disconnect() {} }
    class FakeContext {
      state = 'running'; destination = {}; audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
      createBuffer(_channels: number, frames: number) { return { getChannelData: () => new Float32Array(frames) }; }
      createBufferSource() { source = { buffer: null, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }; return source; }
      resume() { return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); }
    }
    const track = { stop: vi.fn() }, getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } }); vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' }); vi.stubGlobal('WebSocket', FakeSocket); vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('AudioWorkletNode', class extends FakeWorklet { constructor() { super(); worklet = this; } }); vi.stubGlobal('document', { createElement: () => new Element() });
    const cleanup = mountVoice(root as never);
    expect(getUserMedia).not.toHaveBeenCalled();
    await els['[data-voice-enable]'].click(); socket.open();
    expect(socket.sent[0]).toBe(JSON.stringify({ type: 'resume' }));
    await els['[data-voice-manual]'].click(); await els['[data-voice-pause]'].click(); await els['[data-voice-pause]'].click(); await els['[data-voice-stop]'].click();
    expect(socket.sent).toContain(JSON.stringify({ type: 'manual-start' }));
    expect(socket.sent).toContain(JSON.stringify({ type: 'pause' })); expect(socket.sent).toContain(JSON.stringify({ type: 'resume' })); expect(socket.sent).toContain(JSON.stringify({ type: 'stop' }));
    worklet.port.onmessage?.({ data: { type: 'audio', pcm: new Int16Array(1600) } });
    expect((socket.sent.find(item => item instanceof ArrayBuffer) as ArrayBuffer).byteLength).toBe(3200);
    socket.receive({ type: 'state', phase: 'capturing', turn: 2 });
    socket.receive({ type: 'transcript', text: '<img src=x>', turn: 2 }); socket.receive({ type: 'transcript', text: 'stale', turn: 1 });
    expect(els['[data-transcript]'].children[0].textContent).toBe('You: <img src=x>'); expect(els['[data-transcript]'].children).toHaveLength(1);
    socket.receive({ type: 'tts-start', rate: 16000, width: 2, channels: 1, bytes: 2, turn: 2 }); socket.receive(new Int16Array([123]).buffer);
    await Promise.resolve(); await Promise.resolve(); socket.receive({ type: 'tts-end', turn: 2 }); const oldSource = source; oldSource.onended?.();
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: 'playback-ended', turn: 2 }));
    socket.receive({ type: 'state', phase: 'wake', turn: 3 }); oldSource.onended?.();
    expect(socket.sent.filter(item => item === JSON.stringify({ type: 'playback-ended', turn: 2 }))).toHaveLength(1);
    socket.receive({ type: 'state', phase: 'paused', turn: null });
    socket.receive({ type: 'transcript', text: 'late old turn', turn: 3 });
    expect(els['[data-transcript]'].children).toHaveLength(1);
    socket.receive({ type: 'state', phase: 'capturing', turn: 4 });
    socket.receive({ type: 'transcript', text: 'new turn', turn: 4 });
    expect(els['[data-transcript]'].children[1].textContent).toBe('You: new turn');
    socket.receive({ type: 'error', code: 'VOICE_UNAVAILABLE', turn: null });
    expect(els['[data-voice-error]'].textContent).toContain('Local speech service is unavailable');
    els['[data-voice-error]'].textContent = '';
    socket.receive({ type: 'error', code: 'STALE', turn: 3 });
    expect(els['[data-voice-error]'].textContent).toBe('');
    cleanup(); expect(track.stop).toHaveBeenCalled();
  });
});
