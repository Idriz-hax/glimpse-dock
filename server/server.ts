import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, X509Certificate } from 'node:crypto';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
import { containsAddress, normalizeAddress, parseCidr } from './lan-policy.ts';
import { canTransitionActivity, CommandRequestSchema, ProtocolStateSchema, type CommandRequest } from '../src/shared/protocol.ts';
import { createDemoState, transitionDemo } from './adapters/demo.ts';
import { createWidget, updateWidget, setWidgetVisibility, removeWidget, removeExpiredWidgets, type WidgetPrincipal } from './widgets.ts';
import { HermesApiClient } from './voice/hermes-api.ts';
import { WyomingVoiceClient } from './voice/wyoming.ts';
import { VoiceSession } from './voice/session.ts';

const scrypt = promisify(scryptCb);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const errorBody = (code: string, message: string, requestId = 'request') => ({ v: 1, error: { code, message, requestId } });
const isLoopback = (host: string) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase());
const normalizeUsername = (value: string) => value.trim().toLowerCase();
const validUsername = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9._-]{3,32}$/.test(value.trim());
const sameLoopbackOrigin = (origin: string | undefined, host: string | undefined) => {
  if (!origin || !host) return false;
  try {
    const requestOrigin = new URL(origin);
    const targetOrigin = new URL(`http://${host}`);
    return requestOrigin.protocol === 'http:' && isLoopback(requestOrigin.hostname) && isLoopback(targetOrigin.hostname) && requestOrigin.origin === targetOrigin.origin;
  } catch { return false; }
};
const empty = ProtocolStateSchema.parse({ agent: '', task: '', progress: 0, running: false, widgets: [], logs: [] });
type VoiceHermesClient = Pick<HermesApiClient, 'createSession' | 'startRun' | 'stopRun' | 'readRunEvents'>;
type VoiceWyomingClient = Pick<WyomingVoiceClient, 'listWakeModels' | 'listVoices' | 'detectWake' | 'transcribe' | 'synthesize'>;
type ListenerPolicy = ReturnType<typeof validateListenerConfig>;
const validatedPolicies = new WeakSet<object>();
const listenerPolicy = <T extends object>(value: T): T => { const result = Object.freeze(value); validatedPolicies.add(result); return result; };
type Options = { database?: string; bootstrapSecret?: string; host?: string; port?: number; listener?: ListenerPolicy; demo?: boolean; localAutoAccess?: 'off' | 'display' | 'owner'; now?: () => number; voiceClients?: { hermes?: VoiceHermesClient; wyoming?: VoiceWyomingClient } };

function sameOrigin(origin: string | undefined, host: string | undefined, listener: ListenerPolicy): boolean {
  if (!origin || !host) return false;
  if (listener.lan) {
    try { if (isLoopback(new URL(`http://${host}`).hostname) && sameLoopbackOrigin(origin, host)) return true; } catch { return false; }
    return origin === listener.origin && host === new URL(listener.origin!).host;
  }
  return sameLoopbackOrigin(origin, host);
}

export function validateListenerConfig(env: NodeJS.ProcessEnv = process.env, interfaces = networkInterfaces()) {
  const host = env.HOST ?? '127.0.0.1', port = Number(env.PORT ?? 4174), mode = env.GLIMPSE_LAN_MODE;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid listener port');
  if (!mode) {
    if (!isLoopback(host)) throw new Error('LAN listener requires explicit GLIMPSE_LAN_MODE');
    return listenerPolicy({ host, port, secure: false as const, lan: false as const, origin: undefined, trustedCidr: undefined });
  }
  if (mode !== 'http' && mode !== 'https') throw new Error('Invalid LAN mode');
  const normalizedHost = normalizeAddress(host);
  if (!normalizedHost || isLoopback(host) || normalizedHost === '0.0.0.0' || normalizedHost === '::') throw new Error('Invalid LAN bind address');
  const assigned = Object.values(interfaces).flatMap(items => items ?? []).some(item => normalizeAddress(item.address) === normalizedHost);
  if (!assigned) throw new Error('LAN bind address is not assigned to this host');
  const cidr = env.GLIMPSE_TRUSTED_CIDR;
  if (!cidr) throw new Error('A trusted private CIDR is required');
  let trustedCidr;
  try { trustedCidr = parseCidr(cidr); } catch { throw new Error('Invalid trusted private CIDR'); }
  if (!containsAddress(trustedCidr, host)) throw new Error('Trusted CIDR must contain bind address');
  const scheme = mode === 'https' ? 'https' : 'http';
  const authorityHost = isIP(host) === 6 ? `[${host}]` : host;
  const authority = `${authorityHost}:${port}`;
  const origin = `${scheme}://${authority}`;
  if (env.GLIMPSE_LAN_ORIGIN !== origin) throw new Error('Exact LAN origin must match listener scheme, address, and port');
  if (mode === 'https') {
    if (!env.GLIMPSE_TLS_CERT || !env.GLIMPSE_TLS_KEY) throw new Error('TLS certificate and key are required');
    try {
      const https = { cert: readFileSync(env.GLIMPSE_TLS_CERT), key: readFileSync(env.GLIMPSE_TLS_KEY) };
      createSecureContext(https);
      const certificate = new X509Certificate(https.cert);
      const validAt = Date.now();
      if (Date.parse(certificate.validFrom) > validAt || Date.parse(certificate.validTo) < validAt
        || !(isIP(host) ? certificate.checkIP(host) : certificate.checkHost(host, { subject: 'never' }))) {
        throw new Error('TLS certificate identity or validity check failed');
      }
      return listenerPolicy({ host, port, secure: true as const, lan: true as const, origin, trustedCidr, https });
    } catch { throw new Error('TLS certificate/key are unreadable or do not match'); }
  }
  if (env.GLIMPSE_LAN_HTTP_INSECURE !== '1') throw new Error('LAN HTTP requires GLIMPSE_LAN_HTTP_INSECURE=1');
  return listenerPolicy({ host, port, secure: false as const, lan: true as const, origin, trustedCidr });
}

export function parseLocalAutoAccess(value: string | undefined): 'off' | 'display' | 'owner' {
  const mode = value ?? 'off';
  if (!['off', 'display', 'owner'].includes(mode)) throw new Error('Invalid server configuration');
  return mode as 'off' | 'display' | 'owner';
}
export function warnOwnerAutoAccess(mode: 'off' | 'display' | 'owner', warn = console.warn): void {
  if (mode === 'owner') warn('WARNING: GLIMPSE_LOCAL_AUTO_ACCESS=owner grants owner access to any local browser able to reach this service.');
}

