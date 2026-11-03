import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountVoice } from '../src/display/voice';

class Element {
  disabled = false; textContent = ''; text = ''; listeners: Record<string, (event?: unknown) => void> = {};
  addEventListener(type: string, listener: (event?: unknown) => void) { this.listeners[type] = listener; }
  click() { return this.listeners.click?.(); }
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
});
