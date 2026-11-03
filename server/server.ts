import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { canTransitionActivity, CommandRequestSchema, ProtocolStateSchema, type CommandRequest } from '../src/shared/protocol.ts';
import { createDemoState, transitionDemo } from './adapters/demo.ts';
import { createWidget, updateWidget, setWidgetVisibility, removeWidget, removeExpiredWidgets, type WidgetPrincipal } from './widgets.ts';

const scrypt = promisify(scryptCb);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const errorBody = (code: string, message: string, requestId = 'request') => ({ v: 1, error: { code, message, requestId } });
const isLoopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host.toLowerCase());
const sameLoopbackOrigin = (origin: string | undefined, host: string | undefined) => {
  if (!origin || !host) return false;
  try {
    const requestOrigin = new URL(origin);
    const targetOrigin = new URL(`http://${host}`);
    return requestOrigin.protocol === 'http:' && isLoopback(requestOrigin.hostname) && isLoopback(targetOrigin.hostname) && requestOrigin.origin === targetOrigin.origin;
  } catch { return false; }
};
const empty = ProtocolStateSchema.parse({ agent: '', task: '', progress: 0, running: false, widgets: [], logs: [] });
type Options = { database?: string; bootstrapSecret?: string; host?: string; port?: number; demo?: boolean; now?: () => number };

