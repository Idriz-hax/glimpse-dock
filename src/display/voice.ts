import workletUrl from './voice-worklet.ts?worker&url';

type VoiceEvent =
  | { type: 'state'; phase: 'paused' | 'wake' | 'capturing' | 'transcribing' | 'running' | 'speaking'; turn: number | null }
  | { type: 'wake'; name: string; turn: number }
  | { type: 'transcript' | 'assistant.delta'; text: string; turn: number }
  | { type: 'subagent'; action: 'start' | 'complete'; subagentId: string; turn: number }
  | { type: 'tts-start'; rate: number; width: number; channels: number; bytes: number; turn: number }
  | { type: 'tts-end'; turn: number }
  | { type: 'error'; code: string; turn: number | null };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function parseEvent(value: unknown): VoiceEvent | null {
  if (!isRecord(value)) return null;
  const turn = value.turn;
  const numericTurn = Number.isSafeInteger(turn) && (turn as number) >= 0 ? turn as number : null;
  if (value.type === 'state' && (numericTurn !== null || turn === null) && ['paused', 'wake', 'capturing', 'transcribing', 'running', 'speaking'].includes(String(value.phase))) return { type: 'state', phase: value.phase as Extract<VoiceEvent, { type: 'state' }>['phase'], turn: numericTurn };
  if (numericTurn === null) return value.type === 'error' && turn === null && typeof value.code === 'string' ? { type: 'error', code: value.code, turn: null } : null;
  const activeTurn = numericTurn;
  if (value.type === 'wake' && typeof value.name === 'string') return { type: 'wake', name: value.name, turn: activeTurn };
  if ((value.type === 'transcript' || value.type === 'assistant.delta') && typeof value.text === 'string') return { type: value.type, text: value.text, turn: activeTurn };
  if (value.type === 'subagent' && (value.action === 'start' || value.action === 'complete') && typeof value.subagentId === 'string') return { type: 'subagent', action: value.action, subagentId: value.subagentId, turn: activeTurn };
  if (value.type === 'tts-start' && [value.rate, value.width, value.channels, value.bytes].every(Number.isSafeInteger) && (value.bytes as number) > 0 && (value.bytes as number) <= 8 * 1024 * 1024) return { type: 'tts-start', rate: value.rate as number, width: value.width as number, channels: value.channels as number, bytes: value.bytes as number, turn: activeTurn };
  if (value.type === 'tts-end') return { type: 'tts-end', turn: activeTurn };
  if (value.type === 'error' && typeof value.code === 'string') return { type: 'error', code: value.code, turn: activeTurn };
  return null;
}

