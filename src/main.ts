import './style.css';
import './display.css';
import './auth/auth.css';
import { resolveRoute } from './routes';
import { renderDisplay } from './display/view';
import { mountDisplayWidgets } from './display/widgets';
import { bindAdminEvents, renderAdmin, type AdminPage } from './admin/view';
import { renderDisplayGate, renderOwnerGate } from './auth/view';
import { type State } from './demo-state';
import { commandForInput, validSnapshot, parseStateMessage } from './frontend-client';
import { StateMessageSchema } from './shared/protocol';

const app = document.querySelector<HTMLDivElement>('#app')!;
const displayMode = resolveRoute(location.pathname) === 'display';
let page: AdminPage = 'overview', state: State | null = null, role: string | null = null, csrf = '', demoMode = false;
let authMode: 'setup' | 'login' = 'login', gateError = '', gateStatus = '', gatePending = false, pairingCode = '', pairingStatus = '', pairingError = '', pairingPending = false;
let socket: WebSocket | undefined, retry = 0, reconnectTimer: number | undefined, toastTimer: number | undefined;
let streamConnected = false;
const id = () => crypto.randomUUID();

function render() {
  document.body.classList.toggle('display-mode', displayMode);
  if (!role || (!displayMode && role !== 'owner')) { app.innerHTML = displayMode ? renderDisplayGate({ error: gateError, status: gateStatus, pending: gatePending }) : renderOwnerGate({ mode: authMode, error: gateError || (role === 'display' ? 'Display access is read-only. Sign in with an owner account.' : ''), status: gateStatus, pending: gatePending }); bindGate(); return; }
  if (!state) { app.textContent = 'Loading workspace…'; return; }
  if (displayMode) { app.innerHTML = renderDisplay(state, demoMode, streamConnected); mountDisplayWidgets(app, state.widgets); return; }
  app.innerHTML = renderAdmin(state, page, { demoMode, pairing: { code: pairingCode, status: pairingStatus, error: pairingError, pending: pairingPending } });
  bindAdminEvents(app, { page: next => { page = next; render(); }, simulate: () => send('demo.simulate', {}), toggle: () => send('demo.set-enabled', { enabled: !state!.running }), command: runCommand, addWidget: () => send('widget.create', { widget: { version: 1, id: `custom-${Date.now()}`, title: 'Sample metric', content: { kind: 'metric', label: 'Sample metric', value: '0', caption: 'Created locally' }, placement: 'secondary', expiresAt: null } }), reset: () => send('demo.reset', {}), displayStyle: async style => { await send('display.set-style', { style }); render(); }, pair: pairDisplay, logout });
}
function bindGate() {
  app.querySelector<HTMLButtonElement>('[data-auth-mode]')?.addEventListener('click', event => { authMode = (event.currentTarget as HTMLElement).dataset.authMode as 'setup' | 'login'; gateError = ''; render(); });
  app.querySelector<HTMLFormElement>('[data-auth-form]')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); gatePending = true; gateError = ''; render();
    try {
      const display = displayMode, mode = (event.currentTarget as HTMLFormElement).dataset.mode;
      const result = await request(display ? '/api/display/redeem' : mode === 'setup' ? '/api/setup' : '/api/login', display ? { code: String(form.get('code') ?? '') } : mode === 'setup' ? { secret: String(form.get('secret') ?? ''), password: String(form.get('password') ?? '') } : { password: String(form.get('password') ?? '') });
      role = result.role; csrf = result.csrf ?? ''; demoMode = result.demoEnabled === true; await loadState(); connect();
    } catch (error) { gateError = message(error); } finally { gatePending = false; render(); }
  });
}
async function request(path: string, body?: unknown) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401) unauthenticated(); throw new Error(result?.error?.message || `Request failed (${response.status})`); }
  return result;
}
function message(error: unknown) { return error instanceof Error ? error.message : 'Network request failed'; }
function unauthenticated() { socket?.close(); role = null; state = null; csrf = ''; gateError = 'Your session expired. Please sign in again.'; render(); }
async function loadState() { const snapshot = validSnapshot(await request('/api/state')); if (!snapshot) throw new Error('Server returned an invalid workspace snapshot.'); state = snapshot; render(); }
function connect() {
  clearTimeout(reconnectTimer); socket?.close();
  const currentSocket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/stream`);
  socket = currentSocket;
  currentSocket.onmessage = event => {
    if (socket !== currentSocket) return;
    try { const value: unknown = JSON.parse(String(event.data)); const parsed = StateMessageSchema.safeParse(value); const msg = parsed.success ? parseStateMessage(parsed.data) : null; if (!msg) throw new Error('Invalid state update'); state = msg.state; streamConnected = true; retry = 0; render(); } catch { currentSocket.close(); }
  };
  currentSocket.onclose = () => {
    if (socket !== currentSocket) return;
    streamConnected = false; render(); reconnectTimer = window.setTimeout(async () => { if (socket !== currentSocket) return; try { await loadState(); if (socket !== currentSocket) return; connect(); } catch (error) { if (socket !== currentSocket) return; gateError = message(error); scheduleReconnect(); } }, Math.min(1000 * 2 ** retry++, 30000));
  };
}
function scheduleReconnect() { reconnectTimer = window.setTimeout(connect, Math.min(1000 * 2 ** retry++, 30000)); }
async function send(type: string, payload: object) {
  try { await request('/api/command', { csrf, v: 1, requestId: id(), type, payload }); await loadState(); notify('Command accepted'); }
  catch (error) { if (role) notify(message(error)); }
}
function runCommand(value: string) {
  const mapped = commandForInput(value, id());
  if (!mapped) { if (value.trim()) notify('Unknown command. Try one of the examples.'); return; }
  void send(mapped.type, mapped.payload);
}
async function pairDisplay() {
  pairingPending = true; pairingError = ''; pairingStatus = ''; render();
  try { const result = await request('/api/display/pair', { csrf }); pairingCode = result.code; pairingStatus = 'Code ready — enter it on your display.'; }
  catch (error) { pairingError = message(error); }
  finally { pairingPending = false; render(); }
}
async function logout() { try { await request('/api/logout', { csrf }); } catch { /* Session is cleared locally regardless. */ } unauthenticated(); }
function notify(text: string) { const toast = app.querySelector<HTMLElement>('#toast'); if (!toast) return; toast.textContent = text; toast.classList.add('visible'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3000); }
async function start() {
  try { const session = await request('/api/session'); role = session.role; csrf = session.csrf ?? ''; demoMode = session.demoEnabled === true; if (!role) { authMode = session.setupRequired ? 'setup' : 'login'; render(); return; } if (!displayMode && role !== 'owner') { gateError = 'Display access is read-only. Sign in with an owner account.'; authMode = 'login'; render(); return; } await loadState(); connect(); }
  catch (error) { gateError = message(error); role = null; render(); }
}
void start();
