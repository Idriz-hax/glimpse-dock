import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../server/server.ts';
import { ErrorResponseSchema } from '../src/shared/protocol.ts';

describe('server security', () => {
  let app: Awaited<ReturnType<typeof createServer>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });
  it('limits setup/login/redeem per route', async () => {
    app=await createServer({database:':memory:',bootstrapSecret:'secret'});
    for(let i=0;i<5;i++) await app.inject({method:'POST',url:'/api/setup',headers:{origin:'http://localhost:80'},payload:{secret:'bad',password:'long-enough-password'}});
    const limited = await app.inject({method:'POST',url:'/api/setup',headers:{origin:'http://localhost:80'},payload:{secret:'bad',password:'long-enough-password'}});
    expect(limited.statusCode).toBe(429);
    expect(ErrorResponseSchema.safeParse(limited.json()).success).toBe(true);
    for(let i=0;i<5;i++) await app.inject({method:'POST',url:'/api/login',headers:{origin:'http://localhost:80'},payload:{password:'long-enough-password'}});
    expect((await app.inject({method:'POST',url:'/api/login',headers:{origin:'http://localhost:80'},payload:{password:'long-enough-password'}})).statusCode).toBe(429);
    for(let i=0;i<5;i++) await app.inject({method:'POST',url:'/api/display/redeem',headers:{origin:'http://localhost:80'},payload:{code:'bad'}});
    expect((await app.inject({method:'POST',url:'/api/display/redeem',headers:{origin:'http://localhost:80'},payload:{code:'bad'}})).statusCode).toBe(429);
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
  it('lists and revokes display sessions and pairing code is one-time', async()=>{
    app=await createServer({database:':memory:',bootstrapSecret:'secret'});
    const owner=await app.inject({method:'POST',url:'/api/setup',headers:{origin:'http://localhost:80'},payload:{secret:'secret',password:'long-enough-password'}});
    const cookie=String(owner.headers['set-cookie']).split(';')[0], csrf=owner.json().csrf;
    const pair=await app.inject({method:'POST',url:'/api/display/pair',headers:{cookie,origin:'http://localhost:80'},payload:{csrf}});
    const redeemed=await app.inject({method:'POST',url:'/api/display/redeem',headers:{origin:'http://localhost:80'},payload:{code:pair.json().code}});
    expect((await app.inject({method:'POST',url:'/api/display/redeem',headers:{origin:'http://localhost:80'},payload:{code:pair.json().code}})).statusCode).toBe(403);
    const sessions=await app.inject({url:'/api/sessions',headers:{cookie}});
    const display=sessions.json().sessions.find((s:any)=>s.role==='display');
    expect(display).toBeTruthy();
    expect((await app.inject({method:'DELETE',url:`/api/sessions/${display.id}`,headers:{cookie,origin:'http://localhost:80'},payload:{csrf}})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/state',headers:{cookie:String(redeemed.headers['set-cookie']).split(';')[0]}})).statusCode).toBe(401);
  });
});