export function mountVoice(root: ParentNode): () => void {
  const status = root.querySelector<HTMLElement>('[data-voice-status]'), error = root.querySelector<HTMLElement>('[data-voice-error]'), transcript = root.querySelector<HTMLElement>('[data-transcript]'), subagents = root.querySelector<HTMLElement>('[data-subagents]');
  const enable = root.querySelector<HTMLButtonElement>('[data-voice-enable]'), manual = root.querySelector<HTMLButtonElement>('[data-voice-manual]'), pause = root.querySelector<HTMLButtonElement>('[data-voice-pause]'), mute = root.querySelector<HTMLButtonElement>('[data-voice-mute]'), stop = root.querySelector<HTMLButtonElement>('[data-voice-stop]');
  if (!status || !error || !transcript || !subagents || !enable || !manual || !pause || !mute || !stop) return () => {};
  let socket: WebSocket | undefined, stream: MediaStream | undefined, context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined, processor: AudioWorkletNode | undefined, silent: GainNode | undefined, playback: AudioBufferSourceNode | undefined;
  let paused = false, muted = false, currentTurn: number | null = null, tts: Extract<VoiceEvent, { type: 'tts-start' }> | undefined, ttsBytes: ArrayBuffer | undefined;
  const roster = new Map<string, 'active' | 'complete'>();
  const announce = (text: string) => { status.textContent = text; };
  const addLine = (who: string, text: string) => { const line = document.createElement('p'); line.textContent = `${who}: ${text}`; transcript.append(line); };
  const send = (value: object) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  const stopPlayback = () => { try { playback?.stop(); } catch { /* Playback may have ended between the UI event and stop. */ } playback?.disconnect(); playback = undefined; tts = undefined; ttsBytes = undefined; };
  const stopCapture = () => { processor?.port.postMessage('end'); processor?.disconnect(); silent?.disconnect(); source?.disconnect(); stream?.getTracks().forEach(track => track.stop()); processor = undefined; silent = undefined; source = undefined; stream = undefined; void context?.close(); context = undefined; };
  const disable = () => { send({ type: 'stop' }); stopPlayback(); if (socket && socket.readyState < WebSocket.CLOSING) socket.close(); socket = undefined; stopCapture(); enable.disabled = false; enable.textContent = 'Enable voice'; manual.disabled = pause.disabled = mute.disabled = stop.disabled = true; announce('Voice is off'); };
  const failProtocol = () => { error.textContent = 'The voice service sent an invalid update. Re-enable voice to reconnect.'; announce('Voice update invalid'); disable(); };
  const playPcm = async (raw: ArrayBuffer, meta: Extract<VoiceEvent, { type: 'tts-start' }>) => {
    if (meta.bytes !== raw.byteLength || raw.byteLength > 8 * 1024 * 1024 || meta.width !== 2 || ![1, 2].includes(meta.channels) || meta.rate < 8000 || meta.rate > 96000 || raw.byteLength % (meta.width * meta.channels) !== 0) throw new Error('Invalid audio frame');
    if (!context || context.state === 'closed') context = new AudioContext();
    const samples = new Int16Array(raw), count = samples.length / meta.channels, buffer = context.createBuffer(meta.channels, count, meta.rate);
    for (let channel = 0; channel < meta.channels; channel++) { const data = buffer.getChannelData(channel); for (let i = 0; i < count; i++) data[i] = Math.max(-1, samples[i * meta.channels + channel] / 32768); }
    playback = context.createBufferSource(); playback.buffer = buffer; playback.connect(context.destination);
    playback.onended = () => { playback?.disconnect(); playback = undefined; if (meta.turn === currentTurn) { send({ type: 'playback-ended', turn: meta.turn }); announce('Listening for Hey Hermes'); } };
    await context.resume(); playback.start(); announce('Hermes is speaking');
  };
  const onEvent = (event: VoiceEvent) => {
    if (event.type === 'state') {
      if (event.turn === null) { stopPlayback(); currentTurn = null; }
      else { if (currentTurn !== null && event.turn < currentTurn) return; if (currentTurn === null || event.turn > currentTurn) stopPlayback(); currentTurn = event.turn; }
      announce(event.phase === 'wake' ? 'Listening for Hey Hermes' : event.phase === 'paused' ? 'Listening paused' : event.phase === 'speaking' ? 'Hermes is speaking' : `Voice ${event.phase}`);
    }
    else if (event.type === 'error') { if (event.turn !== null && (currentTurn === null || event.turn !== currentTurn)) return; stopPlayback(); error.textContent = event.code === 'VOICE_UNAVAILABLE' ? 'Local speech service is unavailable. Check that it is running.' : 'Voice request failed. You can try again.'; announce('Voice request failed'); }
    else if (event.turn === null || currentTurn === null || event.turn !== currentTurn) return;
    else if (event.type === 'wake') announce(`${event.name} heard · listening`);
    else if (event.type === 'transcript') addLine('You', event.text);
    else if (event.type === 'assistant.delta') addLine('Hermes', event.text);
    else if (event.type === 'subagent') { roster.set(event.subagentId, event.action === 'start' ? 'active' : 'complete'); subagents.replaceChildren(...Array.from(roster, ([id, state]) => { const item = document.createElement('p'); item.dataset.subagentId = id; item.textContent = `${id} · ${state}`; return item; })); }
    else if (event.type === 'tts-start') { if (event.bytes < 0 || event.bytes > 8 * 1024 * 1024 || tts) return failProtocol(); tts = event; ttsBytes = undefined; }
    else if (event.type === 'tts-end') { if (!tts || event.turn !== tts.turn || !ttsBytes) return failProtocol(); tts = undefined; ttsBytes = undefined; }
  };
  const capture = async () => {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    context = new AudioContext(); source = context.createMediaStreamSource(stream); await context.audioWorklet.addModule(workletUrl);
    processor = new AudioWorkletNode(context, 'voice-frame-processor');
    processor.port.onmessage = event => {
      if (event.data?.type === 'audio' && !paused && !muted && socket?.readyState === WebSocket.OPEN) {
        const pcm = event.data.pcm as Int16Array; if (pcm.byteLength <= 64 * 1024) socket.send(pcm.buffer);
      }
    };
    silent = context.createGain(); silent.gain.value = 0; source.connect(processor); processor.connect(silent); silent.connect(context.destination);
  };
  enable.addEventListener('click', async () => {
    if (socket) { disable(); return; }
    enable.disabled = true; error.textContent = ''; announce('Requesting microphone permission');
    try {
      await capture(); socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/voice/session`); socket.binaryType = 'arraybuffer';
      socket.onopen = () => { send({ type: 'resume' }); enable.disabled = false; enable.textContent = 'Disable voice'; manual.disabled = pause.disabled = mute.disabled = stop.disabled = false; announce('Starting voice service'); };
      socket.onmessage = event => {
        if (typeof event.data !== 'string') { if (!tts || event.data.byteLength !== tts.bytes || ttsBytes) return failProtocol(); const meta = tts; ttsBytes = event.data; void playPcm(event.data, meta).catch(failProtocol); return; }
        try { const parsed = parseEvent(JSON.parse(event.data)); if (!parsed) return failProtocol(); onEvent(parsed); } catch { failProtocol(); }
      };
      socket.onclose = () => { stopPlayback(); stopCapture(); socket = undefined; manual.disabled = pause.disabled = mute.disabled = stop.disabled = true; enable.disabled = false; enable.textContent = 'Enable voice'; announce('Voice connection lost'); error.textContent = 'Connection lost. Enable voice to reconnect.'; };
      socket.onerror = () => { error.textContent = 'Voice service disconnected. Check that local speech services are running.'; };
    } catch (cause) { stopCapture(); enable.disabled = false; error.textContent = cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser settings, then try again.' : 'Could not start the microphone. Check your browser and audio device.'; announce('Microphone unavailable'); }
  });
  manual.addEventListener('click', () => { if (muted) { announce('Unmute the microphone to speak'); return; } paused = false; pause.textContent = 'Pause listening'; send({ type: 'manual-start' }); announce('Listening for your turn'); });
  pause.addEventListener('click', () => { paused = !paused; send({ type: paused ? 'pause' : 'resume' }); pause.textContent = paused ? 'Resume listening' : 'Pause listening'; announce(paused ? 'Listening paused' : 'Listening for Hey Hermes'); });
  mute.addEventListener('click', () => { muted = !muted; mute.textContent = muted ? 'Unmute microphone' : 'Mute microphone'; announce(muted ? 'Microphone muted' : 'Microphone unmuted'); });
  stop.addEventListener('click', () => { send({ type: 'stop' }); stopPlayback(); announce('Current turn stopped'); });
  const pagehide = () => disable(); window.addEventListener('pagehide', pagehide);
  return () => { window.removeEventListener('pagehide', pagehide); disable(); };
}