function configuredHermesUrl(value: string | undefined): string | undefined {
  const candidate = value ?? 'http://127.0.0.1:8642';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' || !isLoopback(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return;
    return url.origin;
  } catch { return; }
}

export async function createServer(options: Options = {}): Promise<FastifyInstance> {
  const listener = options.listener ?? validateListenerConfig();
  if (!validatedPolicies.has(listener)) throw new Error('Listener policy must be validated before server creation');
  if (options.host && options.host !== listener.host || options.port !== undefined && options.port !== listener.port) throw new Error('Server options must match validated listener configuration');
  const db = new Database(options.database ?? 'glimpse-dock.sqlite');
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, role TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS agents (digest TEXT PRIMARY KEY, revoked INTEGER NOT NULL DEFAULT 0, agent_id TEXT);
    CREATE TABLE IF NOT EXISTS widget_commands (principal TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(principal,request_id));
     CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, detail TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS diagnostics (id INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL, category TEXT NOT NULL, code TEXT NOT NULL, status INTEGER NOT NULL);`);
    const recordDiagnostic = (category: 'command' | 'persistence', code: 'COMMAND_ACCEPTED' | 'INVALID_COMMAND' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT' | 'PERSISTENCE_FAILED', status: number) => {
     try { db.prepare('INSERT INTO diagnostics(timestamp,category,code,status) VALUES (?,?,?,?)').run(Date.now(), category, code, status); db.prepare('DELETE FROM diagnostics WHERE id NOT IN (SELECT id FROM diagnostics ORDER BY id DESC LIMIT 200)').run(); } catch { /* diagnostics must not disrupt command handling */ }
   };
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (1)').run();
   db.transaction(() => {
     if (!db.prepare('SELECT 1 FROM pragma_table_info(\'agents\') WHERE name=\'agent_id\'').get()) db.exec('ALTER TABLE agents ADD COLUMN agent_id TEXT');
     for (const row of db.prepare('SELECT digest FROM agents WHERE agent_id IS NULL').all() as any[]) db.prepare('UPDATE agents SET agent_id=? WHERE digest=?').run(randomUUID(), row.digest);
     db.exec('CREATE UNIQUE INDEX IF NOT EXISTS agents_agent_id ON agents(agent_id)');
     db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)').run();
    })();
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (3)').run();
   const now = options.now ?? Date.now;
  const read = (key: string) => db.prepare('SELECT value FROM kv WHERE key=?').get(key) as {value:string}|undefined;
    let state = read('state') ? ProtocolStateSchema.parse(JSON.parse(read('state')!.value)) : options.demo ? createDemoState(now()) : empty;
   let revision = Number(read('revision')?.value ?? 0);
    let source = read('source')?.value ?? (options.demo ? 'demo' : 'owner');
   const sockets = new Map<string, Set<any>>();
    const stateForVersion = (version: number) => version === 2 ? state : (({ turnId: _turnId, latestAction: _latestAction, ...legacyState }) => legacyState)(state);
    const socketStateVersions = new WeakMap<object, number>();
    const messageForVersion = (type: 'snapshot' | 'state', version: number) => JSON.stringify({ v: 1, type, revision, source, state: stateForVersion(version) });
    const broadcastState = (type: 'state') => { for (const group of sockets.values()) for (const ws of group) if (ws.readyState === 1) ws.send(messageForVersion(type, socketStateVersions.get(ws) ?? 1)); };
  let scryptActive=0; const derive=async(value:string,salt:string)=>{if(scryptActive>=4)throw new Error('busy');scryptActive++;try{return await scrypt(value,salt,64) as Buffer;}finally{scryptActive--;}};
    const closeSockets=(id:string)=>{for(const ws of sockets.get(id)??[])ws.close(1008,'Session revoked');sockets.delete(id); if (ownerControlSocket && !sockets.get(id)?.has(ownerControlSocket)) { ownerControlSocket = undefined; finishControlRequests('DISCONNECTED'); }};
    if (listener.lan && read('password') && !read('username')) { db.close(); throw new Error('LAN mode requires local owner username upgrade'); }
    const app = Fastify({ logger: { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] }, bodyLimit: 16_384, trustProxy: false, ...(listener.secure ? { https: listener.https } : {}) });
   await app.register(cookie); await app.register(websocket, { options: { maxPayload: 16_384 }, async preClose(this: FastifyInstance) {
     const server = this.websocketServer;
     const clients = [...server.clients];
     const closed = clients.map(socket => new Promise<void>(resolve => socket.once('close', () => resolve())));
     for (const socket of clients) socket.close(1001, 'Server shutting down');
     // shortcut: one-second WS drain, increase if legitimate clients need slower shutdown.
     let deadline: ReturnType<typeof setTimeout>;
     await Promise.race([Promise.all(closed), new Promise<void>(resolve => { deadline = setTimeout(() => { for (const socket of clients) if (socket.readyState !== 3) socket.terminate(); resolve(); }, 1_000); })]);
     clearTimeout(deadline!);
     await new Promise<void>(resolve => server.close(() => resolve()));
   } }); await app.register(rateLimit, { max: 120, timeWindow: '1 minute', errorResponseBuilder: (_req, context) => Object.assign(new Error('Too many requests'), { statusCode: context.statusCode }) });
   app.setErrorHandler((error, _req, reply) => {
     const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
     if (statusCode === 429) return reply.code(429).send(errorBody('RATE_LIMITED', 'Too many attempts. Please wait a minute and try again.'));
     return reply.code(statusCode).send(errorBody('UNAVAILABLE', 'Request unavailable'));
   });
    app.addHook('onRequest', async (req, reply) => {
      if (!listener.lan) {
        if (req.url === '/health') return;
        if (req.url === '/api/command' && !req.cookies.session) return;
         if (['POST','PUT','PATCH','DELETE'].includes(req.method) && !(req.url === '/api/agent/voice-control' && req.headers.authorization?.startsWith('Bearer ')) && !sameOrigin(req.headers.origin, req.headers.host, listener)) return reply.code(403).send(errorBody('FORBIDDEN','Forbidden'));
        return;
      }
      if (req.headers.host !== new URL(listener.origin!).host) return reply.code(403).send(errorBody('FORBIDDEN','Forbidden'));
      const peer = normalizeAddress(String(req.raw.socket.remoteAddress ?? '')) ?? '';
      if (isLoopback(peer)) return;
      if (!containsAddress(listener.trustedCidr!, peer)) return reply.code(403).send(errorBody('FORBIDDEN','Forbidden'));
      const route = req.routeOptions.url ?? req.url.split('?')[0];
      const allowed = (req.method === 'GET' && ['/admin','/api/session','/api/state','/api/admin/diagnostics','/api/sessions','/api/stream'].includes(route))
        || (req.method === 'GET' && route.startsWith('/assets/'))
        || (req.method === 'POST' && ['/api/login','/api/command','/api/logout','/api/agents'].includes(route))
        || (req.method === 'DELETE' && (route === '/api/agents/:digest' || route === '/api/sessions/:id'));
      if (!allowed) return reply.code(403).send(errorBody('FORBIDDEN','Forbidden'));
      if (['/api/state','/api/admin/diagnostics','/api/sessions','/api/command','/api/logout','/api/agents','/api/agents/:digest','/api/sessions/:id','/api/stream'].includes(route) && auth(req)?.role !== 'owner') return reply.code(403).send(errorBody('FORBIDDEN','Forbidden'));
      if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
        if (!sameOrigin(req.headers.origin, req.headers.host, listener)) return reply.code(403).send(errorBody('FORBIDDEN','Forbidden'));
     }
      if (req.headers.upgrade?.toLowerCase() === 'websocket' && !sameOrigin(req.headers.origin, req.headers.host, listener)) return reply.code(403).send(errorBody('FORBIDDEN','Forbidden'));
   });
    if (process.env.NODE_ENV === 'production') await app.register(fastifyStatic, { root: resolve(process.cwd(), 'dist/assets'), prefix: '/assets/', maxAge: '30d', immutable: true });
    const auth = (req: any) => {
     const raw = req.cookies.session; if (!raw) return undefined;
     const row = db.prepare('SELECT role,csrf,expires FROM sessions WHERE digest=?').get(hash(raw)) as any;
     return row && row.expires > Date.now() ? { ...row, raw, digest:hash(raw) } : undefined;
   };
   const configuredUrl = configuredHermesUrl(process.env.HERMES_API_SERVER_URL);
   const hermesKey = process.env.HERMES_API_SERVER_KEY?.trim();
   const hermesVoice = options.voiceClients?.hermes ?? (configuredUrl && hermesKey ? new HermesApiClient(configuredUrl, hermesKey) : undefined);
   const wakeUri = process.env.WYOMING_WAKE_URI;
   const sttUri = process.env.WYOMING_STT_URI;
   const ttsUri = process.env.WYOMING_TTS_URI;
   let configuredWyoming: WyomingVoiceClient | undefined;
   if (wakeUri && sttUri && ttsUri) {
     try { configuredWyoming = new WyomingVoiceClient({ wake: wakeUri, stt: sttUri, tts: ttsUri }); } catch { /* invalid endpoints remain unavailable */ }
   }
   const wyomingVoice = options.voiceClients?.wyoming ?? configuredWyoming;
   let sessionLock = Promise.resolve();
   const withVoiceSessionLock = async <T>(operation: () => Promise<T>): Promise<T> => {
     const previous = sessionLock;
     let release!: () => void;
     sessionLock = new Promise<void>(resolve => { release = resolve; });
     await previous;
     try { return await operation(); } finally { release(); }
   };
    let activeVoiceSocket: any;
    let ownerControlSocket: any;
    const controlRequests = new Map<string, { resolve: (status: 'DISPATCHED' | 'DENIED' | 'TIMEOUT' | 'DISCONNECTED') => void; timer: ReturnType<typeof setTimeout> }>();
    const finishControlRequests = (status: 'DENIED' | 'DISCONNECTED') => { for (const [id, request] of controlRequests) { clearTimeout(request.timer); controlRequests.delete(id); request.resolve(status); } };
   let voiceLease = false;
   const hasActiveVoiceSession = () => voiceLease;
   const voicePreferenceKey = 'voice.settings';
    const hermesSessionKey = 'voice.hermesSession';
    const hermesSessionActivityKey = 'voice.hermesSessionActivity';
   const ownerVoiceSession = (req: any) => {
     const session = auth(req);
     return session?.role === 'owner' ? session : undefined;
   };
   const voiceForbidden = (reply: any) => reply.code(403).send(errorBody('FORBIDDEN', 'Forbidden'));
   const voiceUnavailable = (reply: any) => reply.code(503).send(errorBody('UNAVAILABLE', 'Voice service unavailable'));
   const voiceDiscovery = async () => {
     if (!wyomingVoice) return { wakeOk: false, voicesOk: false, wakeModels: [] as string[], voices: [] as string[] };
     const [wake, voices] = await Promise.allSettled([wyomingVoice.listWakeModels(), wyomingVoice.listVoices()]);
     const wakeModels = wake.status === 'fulfilled' && Array.isArray(wake.value)
       ? wake.value.flatMap(model => typeof model?.name === 'string' && model.name.length <= 256 ? [model.name] : []).slice(0, 100)
       : [];
     const voiceNames = voices.status === 'fulfilled' && Array.isArray(voices.value)
       ? voices.value.filter(name => typeof name === 'string' && name.length > 0 && name.length <= 256).slice(0, 100)
       : [];
     return { wakeOk: wake.status === 'fulfilled', voicesOk: voices.status === 'fulfilled', wakeModels, voices: voiceNames };
   };
    const createHermesSession = async ({ replace = false, startingRun = false }: { replace?: boolean; startingRun?: boolean } = {}): Promise<boolean> => withVoiceSessionLock(async () => {
      if (replace && hasActiveVoiceSession()) return false;
      if (!hermesVoice) return false;
      if (!replace) {
        const existing = read(hermesSessionKey)?.value;
        const lastUsed = Number(read(hermesSessionActivityKey)?.value ?? 0);
        let settings: any;
        try { settings = JSON.parse(read(voicePreferenceKey)?.value ?? 'null'); } catch { settings = undefined; }
        const timeoutMinutes = [5, 15, 30, 60].includes(settings?.sessionTimeoutMinutes) ? settings.sessionTimeoutMinutes : 30;
        const currentTime = now();
        if (existing && existing.length <= 1024 && lastUsed > 0 && currentTime - lastUsed < timeoutMinutes * 60_000) {
          db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)').run(hermesSessionActivityKey, String(currentTime));
          return true;
        }
        if (existing && hasActiveVoiceSession() && !startingRun) return false;
      }
      const id = await hermesVoice.createSession();
      if (typeof id !== 'string' || !id.trim() || id.length > 1024) return false;
      db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)').run(hermesSessionKey, id);
      db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)').run(hermesSessionActivityKey, String(now()));
      return true;
    });
    app.get('/api/voice/status', async (req: any, reply) => {
      if (!ownerVoiceSession(req)) return voiceForbidden(reply);
      const discovery = await voiceDiscovery();
      let settings: any; try { settings = JSON.parse(read(voicePreferenceKey)?.value ?? 'null'); } catch { settings = undefined; }
      return { availability: { hermes: Boolean(hermesVoice), wyoming: discovery.wakeOk && discovery.voicesOk }, wakeModels: discovery.wakeModels, voices: discovery.voices, sessionTimeoutMinutes: [5, 15, 30, 60].includes(settings?.sessionTimeoutMinutes) ? settings.sessionTimeoutMinutes : 30, allowHermesControl: settings?.allowHermesControl === true };
   });
   app.post('/api/voice/settings', async (req: any, reply) => {
     const owner = ownerVoiceSession(req);
      if (!owner || req.body?.csrf !== owner.csrf || !sameOrigin(req.headers.origin, req.headers.host, listener)) return voiceForbidden(reply);
     const body = req.body;
       if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.enabled !== 'boolean' || typeof body.wakeModel !== 'string' || body.wakeModel.length < 1 || body.wakeModel.length > 256 || typeof body.voice !== 'string' || body.voice.length < 1 || body.voice.length > 256 || (body.allowHermesControl !== undefined && typeof body.allowHermesControl !== 'boolean') || (body.sessionTimeoutMinutes !== undefined && ![5, 15, 30, 60].includes(body.sessionTimeoutMinutes)) || Object.keys(body).some(key => !['csrf', 'enabled', 'wakeModel', 'voice', 'sessionTimeoutMinutes', 'allowHermesControl'].includes(key))) {
       return reply.code(400).send(errorBody('INVALID_INPUT', 'Invalid voice settings'));
     }
     if (!wyomingVoice) return voiceUnavailable(reply);
     const discovery = await voiceDiscovery();
     if (!discovery.wakeOk || !discovery.voicesOk) return voiceUnavailable(reply);
     if (!discovery.wakeModels.includes(body.wakeModel) || !discovery.voices.includes(body.voice)) return reply.code(400).send(errorBody('INVALID_INPUT', 'Voice model or voice is not installed'));
       let previous: any; try { previous = JSON.parse(read(voicePreferenceKey)?.value ?? 'null'); } catch { previous = undefined; }
       db.prepare('INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)').run(voicePreferenceKey, JSON.stringify({ enabled: body.enabled, wakeModel: body.wakeModel, voice: body.voice, sessionTimeoutMinutes: body.sessionTimeoutMinutes ?? 30, allowHermesControl: body.allowHermesControl ?? (previous?.allowHermesControl === true) }));
     return { saved: true };
   });
   app.post('/api/voice/session', async (req: any, reply) => {
     const owner = ownerVoiceSession(req);
      if (!owner || req.body?.csrf !== owner.csrf || !sameOrigin(req.headers.origin, req.headers.host, listener)) return voiceForbidden(reply);
      try { return await createHermesSession() ? { ready: true } : voiceUnavailable(reply); }
     catch { return voiceUnavailable(reply); }
   });
   app.post('/api/voice/session/reset', async (req: any, reply) => {
     const owner = ownerVoiceSession(req);
      if (!owner || req.body?.csrf !== owner.csrf || !sameOrigin(req.headers.origin, req.headers.host, listener)) return voiceForbidden(reply);
     if (hasActiveVoiceSession()) return reply.code(409).send(errorBody('CONFLICT', 'Voice session is active'));
      try { return await createHermesSession({ replace: true }) ? { ready: true } : voiceUnavailable(reply); }
     catch { return voiceUnavailable(reply); }
   });
    const tx = db.transaction((next: typeof state, rev: number, detail: string, nextSource: string) => {
     db.prepare('INSERT OR REPLACE INTO kv VALUES (?,?)').run('state', JSON.stringify(next));
     db.prepare('INSERT OR REPLACE INTO kv VALUES (?,?)').run('revision', String(rev));
     db.prepare('INSERT OR REPLACE INTO kv VALUES (?,?)').run('source', nextSource);
     db.prepare('INSERT INTO activity(detail) VALUES (?)').run(detail);
    db.prepare('DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 200)').run();
  });
   app.get('/health', async () => ({ ok: true }));
   app.get('/api/admin/diagnostics', async (req: any, reply) => {
     const owner = auth(req);
      if (owner?.role !== 'owner' || req.headers.origin && !sameOrigin(req.headers.origin, req.headers.host, listener)) return reply.code(403).send(errorBody('FORBIDDEN', 'Forbidden'));
     try {
       return {
          readiness: { loopbackBinding: ['localhost','127.0.0.1','::1'].includes(listener.host), transport: { mode: listener.lan ? (listener.secure ? 'https' : 'http-insecure') : 'loopback', lan: listener.lan, secure: listener.secure }, storage: db.prepare('SELECT 1').get() ? 'available' : 'unavailable', ownerConfigured: Boolean(read('password')), hermes: { configured: Boolean(hermesVoice), availability: 'not-verified' }, wyoming: { configured: Boolean(wyomingVoice), availability: 'not-verified' } },
         agents: (db.prepare('SELECT agent_id,revoked FROM agents ORDER BY agent_id LIMIT 200').all() as any[]).map(agent => ({ id: agent.agent_id, revoked: Boolean(agent.revoked), capabilities: 'unknown', presence: 'unknown' })),
         pairedSessions: (db.prepare("SELECT expires FROM sessions WHERE role='display' ORDER BY expires DESC LIMIT 100").all() as any[]).map(session => ({ status: session.expires > Date.now() ? 'active' : 'expired', expires: session.expires, revoked: false })),
         events: db.prepare('SELECT timestamp,category,code,status FROM diagnostics ORDER BY id DESC LIMIT 50').all(),
         retention: { diagnostics: { retained: (db.prepare('SELECT COUNT(*) count FROM diagnostics').get() as any).count, limit: 200 }, activity: { retained: (db.prepare('SELECT COUNT(*) count FROM activity').get() as any).count, limit: 200, behavior: 'prune-oldest-above-limit' } },
       };
     } catch { return reply.code(503).send(errorBody('UNAVAILABLE', 'Diagnostics unavailable')); }
   });
   app.post('/api/setup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req: any, reply) => {
     if (!isLoopback(req.ip) || !options.bootstrapSecret || read('password')) return reply.code(409).send({ v:1, error: { code:'CONFLICT',message:'Unavailable',requestId:'request' } });
    if (req.body?.secret !== options.bootstrapSecret) return reply.code(403).send({ v:1, error: { code:'FORBIDDEN',message:'Forbidden',requestId:'request' } });
     if(!validUsername(req.body.username)||typeof req.body.password!=='string'||Buffer.byteLength(req.body.password)<12||Buffer.byteLength(req.body.password)>128) return reply.code(400).send({v:1,error:{code:'INVALID_INPUT',message:'Invalid input',requestId:'request'}});
    const salt = randomBytes(16).toString('hex'); let derived:Buffer; try { derived=await derive(String(req.body.password??''),salt); } catch { return reply.code(503).send({v:1,error:{code:'UNAVAILABLE',message:'Unavailable',requestId:'request'}}); }
     db.prepare('INSERT INTO kv VALUES (?,?)').run('password', `${salt}:${derived.toString('hex')}`);
     db.prepare('INSERT INTO kv VALUES (?,?)').run('username', normalizeUsername(req.body.username));
    return issue(reply, 'owner');
  });
   const secureCookie=listener.secure;
    const issue = (reply: any, role: string, lifetime = 86400000) => { const raw=token(), csrf=token(); db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(raw),role,csrf,Date.now()+lifetime); reply.setCookie('session',raw,{httpOnly:true,sameSite:'strict',path:'/',secure:secureCookie}); return { csrf, role, demoEnabled: options.demo === true }; };
   app.post('/api/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req: any, reply) => {
     const saved=read('password')?.value; if (!saved) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
     const existingUsername=read('username')?.value;
     if (!validUsername(req.body?.username)) return reply.code(400).send(errorBody('INVALID_INPUT','Invalid input'));
     if(typeof req.body?.password!=='string'||Buffer.byteLength(req.body.password)<12||Buffer.byteLength(req.body.password)>128) return reply.code(400).send(errorBody('INVALID_INPUT','Invalid input'));
     if (!existingUsername) {
       if (!isLoopback(req.ip)) return reply.code(403).send(errorBody('IDENTITY_UPGRADE_REQUIRED','Sign in locally to add an owner username'));
       const [legacySalt,legacyHash]=saved.split(':'); let legacyGot:Buffer; try { legacyGot=await derive(req.body.password,legacySalt); } catch { return reply.code(503).send(errorBody('UNAVAILABLE','Unavailable')); }
       const legacyExpected=Buffer.from(legacyHash,'hex'); if(legacyGot.length!==legacyExpected.length||!timingSafeEqual(legacyGot,legacyExpected)) return reply.code(403).send(errorBody('FORBIDDEN','Forbidden'));
       const upgraded=db.transaction(()=>db.prepare('INSERT OR IGNORE INTO kv VALUES (?,?)').run('username',normalizeUsername(req.body.username)).changes)();
       if (!upgraded) return reply.code(409).send(errorBody('CONFLICT','Owner identity already upgraded'));
       return issue(reply,'owner');
     }
     if (normalizeUsername(req.body.username)!==existingUsername) return reply.code(403).send(errorBody('FORBIDDEN','Forbidden'));
    const [salt,expected]=saved.split(':'); let got:Buffer; try { got=await derive(req.body.password,salt); } catch { return reply.code(503).send({v:1,error:{code:'UNAVAILABLE',message:'Unavailable',requestId:'request'}}); } const exp=Buffer.from(expected,'hex');
    if(got.length!==exp.length || !timingSafeEqual(got,exp)) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
    return issue(reply,'owner');
  });
  app.post('/api/display/pair', async (req: any, reply) => { const owner=auth(req); if(owner?.role!=='owner'||req.body?.csrf!==owner.csrf) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}}); const code=token(); db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(code),'pair',token(),Date.now()+5*60_000); return {code}; });
   app.post('/api/display/redeem', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req: any, reply) => { const code=req.body?.code; if(typeof code!=='string'||code.length>128) return reply.code(400).send({v:1,error:{code:'INVALID_INPUT',message:'Invalid input',requestId:'request'}}); const d=hash(code); const row=db.prepare('SELECT role,expires FROM sessions WHERE digest=?').get(d) as any; if(row?.role!=='pair') return reply.code(403).send(errorBody('PAIRING_INVALID','This pairing code is invalid or has already been used')); if(row.expires<=Date.now()) return reply.code(403).send(errorBody('PAIRING_EXPIRED','This pairing code has expired. Request a new code')); db.prepare('DELETE FROM sessions WHERE digest=?').run(d); return issue(reply,'display'); });
  app.get('/api/sessions',async(req:any,reply)=>{const owner=auth(req); if(owner?.role!=='owner') return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}}); return {sessions:db.prepare("SELECT digest,role,expires FROM sessions WHERE role IN ('owner','display')").all().map((s:any)=>({id:s.digest,role:s.role,expires:s.expires}))};});
  app.delete('/api/sessions/:id',async(req:any,reply)=>{const owner=auth(req); if(owner?.role!=='owner'||req.body?.csrf!==owner.csrf) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}}); const id=String(req.params.id); db.prepare("DELETE FROM sessions WHERE digest=? AND role IN ('owner','display')").run(id); closeSockets(id); return {ok:true};});
   app.post('/api/logout',async(req:any,reply)=>{const session=auth(req);if(!session||req.body?.csrf!==session.csrf)return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});db.prepare('DELETE FROM sessions WHERE digest=?').run(session.digest);closeSockets(session.digest);reply.clearCookie('session',{httpOnly:true,sameSite:'strict',path:'/',secure:secureCookie});return {ok:true};});
    app.post('/api/agents', async (req: any, reply) => { const owner=auth(req); if(owner?.role!=='owner'||req.body?.csrf!==owner.csrf) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}}); const secret=token(), id=randomUUID(); db.prepare('INSERT INTO agents(digest,revoked,agent_id) VALUES (?,0,?)').run(hash(secret),id); return { id, secret }; });
    app.post('/api/agent/voice-control', async (req: any, reply) => {
      const authHeader = req.headers.authorization;
      const agent = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? db.prepare('SELECT revoked FROM agents WHERE digest=?').get(hash(authHeader.slice(7))) as any : undefined;
      if (!agent) return reply.code(401).send(errorBody('UNAUTHENTICATED', 'Authentication required'));
      if (agent.revoked) return voiceForbidden(reply);
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || !['listening', 'paused'].includes(req.body.state)) return reply.code(400).send(errorBody('INVALID_INPUT', 'Invalid voice control request'));
      let settings: any; try { settings = JSON.parse(read(voicePreferenceKey)?.value ?? 'null'); } catch { settings = undefined; }
      if (settings?.allowHermesControl !== true) return voiceForbidden(reply);
      if (!ownerControlSocket || ownerControlSocket.readyState !== 1) return { accepted: false, status: 'NO_OWNER_DISPLAY' };
      if (controlRequests.size >= 32) return { accepted: false, status: 'CONTROL_BUSY' };
      const requestId = randomUUID();
      const result = new Promise<'DISPATCHED' | 'DENIED' | 'TIMEOUT' | 'DISCONNECTED'>(resolve => {
        const timer = setTimeout(() => { controlRequests.delete(requestId); resolve('TIMEOUT'); }, 1_500);
        controlRequests.set(requestId, { resolve, timer });
        try { ownerControlSocket.send(JSON.stringify({ type: 'voice-control', requestId, state: req.body.state })); }
        catch { clearTimeout(timer); controlRequests.delete(requestId); resolve('DISCONNECTED'); }
      });
      const status = await result;
      return { accepted: status === 'DISPATCHED', requestId, status };
    });
  app.delete('/api/agents/:digest', async (req: any, reply) => { const owner=auth(req); if(owner?.role!=='owner'||req.body?.csrf!==owner.csrf) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}}); db.prepare('UPDATE agents SET revoked=1 WHERE digest=? OR agent_id=?').run(req.params.digest,req.params.digest); return {ok:true}; });
    const commit = (next: typeof state, detail: string, nextSource: string) => {
      const rev=revision+1;
      next = ProtocolStateSchema.parse(next);
      try { tx(next,rev,detail,nextSource); } catch { recordDiagnostic('persistence', 'PERSISTENCE_FAILED', 500); return false; }
     state=next; revision=rev; source=nextSource;
      broadcastState('state');
     return true;
   };
     const principalSource = (principal: WidgetPrincipal): string => principal === 'owner' ? 'owner' : principal === 'demo' ? 'demo' : 'agent';
     const applyCommand = (command: CommandRequest, principal: WidgetPrincipal) => {
      let next = state;
      const isWidgetCommand = command.type === 'widget.create' || command.type === 'widget.update' || command.type === 'widget.set-visibility' || command.type === 'widget.remove';
      let fingerprint = '';
      if (isWidgetCommand) {
        fingerprint = hash(JSON.stringify(command));
        const prior = db.prepare('SELECT fingerprint,revision FROM widget_commands WHERE principal=? AND request_id=?').get(principal, command.requestId) as any;
        if (prior) return prior.fingerprint === fingerprint ? { revision: prior.revision } : { error: 'CONFLICT' };
        let result;
        switch (command.type) {
          case 'widget.create': result = createWidget(state.widgets, command.payload.widget, principal, now()); break;
          case 'widget.update': result = updateWidget(state.widgets, command.payload.id, Object.fromEntries(Object.entries(command.payload).filter(([key]) => key !== 'id')), principal, now()); break;
          case 'widget.set-visibility': result = setWidgetVisibility(state.widgets, command.payload.id, command.payload.visible, principal, now()); break;
          case 'widget.remove': result = removeWidget(state.widgets, command.payload.id, principal); break;
        }
        if (!result.ok) return { error: result.code };
        next = { ...state, widgets: result.widgets };
      }
      const isDemoCommand = command.type.startsWith('demo.');
     if (isDemoCommand) {
       if (!options.demo || principal !== 'owner' && principal !== 'demo') return null;
       next = transitionDemo(state, command, now());
      } else if (isWidgetCommand) { /* handled through widget lifecycle */ }
        else if (command.type === 'task.update') {
          const active = ['thinking', 'tool-use', 'responding', 'waiting'].includes(state.activity);
          const { turnId, startTurn } = command.payload;
          if (startTurn) {
            if (turnId === state.turnId && active) next = { ...state, task: command.payload.task, toolCategory: command.payload.toolCategory ?? null, activity: 'thinking', progress: null };
            else next = { ...state, task: command.payload.task, toolCategory: command.payload.toolCategory ?? null, activity: 'thinking', progress: null, turnId: turnId!, turnStartedAt: now(), latestAction: null };
          } else {
            if (state.turnId !== null ? turnId !== state.turnId : turnId !== undefined) return null;
            next = { ...state, task: command.payload.task, toolCategory: command.payload.toolCategory ?? null, activity: 'thinking', progress: null, turnStartedAt: active ? state.turnStartedAt : now() };
          }
        }
      else if (command.type === 'state.set-latest-action') { if (state.turnId === null || command.payload.turnId !== state.turnId || !['thinking', 'tool-use', 'responding', 'waiting'].includes(state.activity)) return null; next = { ...state, latestAction: { turnId: state.turnId, text: command.payload.text } }; }
       else if (command.type === 'state.set-progress') next = { ...state, progress: command.payload.progress };
        else if (command.type === 'state.set-activity') {
          if (state.turnId !== null ? command.payload.turnId !== state.turnId : command.payload.turnId !== undefined) return null;
          if (!canTransitionActivity(state.activity, command.payload.activity)) return null;
          const activity = command.payload.activity;
           const active = ['thinking', 'tool-use', 'responding', 'waiting'].includes(activity);
           const wasActive = ['thinking', 'tool-use', 'responding', 'waiting'].includes(state.activity);
           next = { ...state, activity, turnStartedAt: active ? (wasActive ? state.turnStartedAt : now()) : null, turnId: active ? state.turnId : null, latestAction: active && wasActive ? state.latestAction : null };
       }
        else if (command.type === 'task.complete') {
          if (state.turnId !== null ? command.payload.turnId !== state.turnId : command.payload.turnId !== undefined) return null;
         if (!canTransitionActivity(state.activity, 'completed')) return null;
           next = { ...state, activity: 'completed', progress: 100, task: 'Task completed successfully', turnStartedAt: null, turnId: null, latestAction: null };
       }
      else if (command.type === 'metric.set-value') {
        const widget = state.widgets.find(item => item.id === command.payload.id);
        if (!widget) return { error: 'NOT_FOUND' };
        if (widget.content.kind !== 'metric') return { error: 'INVALID_INPUT' };
        const result = updateWidget(state.widgets, widget.id, { content: { ...widget.content, value: String(command.payload.value) } }, principal, now());
        if (!result.ok) return { error: result.code };
        next = { ...state, widgets: result.widgets };
     }
       else if (command.type === 'display.set-style') {
         if (principal !== 'owner') return null;
         next = { ...state, displayStyle: command.payload.style };
       }
       else if (command.type === 'display.preferences.set') {
         if (principal !== 'owner') return null;
         next = { ...state, displayPreferences: command.payload.preferences };
       }
       if (isWidgetCommand) {
         const rev = revision + 1;
         next = ProtocolStateSchema.parse(next);
        try { db.transaction(() => { tx(next,rev,command.type,principalSource(principal)); db.prepare('INSERT INTO widget_commands VALUES (?,?,?,?,?)').run(principal,command.requestId,fingerprint,rev,Date.now()); db.prepare('DELETE FROM widget_commands WHERE rowid NOT IN (SELECT rowid FROM widget_commands ORDER BY created_at DESC LIMIT 1000)').run(); })(); }
         catch { recordDiagnostic('persistence', 'PERSISTENCE_FAILED', 500); return false; }
        state=next; revision=rev; source=principalSource(principal);
         broadcastState('state');
        return { revision };
      }
      return commit(next, command.type, principal === 'demo' || isDemoCommand ? 'demo' : principalSource(principal));
   };
    const cleanupExpired = () => {
      const cleaned = removeExpiredWidgets(state.widgets, now());
      if (cleaned.ok && cleaned.widgets.length !== state.widgets.length) commit({ ...state, widgets: cleaned.widgets }, 'widget.expiry-cleanup', source);
    };
    app.post('/api/local-auto-access', async (req: any, reply) => {
      const mode = options.localAutoAccess ?? 'off';
      const remote = String(req.ip ?? '').replace(/^::ffff:/, '');
      if (mode === 'off' || !['127.0.0.1', '::1'].includes(remote) || !sameLoopbackOrigin(req.headers.origin, req.headers.host)) return reply.code(403).send(errorBody('FORBIDDEN', 'Forbidden'));
      if (mode === 'owner' && !read('password')) return reply.code(403).send(errorBody('FORBIDDEN', 'Forbidden'));
      return issue(reply, mode, mode === 'display' ? 60 * 60_000 : 86400000);
    });
    cleanupExpired();
    const expiryTimer = setInterval(cleanupExpired, 60_000);
    const demoTimer = options.demo ? setInterval(() => {
     if (!state.running) return;
     const command = CommandRequestSchema.parse({ v: 1, requestId: token(), type: 'demo.simulate', payload: {} });
     applyCommand(command, 'demo');
   }, 12_000) : undefined;
    app.get('/api/session', async (req: any) => { const session=auth(req); const transport={mode:listener.lan?(listener.secure?'https':'http-insecure'):'loopback',lan:listener.lan,secure:listener.secure}; return session ? {role:session.role,csrf:session.csrf,demoEnabled:options.demo===true,setupRequired:!read('password'),identityUpgradeRequired:!!read('password')&&!read('username'),transport,...(session.role==='owner'&&options.localAutoAccess==='owner'?{ownerAutoAccess:true}:{})} : {role:null,demoEnabled:options.demo===true,setupRequired:!read('password'),identityUpgradeRequired:!!read('password')&&!read('username'),transport}; });
    app.get('/api/state', async (req: any, reply) => { if(!auth(req)) return reply.code(401).send({v:1,error:{code:'UNAUTHENTICATED',message:'Authentication required',requestId:'request'}}); return {v:1,type:'snapshot',revision,source,state:stateForVersion(Number(req.query?.stateVersion) === 2 ? 2 : 1)}; });
    app.post('/api/command', async (req: any, reply) => {
    const session=auth(req); const agentHeader=req.headers.authorization;
    const agent=agentHeader?.startsWith('Bearer ') ? db.prepare('SELECT revoked,agent_id FROM agents WHERE digest=?').get(hash(agentHeader.slice(7))) as any : undefined;
    if(session&&agentHeader) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
    if(!session&&!agent) return reply.code(401).send({v:1,error:{code:'UNAUTHENTICATED',message:'Authentication required',requestId:'request'}});
    if(session?.role==='display') return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
      if(session && (req.body?.csrf!==session.csrf || !sameOrigin(req.headers.origin, req.headers.host, listener))) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
    if(agent && agent.revoked) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
    const commandInput = req.body?.command ?? Object.fromEntries(Object.entries(req.body ?? {}).filter(([key]) => key !== 'csrf'));
     const parsed=CommandRequestSchema.safeParse(commandInput); if(!parsed.success) { if(session || agent) recordDiagnostic('command','INVALID_COMMAND',400); return reply.code(400).send({v:1,error:{code:'INVALID_COMMAND',message:'Invalid command',requestId:req.body?.requestId??'request'}}); }
     const c=parsed.data;
       const principal: WidgetPrincipal = agent ? `agent:${agent.agent_id}` : 'owner';
      const result = applyCommand(c, principal);
       if(result === null) { recordDiagnostic('command','FORBIDDEN',403); return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:c.requestId}}); }
         if(typeof result === 'object' && 'error' in result) { const status: Record<string, number> = { INVALID_INPUT:400, FORBIDDEN:403, NOT_FOUND:404, CONFLICT:409 }; const code = String(result.error) as 'INVALID_INPUT'|'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'; recordDiagnostic('command',code,status[code] ?? 403); return reply.code(status[code] ?? 403).send({v:1,error:{code,message:code,requestId:c.requestId}}); }
       if(!result) { recordDiagnostic('persistence','PERSISTENCE_FAILED',500); return reply.code(500).send({v:1,error:{code:'PERSISTENCE_FAILED',message:'Persistence failed',requestId:c.requestId}}); }
       recordDiagnostic('command','COMMAND_ACCEPTED',200);
       return {ok:true,revision: typeof result === 'object' ? result.revision : revision};
   });
      const authorizeVoiceUpgrade = async (req: any, reply: any) => {
        const owner = ownerVoiceSession(req);
         if (!owner || !sameOrigin(req.headers.origin, req.headers.host, listener)) return voiceForbidden(reply);
        let settings: any;
        try { settings = JSON.parse(read(voicePreferenceKey)?.value ?? 'null'); } catch { settings = undefined; }
         if (!settings?.enabled || !hermesVoice || !wyomingVoice) return voiceUnavailable(reply);
         if (voiceLease) return reply.code(409).send(errorBody('CONFLICT', 'Voice session active'));
         let ready: boolean;
          try { ready = await createHermesSession(); } catch { ready = false; }
         const sessionId = ready ? read(hermesSessionKey)?.value : undefined;
         if (!sessionId) return voiceUnavailable(reply);
        req.voiceUpgrade = { owner, settings, sessionId };
      };
      app.get('/api/voice/session', { websocket: true, preValidation: authorizeVoiceUpgrade }, (socket, req: any) => {
        const { owner, settings, sessionId } = req.voiceUpgrade;
        if (voiceLease) { socket.close(1008, 'Voice session active'); return; }
        voiceLease = true;
       const id = owner.digest;
       if (!sockets.has(id)) sockets.set(id, new Set());
       sockets.get(id)!.add(socket);
       activeVoiceSocket = socket;
       const releaseLease = () => { if (activeVoiceSocket === socket) { activeVoiceSocket = undefined; voiceLease = false; } };
          const voice = new VoiceSession({ socket, hermes: hermesVoice!, wyoming: wyomingVoice!, sessionId, settings, ensureSession: async () => await createHermesSession({ startingRun: true }) ? read(hermesSessionKey)?.value : undefined, onRemoteSettled: () => { if (socket.readyState === 3) releaseLease(); } });
       const timer = setTimeout(() => socket.close(1008, 'Session expired'), Math.max(0, owner.expires - now()));
       socket.on('message', (data: unknown, isBinary: boolean) => voice.message(data, isBinary));
       socket.on('close', () => {
         clearTimeout(timer); voice.close();
         const group = sockets.get(id); group?.delete(socket); if (!group?.size) sockets.delete(id);
         if (!voice.hasActiveRun) releaseLease();
      });
      });
      app.get('/api/voice/control', { websocket: true, preValidation: async (req: any, reply: any) => { const owner = ownerVoiceSession(req); if (!owner || !sameOrigin(req.headers.origin, req.headers.host, listener)) return voiceForbidden(reply); req.controlOwner = owner; } }, (socket, req: any) => {
        if (ownerControlSocket?.readyState === 1) { socket.close(1008, 'Owner control page already connected'); return; }
        const owner = req.controlOwner; ownerControlSocket = socket;
        if (!sockets.has(owner.digest)) sockets.set(owner.digest, new Set()); sockets.get(owner.digest)!.add(socket);
        const timer = setTimeout(() => socket.close(1008, 'Session expired'), Math.max(0, owner.expires - now()));
        socket.on('message', (data: unknown, isBinary: boolean) => {
          if (isBinary || typeof data !== 'string' && !Buffer.isBuffer(data)) { socket.close(1008, 'Invalid acknowledgement'); return; }
          let message: any; try { message = JSON.parse(data.toString()); } catch { socket.close(1008, 'Invalid acknowledgement'); return; }
          if (!message || Object.keys(message).length !== 3 || message.type !== 'voice-control-ack' || typeof message.requestId !== 'string' || message.requestId.length > 64 || !['dispatched', 'denied'].includes(message.status)) { socket.close(1008, 'Invalid acknowledgement'); return; }
          const pending = controlRequests.get(message.requestId); if (!pending) return;
          clearTimeout(pending.timer); controlRequests.delete(message.requestId); pending.resolve(message.status === 'dispatched' ? 'DISPATCHED' : 'DENIED');
        });
        socket.on('close', () => { clearTimeout(timer); if (ownerControlSocket === socket) ownerControlSocket = undefined; const group = sockets.get(owner.digest); group?.delete(socket); if (!group?.size) sockets.delete(owner.digest); finishControlRequests('DISCONNECTED'); });
      });
       app.get('/api/stream',{websocket:true,preValidation:async(req:any,reply:any)=>{const session=auth(req);const remote=!isLoopback(normalizeAddress(String(req.raw.socket.remoteAddress??''))??'');if(!session||session.role==='pair'||remote&&session.role!=='owner'||!sameOrigin(req.headers.origin,req.headers.host,listener))return reply.code(403).send(errorBody('FORBIDDEN','Forbidden'));}},(socket,req:any)=>{const session=auth(req); if(!session || session.role==='pair'){socket.close(1008,'Unauthorized');return;} const id=session.digest; const stateVersion = Number(req.query?.stateVersion) === 2 ? 2 : 1; socketStateVersions.set(socket, stateVersion); if(!sockets.has(id)) sockets.set(id,new Set()); sockets.get(id)!.add(socket);socket.send(messageForVersion('snapshot',stateVersion));socket.on('message',()=>socket.close(1008,'Read only'));socket.on('close',()=>{const group=sockets.get(id);group?.delete(socket);if(group?.size===0)sockets.delete(id);});const timer=setTimeout(()=>socket.close(1008,'Session expired'),Math.max(0,session.expires-Date.now()));socket.on('close',()=>clearTimeout(timer));});
      app.addHook('onClose', async () => { finishControlRequests('DISCONNECTED'); clearInterval(expiryTimer); if(demoTimer) clearInterval(demoTimer); db.close(); });
   if (process.env.NODE_ENV === 'production') {
     for (const path of ['/', '/admin', '/display']) app.get(path, async (_req, reply) => reply.sendFile('index.html', resolve(process.cwd(), 'dist'), { maxAge: 0, immutable: false }));
   }
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const listener=validateListenerConfig();
    const autoAccess=parseLocalAutoAccess(process.env.GLIMPSE_LOCAL_AUTO_ACCESS);
    warnOwnerAutoAccess(autoAccess);
  const app=await createServer({database:process.env.GLIMPSE_DB,bootstrapSecret:process.env.GLIMPSE_BOOTSTRAP_SECRET,demo:process.env.GLIMPSE_DEMO==='1',localAutoAccess:autoAccess as 'off'|'display'|'owner',listener});
  await app.listen({host:listener.host,port:listener.port}); const stop=async()=>{await app.close();process.exit(0);}; process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
