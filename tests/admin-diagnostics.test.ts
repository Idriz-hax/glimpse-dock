import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server/server.ts';

describe('admin diagnostics', () => {
  let app: Awaited<ReturnType<typeof createServer>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });
  it('returns valid empty diagnostics for an owner with no operational events', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'secret' });
    const owner = await app.inject({ method:'POST', url:'/api/setup', headers:{origin:'http://localhost:80'}, payload:{secret:'secret',username:'owner',password:'long-enough-password'} });
    const cookie=String(owner.headers['set-cookie']).split(';')[0];
    const response=await app.inject({url:'/api/admin/diagnostics',headers:{cookie}});
    expect(response.statusCode).toBe(200);
    const diagnostics=response.json();
    expect(diagnostics.readiness).toMatchObject({loopbackBinding:true,storage:'available'});
    expect(diagnostics.agents).toEqual([]);
    expect(diagnostics.pairedSessions).toEqual([]);
    expect(diagnostics.events).toEqual([]);
    expect(diagnostics.events.length).toBeLessThanOrEqual(50);
    expect(diagnostics.retention.diagnostics).toEqual({retained:0,limit:200});
    expect(diagnostics.retention.activity).toMatchObject({retained:0,limit:200,behavior:'prune-oldest-above-limit'});
  });
  it('is owner-only and reports bounded safe operational facts', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'secret' });
    const origin = { origin: 'http://localhost:80' };
    const owner = await app.inject({ method: 'POST', url: '/api/setup', headers: origin, payload: { secret: 'secret', username: 'owner', password: 'long-enough-password' } });
    const cookie = String(owner.headers['set-cookie']).split(';')[0];
    expect((await app.inject({ url: '/api/admin/diagnostics' })).statusCode).toBe(403);
    expect((await app.inject({ url:'/api/admin/diagnostics', headers:{cookie, origin:'http://evil.example'} })).statusCode).toBe(403);
    const agent = await app.inject({ method:'POST', url:'/api/agents', headers:{...origin,cookie}, payload:{csrf:owner.json().csrf} });
    const denied = await app.inject({ method:'POST', url:'/api/command', headers:{...origin, authorization:`Bearer ${agent.json().secret}`}, payload:{command:{bad:'sensitive prompt'} } });
    expect(denied.statusCode).toBe(400);
    let result = await app.inject({ url:'/api/admin/diagnostics', headers:{cookie} });
    expect(result.statusCode).toBe(200);
    const data = result.json();
    expect(data.agents).toEqual([{ id: agent.json().id, revoked: false, capabilities:'unknown', presence:'unknown' }]);
    expect(data.events[0]).toMatchObject({ category:'command', code:'INVALID_COMMAND', status:400 });
    expect(data.readiness).toMatchObject({ loopbackBinding:true, storage:'available', hermes:{configured:false,availability:'not-verified'}, wyoming:{configured:false,availability:'not-verified'} });
    expect(data.retention).toMatchObject({ activity:{limit:200,behavior:'prune-oldest-above-limit'}, diagnostics:{limit:200} });
    expect(JSON.stringify(data)).not.toContain('sensitive prompt');
    expect(JSON.stringify(data)).not.toContain(agent.json().secret);
    expect(data.events.length).toBeLessThanOrEqual(50);
    for (let i=0;i<100;i++) await app.inject({ method:'POST', url:'/api/command', headers:{...origin,cookie}, payload:{csrf:owner.json().csrf, command:{bad:`secret-${i}`}} });
    result = await app.inject({ url:'/api/admin/diagnostics', headers:{cookie} });
    expect(result.json().retention.diagnostics.retained).toBeLessThanOrEqual(200);
    expect(result.json().retention.diagnostics.limit).toBe(200);
    expect(result.json().events.length).toBeLessThanOrEqual(50);
  });
  it('reports accepted activity and current paired session expiry state', async () => {
    app = await createServer({ database: ':memory:', bootstrapSecret: 'secret', voiceClients:{hermes:{createSession:async()=>'',startRun:async()=>{},stopRun:async()=>{},readRunEvents:async()=>[]},wyoming:{listWakeModels:async()=>[],listVoices:async()=>[],detectWake:async()=>false,transcribe:async()=>'',synthesize:async()=>Buffer.alloc(0)}} });
    const origin={origin:'http://localhost:80'};
    const login=await app.inject({method:'POST',url:'/api/setup',headers:origin,payload:{secret:'secret',username:'owner',password:'long-enough-password'}});
    const cookie=String(login.headers['set-cookie']).split(';')[0];
    await app.inject({method:'POST',url:'/api/command',headers:{...origin,cookie},payload:{csrf:login.json().csrf,command:{v:1,requestId:'safe',type:'task.update',payload:{task:'private prompt'}}}});
    const pair=await app.inject({method:'POST',url:'/api/display/pair',headers:{...origin,cookie},payload:{csrf:login.json().csrf}});
    await app.inject({method:'POST',url:'/api/display/redeem',headers:origin,payload:{code:pair.json().code}});
    const result=await app.inject({url:'/api/admin/diagnostics',headers:{cookie}});
    const data=result.json();
    expect(data.events[0]).toMatchObject({category:'command',code:'COMMAND_ACCEPTED',status:200});
    expect(data.readiness.hermes).toEqual({configured:true,availability:'not-verified'});
    expect(data.readiness.wyoming).toEqual({configured:true,availability:'not-verified'});
    expect(data.pairedSessions).toHaveLength(1);
    expect(data.pairedSessions[0]).toMatchObject({status:'active',revoked:false});
    expect(data.pairedSessions[0].expires).toEqual(expect.any(Number));
    expect(data.retention.activity).toMatchObject({limit:200,behavior:'prune-oldest-above-limit'});
    expect(JSON.stringify(data)).not.toContain('private prompt');
  });
  it('prunes diagnostics and activity beyond 200 while keeping endpoint output bounded', async () => {
    const directory=mkdtempSync(join(tmpdir(),'glimpse-diagnostics-'));
    const database=join(directory,'test.sqlite');
    try {
      app=await createServer({database,bootstrapSecret:'secret'});
      const origin={origin:'http://localhost:80'};
      const setup=await app.inject({method:'POST',url:'/api/setup',headers:origin,payload:{secret:'secret',username:'owner',password:'long-enough-password'}});
      const cookie=String(setup.headers['set-cookie']).split(';')[0];
      for(let batch=0;batch<3;batch++) {
        if(batch>0) { await app.close(); app=await createServer({database}); }
        for(let i=0;i<100;i++) {
          const response=await app.inject({method:'POST',url:'/api/command',headers:{...origin,cookie},payload:{csrf:setup.json().csrf,command:{v:1,requestId:`accepted-${batch}-${i}`,type:'task.update',payload:{task:'safe'}}}});
          expect(response.statusCode).toBe(200);
        }
      }
      const response=await app.inject({url:'/api/admin/diagnostics',headers:{cookie}});
      expect(response.statusCode).toBe(200);
      const diagnostics=response.json();
      expect(diagnostics.retention.diagnostics).toEqual({retained:200,limit:200});
      expect(diagnostics.retention.activity).toMatchObject({retained:200,limit:200,behavior:'prune-oldest-above-limit'});
      expect(diagnostics.events).toHaveLength(50);
      expect(diagnostics.events.every((event:any)=>event.code==='COMMAND_ACCEPTED'&&event.status===200)).toBe(true);
      expect(JSON.stringify(diagnostics)).not.toContain('accepted-');
      expect(JSON.stringify(diagnostics)).not.toContain('safe');
    } finally {
      await app?.close(); app=undefined;
      rmSync(directory,{recursive:true,force:true});
    }
  });
});
