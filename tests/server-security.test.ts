import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../server/server.ts';
import { ErrorResponseSchema } from '../src/shared/protocol.ts';

describe('server security', () => {
  let app: Awaited<ReturnType<typeof createServer>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks(); vi.useRealTimers(); });
  it('limits setup/login/redeem per route', async () => {
    app=await createServer({database:':memory:',bootstrapSecret:'secret'});
    for(let i=0;i<5;i++) await app.inject({method:'POST',url:'/api/setup',headers:{origin:'http://localhost:80'},payload:{secret:'bad',password:'long-enough-password'}});
    const limited = await app.inject({method:'POST',url:'/api/setup',headers:{origin:'http://localhost:80'},payload:{secret:'bad',password:'long-enough-password'}});
    expect(limited.statusCode).toBe(429);
    expect(ErrorResponseSchema.safeParse(limited.json()).success).toBe(true);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.json().error.message).toMatch(/wait|retry/i);
    for(let i=0;i<5;i++) await app.inject({method:'POST',url:'/api/login',headers:{origin:'http://localhost:80'},payload:{password:'long-enough-password'}});
    expect((await app.inject({method:'POST',url:'/api/login',headers:{origin:'http://localhost:80'},payload:{password:'long-enough-password'}})).statusCode).toBe(429);
    for(let i=0;i<5;i++) await app.inject({method:'POST',url:'/api/display/redeem',headers:{origin:'http://localhost:80'},payload:{code:'bad'}});
    const redeemLimited=await app.inject({method:'POST',url:'/api/display/redeem',headers:{origin:'http://localhost:80'},payload:{code:'bad'}});
    expect(redeemLimited.statusCode).toBe(429);
    expect(ErrorResponseSchema.safeParse(redeemLimited.json()).success).toBe(true);
    expect(redeemLimited.json().error.code).toBe('RATE_LIMITED');
    expect(redeemLimited.json().error.message).toMatch(/wait|retry/i);
  });
  it('intentionally shares unauthenticated limits across loopback clients', async () => {
    app=await createServer({database:':memory:',bootstrapSecret:'secret'});
    for(let i=0;i<5;i++) await app.inject({method:'POST',url:'/api/login',headers:{origin:'http://localhost:80','x-forwarded-for':`192.0.2.${i+1}`},payload:{password:'long-enough-password'}});
    const otherClient=await app.inject({method:'POST',url:'/api/login',headers:{origin:'http://localhost:80','x-forwarded-for':'198.51.100.7'},payload:{password:'long-enough-password'}});
    expect(otherClient.statusCode).toBe(429);
    expect(ErrorResponseSchema.safeParse(otherClient.json()).success).toBe(true);
  });
  it('logs out authenticated sessions with CSRF and invalidates their cookie', async()=>{
    app=await createServer({database:':memory:',bootstrapSecret:'secret'});
    const login=await app.inject({method:'POST',url:'/api/setup',headers:{origin:'http://localhost:80'},payload:{secret:'secret',password:'long-enough-password'}});
    const cookie=String(login.headers['set-cookie']).split(';')[0];
    expect((await app.inject({method:'POST',url:'/api/logout',headers:{cookie,origin:'http://localhost:80'},payload:{csrf:login.json().csrf}})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/state',headers:{cookie}})).statusCode).toBe(401);
  });
  it('allows only the owner to save complete display preferences', async () => {
    app=await createServer({database:':memory:',bootstrapSecret:'secret'});
    const origin={origin:'http://localhost:80'};
    const owner=await app.inject({method:'POST',url:'/api/setup',headers:origin,payload:{secret:'secret',password:'long-enough-password'}});
    const cookie=String(owner.headers['set-cookie']).split(';')[0];
    const preferences={scale:'large',reducedMotion:true,intensity:'vivid',showClock:false,showWidgets:false,layout:'compact'};
    const command={v:1,requestId:'prefs-1',type:'display.preferences.set',payload:{preferences}};
    expect((await app.inject({method:'POST',url:'/api/command',headers:{...origin,cookie},payload:{csrf:owner.json().csrf,command}})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/state',headers:{cookie}})).json().state.displayPreferences).toEqual(preferences);
    expect((await app.inject({method:'POST',url:'/api/command',headers:{...origin,cookie},payload:{csrf:owner.json().csrf,command:{...command,requestId:'bad',payload:{preferences:{scale:'huge'}}}}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/command',headers:{...origin,cookie},payload:{csrf:owner.json().csrf,command:{...command,requestId:'partial',payload:{preferences:{scale:'normal'}}}}})).statusCode).toBe(400);
    const agent=await app.inject({method:'POST',url:'/api/agents',headers:{...origin,cookie},payload:{csrf:owner.json().csrf}});
    expect((await app.inject({method:'POST',url:'/api/command',headers:{...origin,authorization:`Bearer ${agent.json().secret}`},payload:command})).statusCode).toBe(403);
    const pair=await app.inject({method:'POST',url:'/api/display/pair',headers:{...origin,cookie},payload:{csrf:owner.json().csrf}});
    const display=await app.inject({method:'POST',url:'/api/display/redeem',headers:origin,payload:{code:pair.json().code}});
    expect((await app.inject({method:'POST',url:'/api/command',headers:{...origin,cookie:String(display.headers['set-cookie']).split(';')[0]},payload:{csrf:display.json().csrf,command}})).statusCode).toBe(403);
  });
  it('lists and revokes display sessions and pairing code is one-time', async()=>{
    app=await createServer({database:':memory:',bootstrapSecret:'secret'});
    const owner=await app.inject({method:'POST',url:'/api/setup',headers:{origin:'http://localhost:80'},payload:{secret:'secret',password:'long-enough-password'}});
    const cookie=String(owner.headers['set-cookie']).split(';')[0], csrf=owner.json().csrf;
    const pair=await app.inject({method:'POST',url:'/api/display/pair',headers:{cookie,origin:'http://localhost:80'},payload:{csrf}});
    const redeemed=await app.inject({method:'POST',url:'/api/display/redeem',headers:{origin:'http://localhost:80'},payload:{code:pair.json().code}});
    const reused=await app.inject({method:'POST',url:'/api/display/redeem',headers:{origin:'http://localhost:80'},payload:{code:pair.json().code}});
    expect(reused.statusCode).toBe(403);
    expect(reused.json().error.code).toBe('PAIRING_INVALID');
    const sessions=await app.inject({url:'/api/sessions',headers:{cookie}});
    const display=sessions.json().sessions.find((s:any)=>s.role==='display');
    expect(display).toBeTruthy();
    expect((await app.inject({method:'DELETE',url:`/api/sessions/${display.id}`,headers:{cookie,origin:'http://localhost:80'},payload:{csrf}})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/state',headers:{cookie:String(redeemed.headers['set-cookie']).split(';')[0]}})).statusCode).toBe(401);
  });
  it('revokes agents by public identity while preserving owner authorization', async()=>{
    app=await createServer({database:':memory:',bootstrapSecret:'secret'});
    const origin={origin:'http://localhost:80'};
    const owner=await app.inject({method:'POST',url:'/api/setup',headers:origin,payload:{secret:'secret',password:'long-enough-password'}});
    const cookie=String(owner.headers['set-cookie']).split(';')[0];
    const agent=await app.inject({method:'POST',url:'/api/agents',headers:{...origin,cookie},payload:{csrf:owner.json().csrf}});
    const pair=await app.inject({method:'POST',url:'/api/display/pair',headers:{...origin,cookie},payload:{csrf:owner.json().csrf}});
    const display=await app.inject({method:'POST',url:'/api/display/redeem',headers:origin,payload:{code:pair.json().code}});
    const displayCookie=String(display.headers['set-cookie']).split(';')[0];
    expect((await app.inject({method:'DELETE',url:`/api/agents/${agent.json().id}`,headers:{cookie:displayCookie,origin:'http://localhost:80'},payload:{csrf:display.json().csrf}})).statusCode).toBe(403);
    const revoked=await app.inject({method:'DELETE',url:`/api/agents/${agent.json().id}`,headers:{cookie,origin:'http://localhost:80'},payload:{csrf:owner.json().csrf}});
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ok:true});
    expect((await app.inject({method:'POST',url:'/api/command',headers:{...origin,authorization:`Bearer ${agent.json().secret}`},payload:{v:1,requestId:'after-revoke',type:'task.update',payload:{task:'test'}}})).statusCode).toBe(403);
  });
  it('accepts pairing before five minutes and distinguishes expired from invalid codes', async()=>{
    let time=Date.parse('2026-01-01T00:00:00Z');
    vi.spyOn(Date,'now').mockImplementation(()=>time);
    app=await createServer({database:':memory:',bootstrapSecret:'secret'});
    const origin={origin:'http://localhost:80'};
    const owner=await app.inject({method:'POST',url:'/api/setup',headers:origin,payload:{secret:'secret',password:'long-enough-password'}});
    const cookie=String(owner.headers['set-cookie']).split(';')[0];
    const pair=await app.inject({method:'POST',url:'/api/display/pair',headers:{...origin,cookie},payload:{csrf:owner.json().csrf}});
    time=Date.parse('2026-01-01T00:04:59.999Z');
    const redeemed=await app.inject({method:'POST',url:'/api/display/redeem',headers:origin,payload:{code:pair.json().code}});
    expect(redeemed.statusCode).toBe(200);

    const expiredPair=await app.inject({method:'POST',url:'/api/display/pair',headers:{...origin,cookie},payload:{csrf:owner.json().csrf}});
    time=Date.parse('2026-01-01T00:10:00Z');
    const expired=await app.inject({method:'POST',url:'/api/display/redeem',headers:origin,payload:{code:expiredPair.json().code}});
    expect(expired.statusCode).toBe(403);
    expect(expired.json().error.code).toBe('PAIRING_EXPIRED');
    expect(ErrorResponseSchema.safeParse(expired.json()).success).toBe(true);
    const invalid=await app.inject({method:'POST',url:'/api/display/redeem',headers:origin,payload:{code:'not-a-code'}});
    expect(invalid.json().error.code).toBe('PAIRING_INVALID');
  });
});
