export function mountVoice(root: ParentNode): () => void {
  const status = root.querySelector<HTMLElement>('[data-voice-status]'), error = root.querySelector<HTMLElement>('[data-voice-error]'), transcript = root.querySelector<HTMLElement>('[data-transcript]'), subagents = root.querySelector<HTMLElement>('[data-subagents]');
  const enable = root.querySelector<HTMLButtonElement>('[data-voice-enable]'), manual = root.querySelector<HTMLButtonElement>('[data-voice-manual]'), pause = root.querySelector<HTMLButtonElement>('[data-voice-pause]'), mute = root.querySelector<HTMLButtonElement>('[data-voice-mute]'), stop = root.querySelector<HTMLButtonElement>('[data-voice-stop]');
  if (!status || !error || !transcript || !subagents || !enable || !manual || !pause || !mute || !stop) return () => {};
  let socket: WebSocket | undefined, stream: MediaStream | undefined, context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined, processor: AudioWorkletNode | undefined, audio: HTMLAudioElement | undefined, paused = false, muted = false;
  const announce = (text: string) => { status.textContent = text; };
  const addLine = (who: string, text: string) => { const line = document.createElement('p'); line.textContent = `${who}: ${text}`; transcript.append(line); };
  const stopCapture = () => { processor?.disconnect(); source?.disconnect(); stream?.getTracks().forEach(track => track.stop()); processor = undefined; source = undefined; stream = undefined; void context?.close(); context = undefined; };
  const disable = () => { stopCapture(); audio?.pause(); audio = undefined; if (socket && socket.readyState < WebSocket.CLOSING) socket.close(); socket = undefined; enable.disabled = false; manual.disabled = pause.disabled = mute.disabled = stop.disabled = true; announce('Voice is off'); };
  const send = (value: object) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  const capture = async () => {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    context = new AudioContext(); source = context.createMediaStreamSource(stream);
    const code = `class Capture extends AudioWorkletProcessor { process(inputs) { const input=inputs[0]?.[0]; if(input){const stride=sampleRate/16000, out=new Int16Array(Math.floor(input.length/stride)); for(let i=0;i<out.length;i++)out[i]=Math.max(-1,Math.min(1,input[Math.floor(i*stride)]))*32767; this.port.postMessage(out,[out.buffer]);} return true; } } registerProcessor('glimpse-capture',Capture);`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    processor = new AudioWorkletNode(context, 'glimpse-capture'); processor.port.onmessage = event => { if (!paused && !muted && socket?.readyState === WebSocket.OPEN) socket.send(event.data); };
    source.connect(processor); processor.connect(context.destination);
  };
  enable.addEventListener('click', async () => {
    enable.disabled = true; error.textContent = ''; announce('Requesting microphone permission');
    try {
      await capture(); socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/voice/session`); socket.binaryType = 'arraybuffer';
      socket.onopen = () => { send({ type: 'resume' }); manual.disabled = pause.disabled = mute.disabled = stop.disabled = false; announce('Listening for Hey Hermes'); };
      socket.onmessage = event => { if (typeof event.data !== 'string') { audio = new Audio(URL.createObjectURL(new Blob([event.data], { type: 'audio/wav' }))); audio.onended = () => send({ type: 'playback-ended' }); void audio.play(); announce('Hermes is speaking'); return; }
        try { const msg = JSON.parse(event.data); if (msg.type === 'transcript') addLine('You', String(msg.text ?? '')); if (msg.type === 'delta') addLine('Hermes', String(msg.text ?? '')); if (msg.type === 'subagent') { const item = document.createElement('span'); item.textContent = `${String(msg.name ?? msg.id ?? 'Subagent')} · ${String(msg.status ?? 'active')}`; subagents.replaceChildren(item); } if (msg.type === 'error') { error.textContent = String(msg.message ?? 'Voice request failed'); announce('Voice request failed'); } }
        catch { error.textContent = 'Received an invalid voice update.'; }
      };
      socket.onclose = () => { stopCapture(); manual.disabled = pause.disabled = mute.disabled = stop.disabled = true; enable.disabled = false; announce('Voice connection lost'); error.textContent = 'Connection lost. Enable voice to reconnect.'; };
      socket.onerror = () => { error.textContent = 'Voice service disconnected. Check that local speech services are running.'; };
    } catch (cause) { stopCapture(); enable.disabled = false; error.textContent = cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser settings, then try again.' : 'Could not start the microphone. Check your browser and audio device.'; announce('Microphone unavailable'); }
  });
  manual.addEventListener('click', () => { send({ type: 'manual-start' }); announce('Listening for your turn'); });
  pause.addEventListener('click', () => { paused = !paused; send({ type: paused ? 'pause' : 'resume' }); pause.textContent = paused ? 'Resume listening' : 'Pause listening'; announce(paused ? 'Listening paused' : 'Listening for Hey Hermes'); });
  mute.addEventListener('click', () => { muted = !muted; mute.textContent = muted ? 'Unmute' : 'Mute'; });
  stop.addEventListener('click', () => { send({ type: 'stop' }); audio?.pause(); stopCapture(); announce('Stopped'); });
  const pagehide = () => disable(); window.addEventListener('pagehide', pagehide);
  return () => { window.removeEventListener('pagehide', pagehide); disable(); };
}