export async function createServer(options: Options = {}): Promise<FastifyInstance> {
  const db = new Database(options.database ?? 'glimpse-dock.sqlite');
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, role TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS agents (digest TEXT PRIMARY KEY, revoked INTEGER NOT NULL DEFAULT 0, agent_id TEXT);
    CREATE TABLE IF NOT EXISTS widget_commands (principal TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(principal,request_id));
    CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, detail TEXT NOT NULL);`);
   db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (1)').run();
   db.transaction(() => {
     if (!db.prepare('SELECT 1 FROM pragma_table_info(\'agents\') WHERE name=\'agent_id\'').get()) db.exec('ALTER TABLE agents ADD COLUMN agent_id TEXT');
     for (const row of db.prepare('SELECT digest FROM agents WHERE agent_id IS NULL').all() as any[]) db.prepare('UPDATE agents SET agent_id=? WHERE digest=?').run(randomUUID(), row.digest);
     db.exec('CREATE UNIQUE INDEX IF NOT EXISTS agents_agent_id ON agents(agent_id)');
     db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)').run();
   })();
   const now = options.now ?? Date.now;
  const read = (key: string) => db.prepare('SELECT value FROM kv WHERE key=?').get(key) as {value:string}|undefined;
    let state = read('state') ? ProtocolStateSchema.parse(JSON.parse(read('state')!.value)) : options.demo ? createDemoState(now()) : empty;
   let revision = Number(read('revision')?.value ?? 0);
   let source = read('source')?.value ?? (options.demo ? 'demo' : 'owner');
  const sockets = new Map<string, Set<any>>();
  let scryptActive=0; const derive=async(value:string,salt:string)=>{if(scryptActive>=4)throw new Error('busy');scryptActive++;try{return await scrypt(value,salt,64) as Buffer;}finally{scryptActive--;}};
  const closeSockets=(id:string)=>{for(const ws of sockets.get(id)??[])ws.close(1008,'Session revoked');sockets.delete(id);};
   const app = Fastify({ logger: { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] }, bodyLimit: 16_384, trustProxy: false });
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
   if (process.env.NODE_ENV === 'production') await app.register(fastifyStatic, { root: resolve(process.cwd(), 'dist/assets'), prefix: '/assets/', maxAge: '30d', immutable: true });
   app.addHook('onRequest', async (req, reply) => {
     if (req.url === '/health') return;
     if(req.url==='/api/command' && !req.cookies.session) return;
     if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
       if(!sameLoopbackOrigin(req.headers.origin, req.headers.host)) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
    }
  });
  const auth = (req: any) => {
    const raw = req.cookies.session; if (!raw) return undefined;
    const row = db.prepare('SELECT role,csrf,expires FROM sessions WHERE digest=?').get(hash(raw)) as any;
    return row && row.expires > Date.now() ? { ...row, raw, digest:hash(raw) } : undefined;
  };
   const tx = db.transaction((next: typeof state, rev: number, detail: string, nextSource: string) => {
     db.prepare('INSERT OR REPLACE INTO kv VALUES (?,?)').run('state', JSON.stringify(next));
     db.prepare('INSERT OR REPLACE INTO kv VALUES (?,?)').run('revision', String(rev));
     db.prepare('INSERT OR REPLACE INTO kv VALUES (?,?)').run('source', nextSource);
     db.prepare('INSERT INTO activity(detail) VALUES (?)').run(detail);
    db.prepare('DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 200)').run();
  });
  app.get('/health', async () => ({ ok: true }));
  app.post('/api/setup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req: any, reply) => {
    if (!options.bootstrapSecret || read('password')) return reply.code(409).send({ v:1, error: { code:'CONFLICT',message:'Unavailable',requestId:'request' } });
    if (req.body?.secret !== options.bootstrapSecret) return reply.code(403).send({ v:1, error: { code:'FORBIDDEN',message:'Forbidden',requestId:'request' } });
    if(typeof req.body.password!=='string'||Buffer.byteLength(req.body.password)<12||Buffer.byteLength(req.body.password)>128) return reply.code(400).send({v:1,error:{code:'INVALID_INPUT',message:'Invalid input',requestId:'request'}});
    const salt = randomBytes(16).toString('hex'); let derived:Buffer; try { derived=await derive(String(req.body.password??''),salt); } catch { return reply.code(503).send({v:1,error:{code:'UNAVAILABLE',message:'Unavailable',requestId:'request'}}); }
    db.prepare('INSERT INTO kv VALUES (?,?)').run('password', `${salt}:${derived.toString('hex')}`);
    return issue(reply, 'owner');
  });
  const secureCookie=false; // Loopback-only HTTP; enable only when TLS termination is implemented.
   const issue = (reply: any, role: string) => { const raw=token(), csrf=token(); db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(raw),role,csrf,Date.now()+86400000); reply.setCookie('session',raw,{httpOnly:true,sameSite:'strict',path:'/',secure:secureCookie}); return { csrf, role, demoEnabled: options.demo === true }; };
   app.post('/api/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req: any, reply) => {
    const saved=read('password')?.value; if (!saved) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
    if(typeof req.body?.password!=='string'||Buffer.byteLength(req.body.password)<12||Buffer.byteLength(req.body.password)>128) return reply.code(400).send({v:1,error:{code:'INVALID_INPUT',message:'Invalid input',requestId:'request'}});
    const [salt,expected]=saved.split(':'); let got:Buffer; try { got=await derive(req.body.password,salt); } catch { return reply.code(503).send({v:1,error:{code:'UNAVAILABLE',message:'Unavailable',requestId:'request'}}); } const exp=Buffer.from(expected,'hex');
    if(got.length!==exp.length || !timingSafeEqual(got,exp)) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
    return issue(reply,'owner');
  });
  app.post('/api/display/pair', async (req: any, reply) => { const owner=auth(req); if(owner?.role!=='owner'||req.body?.csrf!==owner.csrf) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}}); const code=token(); db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(code),'pair',token(),Date.now()+5*60_000); return {code}; });
   app.post('/api/display/redeem', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req: any, reply) => { const code=req.body?.code; if(typeof code!=='string'||code.length>128) return reply.code(400).send({v:1,error:{code:'INVALID_INPUT',message:'Invalid input',requestId:'request'}}); const d=hash(code); const row=db.prepare('SELECT role,expires FROM sessions WHERE digest=?').get(d) as any; if(row?.role!=='pair') return reply.code(403).send(errorBody('PAIRING_INVALID','This pairing code is invalid or has already been used')); if(row.expires<=Date.now()) return reply.code(403).send(errorBody('PAIRING_EXPIRED','This pairing code has expired. Request a new code')); db.prepare('DELETE FROM sessions WHERE digest=?').run(d); return issue(reply,'display'); });
  app.get('/api/sessions',async(req:any,reply)=>{const owner=auth(req); if(owner?.role!=='owner') return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}}); return {sessions:db.prepare("SELECT digest,role,expires FROM sessions WHERE role IN ('owner','display')").all().map((s:any)=>({id:s.digest,role:s.role,expires:s.expires}))};});
  app.delete('/api/sessions/:id',async(req:any,reply)=>{const owner=auth(req); if(owner?.role!=='owner'||req.body?.csrf!==owner.csrf) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}}); const id=String(req.params.id); db.prepare("DELETE FROM sessions WHERE digest=? AND role IN ('owner','display')").run(id); closeSockets(id); return {ok:true};});
  app.post('/api/logout',async(req:any,reply)=>{const session=auth(req);if(!session||req.body?.csrf!==session.csrf)return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});db.prepare('DELETE FROM sessions WHERE digest=?').run(session.digest);closeSockets(session.digest);reply.clearCookie('session',{path:'/'});return {ok:true};});
    app.post('/api/agents', async (req: any, reply) => { const owner=auth(req); if(owner?.role!=='owner'||req.body?.csrf!==owner.csrf) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}}); const secret=token(), id=randomUUID(); db.prepare('INSERT INTO agents(digest,revoked,agent_id) VALUES (?,0,?)').run(hash(secret),id); return { id, secret }; });
  app.delete('/api/agents/:digest', async (req: any, reply) => { const owner=auth(req); if(owner?.role!=='owner'||req.body?.csrf!==owner.csrf) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}}); db.prepare('UPDATE agents SET revoked=1 WHERE digest=?').run(req.params.digest); return {ok:true}; });
   const commit = (next: typeof state, detail: string, nextSource: string) => {
     const rev=revision+1;
     try { tx(next,rev,detail,nextSource); } catch { return false; }
     state=next; revision=rev; source=nextSource;
     const message=JSON.stringify({v:1,type:'state',revision,source,state});
     for(const group of sockets.values()) for(const ws of group) if(ws.readyState===1) ws.send(message);
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
      else if (command.type === 'task.update') next = { ...state, task: command.payload.task, activity: 'thinking', progress: null };
      else if (command.type === 'state.set-progress') next = { ...state, progress: command.payload.progress };
       else if (command.type === 'state.set-activity') {
         if (!canTransitionActivity(state.activity, command.payload.activity)) return null;
         next = { ...state, activity: command.payload.activity };
       }
       else if (command.type === 'task.complete') {
         if (!canTransitionActivity(state.activity, 'completed')) return null;
         next = { ...state, activity: 'completed', progress: 100, task: 'Task completed successfully' };
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
      if (isWidgetCommand) {
        const rev = revision + 1;
        try { db.transaction(() => { tx(next,rev,command.type,principalSource(principal)); db.prepare('INSERT INTO widget_commands VALUES (?,?,?,?,?)').run(principal,command.requestId,fingerprint,rev,Date.now()); db.prepare('DELETE FROM widget_commands WHERE rowid NOT IN (SELECT rowid FROM widget_commands ORDER BY created_at DESC LIMIT 1000)').run(); })(); }
        catch { return false; }
        state=next; revision=rev; source=principalSource(principal);
        const message=JSON.stringify({v:1,type:'state',revision,source,state}); for(const group of sockets.values()) for(const ws of group) if(ws.readyState===1) ws.send(message);
        return { revision };
      }
      return commit(next, command.type, principal === 'demo' || isDemoCommand ? 'demo' : principalSource(principal));
   };
    const cleanupExpired = () => {
      const cleaned = removeExpiredWidgets(state.widgets, now());
      if (cleaned.ok && cleaned.widgets.length !== state.widgets.length) commit({ ...state, widgets: cleaned.widgets }, 'widget.expiry-cleanup', source);
    };
    cleanupExpired();
    const expiryTimer = setInterval(cleanupExpired, 60_000);
    const demoTimer = options.demo ? setInterval(() => {
     if (!state.running) return;
     const command = CommandRequestSchema.parse({ v: 1, requestId: token(), type: 'demo.simulate', payload: {} });
     applyCommand(command, 'demo');
   }, 12_000) : undefined;
   app.get('/api/session', async (req: any) => { const session=auth(req); return session ? {role:session.role,csrf:session.csrf,demoEnabled:options.demo===true,setupRequired:!read('password')} : {role:null,demoEnabled:options.demo===true,setupRequired:!read('password')}; });
   app.get('/api/state', async (req: any, reply) => { if(!auth(req)) return reply.code(401).send({v:1,error:{code:'UNAUTHENTICATED',message:'Authentication required',requestId:'request'}}); return {v:1,type:'snapshot',revision,source,state}; });
  app.post('/api/command', async (req: any, reply) => {
    const session=auth(req); const agentHeader=req.headers.authorization;
    const agent=agentHeader?.startsWith('Bearer ') ? db.prepare('SELECT revoked,agent_id FROM agents WHERE digest=?').get(hash(agentHeader.slice(7))) as any : undefined;
    if(session&&agentHeader) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
    if(!session&&!agent) return reply.code(401).send({v:1,error:{code:'UNAUTHENTICATED',message:'Authentication required',requestId:'request'}});
    if(session?.role==='display') return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
     if(session && (req.body?.csrf!==session.csrf || !sameLoopbackOrigin(req.headers.origin, req.headers.host))) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
    if(agent && agent.revoked) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:'request'}});
    const commandInput = req.body?.command ?? Object.fromEntries(Object.entries(req.body ?? {}).filter(([key]) => key !== 'csrf'));
    const parsed=CommandRequestSchema.safeParse(commandInput); if(!parsed.success) return reply.code(400).send({v:1,error:{code:'INVALID_COMMAND',message:'Invalid command',requestId:req.body?.requestId??'request'}});
     const c=parsed.data;
       const principal: WidgetPrincipal = agent ? `agent:${agent.agent_id}` : 'owner';
      const result = applyCommand(c, principal);
      if(result === null) return reply.code(403).send({v:1,error:{code:'FORBIDDEN',message:'Forbidden',requestId:c.requestId}});
        if(typeof result === 'object' && 'error' in result) { const status: Record<string, number> = { INVALID_INPUT:400, FORBIDDEN:403, NOT_FOUND:404, CONFLICT:409 }; const code = String(result.error); return reply.code(status[code] ?? 403).send({v:1,error:{code,message:code,requestId:c.requestId}}); }
      if(!result) return reply.code(500).send({v:1,error:{code:'PERSISTENCE_FAILED',message:'Persistence failed',requestId:c.requestId}});
      return {ok:true,revision: typeof result === 'object' ? result.revision : revision};
   });
    app.get('/api/stream',{websocket:true},(socket,req:any)=>{const session=auth(req); if(!session || session.role==='pair'){socket.close(1008,'Unauthorized');return;} if(!sameLoopbackOrigin(req.headers.origin, req.headers.host)){socket.close(1008,'Unauthorized');return;} const id=session.digest; if(!sockets.has(id)) sockets.set(id,new Set()); sockets.get(id)!.add(socket);socket.send(JSON.stringify({v:1,type:'snapshot',revision,source,state}));socket.on('message',()=>socket.close(1008,'Read only'));socket.on('close',()=>{const group=sockets.get(id);group?.delete(socket);if(group?.size===0)sockets.delete(id);});const timer=setTimeout(()=>socket.close(1008,'Session expired'),Math.max(0,session.expires-Date.now()));socket.on('close',()=>clearTimeout(timer));});
     app.addHook('onClose', async () => { clearInterval(expiryTimer); if(demoTimer) clearInterval(demoTimer); db.close(); });
   if (process.env.NODE_ENV === 'production') {
     for (const path of ['/', '/admin', '/display']) app.get(path, async (_req, reply) => reply.sendFile('index.html', resolve(process.cwd(), 'dist'), { maxAge: 0, immutable: false }));
   }
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port=Number(process.env.PORT ?? 4174), host=process.env.HOST ?? '127.0.0.1';
  if(!['localhost','127.0.0.1','::1'].includes(host)) throw new Error('HTTP server must bind to loopback without TLS');
  const app=await createServer({database:process.env.GLIMPSE_DB,bootstrapSecret:process.env.GLIMPSE_BOOTSTRAP_SECRET,demo:process.env.GLIMPSE_DEMO==='1'});
  await app.listen({host,port}); const stop=async()=>{await app.close();process.exit(0);}; process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
