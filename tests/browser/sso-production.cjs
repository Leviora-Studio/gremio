// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
// Synthetic OIDC provider and isolated test users only.
const assert=require('node:assert/strict');const http=require('node:http');const {spawn}=require('node:child_process');const {randomUUID}=require('node:crypto');const {Pool}=require('pg');const {sealData}=require('iron-session');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/gremio_workflows_test_/);
 const pool=new Pool({connectionString:process.env.DATABASE_URL}),q=(s,p=[])=>pool.query(s,p);
 let offline=false;const identities=new Map();let checks=0,issuer;
 const provider=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/.well-known/openid-configuration'){res.end(JSON.stringify({authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',end_session_endpoint:issuer+'/logout',introspection_endpoint:issuer+'/introspect'}));return;}
  if(req.url==='/introspect'){checks++;if(offline){res.statusCode=503;res.end('{}');return;}let body='';for await(const chunk of req)body+=chunk;assert.equal(req.headers.authorization,'Basic '+Buffer.from(process.env.OIDC_CLIENT_ID+':'+process.env.OIDC_CLIENT_SECRET).toString('base64'));const v=identities.get(new URLSearchParams(body).get('token'));res.end(JSON.stringify(v?{active:true,sub:v,client_id:process.env.OIDC_CLIENT_ID,exp:Math.floor(Date.now()/1000)+3600}:{active:false}));return;}
  res.end('{}');
 });await new Promise(r=>provider.listen(0,'127.0.0.1',r));issuer='http://127.0.0.1:'+provider.address().port;
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const base='http://127.0.0.1:'+port;
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port),'-H','127.0.0.1'],{cwd:process.env.GREMIO_TEST_BUILD_DIR||process.cwd(),env:{...process.env,APP_BASE_URL:base,PUBLIC_BASE_URL:base,OIDC_ISSUER:issuer,NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
 let browser,board;const people=[];
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,log);
  for(const role of ['admin','user','user']){const sub=randomUUID(),username='sso-browser-'+randomUUID();people.push((await q('insert into users(username,sub,role) values ($1,$2,$3) returning *',[username,sub,role])).rows[0]);}
  const [admin,target,revoked]=people;for(const u of [admin,target])identities.set('token:'+u.sub,u.sub);
  const seal=(u,extra={})=>sealData({userId:u.id,sessionVersion:0,refreshToken:'token:'+u.sub,...extra},{password:process.env.AUTH_SECRET});
  const targetCookie=await seal(target);const call=(cookie,path='/api/board/0/stream')=>fetch(base+path,{headers:{cookie:'gremio_session='+cookie},redirect:'manual'});
  assert.equal((await call(targetCookie)).status,403);assert.equal((await call(targetCookie)).status,403);assert.equal(checks,1,'successful checks are cached across requests');
  assert.equal((await call(await seal(revoked))).status,401);
  offline=true;assert.equal((await call(await seal(target,{refreshToken:'uncached-outage-token'}))).status,401);offline=false;
  board=(await q("insert into boards(name,owner_id) values ('SSO stream fixture',$1) returning id",[target.id])).rows[0].id;
  const abort=new AbortController();const stream=await fetch(base+'/api/board/'+board+'/stream',{headers:{cookie:'gremio_session='+targetCookie},signal:abort.signal});assert.equal(stream.status,200);const reader=stream.body.getReader();assert.ok(!(await reader.read()).done);
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addCookies([{name:'gremio_session',value:await seal(admin),url:base,httpOnly:true,sameSite:'Lax'}]);const page=await ctx.newPage();page.setDefaultTimeout(10000);await page.goto(base+'/admin/users');
  let card=page.locator('.card').filter({has:page.getByText(target.username,{exact:true})});await card.getByRole('button',{name:'Deaktivieren',exact:true}).click();await page.getByRole('button',{name:'Nutzer deaktivieren',exact:true}).click();await card.getByText('inaktiv',{exact:true}).waitFor();
  assert.equal((await call(targetCookie)).status,401);
  await q("select pg_notify('card_change',$1)",[JSON.stringify({boardId:board,token:'synthetic-card-token'})]);
  const closed=(async()=>{let content='';while(true){const value=await reader.read();if(value.done)return content;content+=new TextDecoder().decode(value.value);}})();let timeout;
  try{const content=await Promise.race([closed,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('protected SSE did not close after local deactivation')),5000);})]);assert.ok(!content.includes('data: change'));}finally{clearTimeout(timeout);abort.abort();}
  await card.getByRole('button',{name:'Reaktivieren',exact:true}).click();await page.getByRole('button',{name:'Nutzer reaktivieren',exact:true}).click();await card.getByRole('button',{name:'Deaktivieren',exact:true}).waitFor();assert.equal((await call(targetCookie)).status,401);assert.equal((await call(await seal(target,{sessionVersion:2}))).status,403);
  const own=page.locator('.card').filter({has:page.getByText(admin.username,{exact:true})});assert.equal(await own.getByRole('button',{name:'Deaktivieren',exact:true}).count(),0);
  console.log(JSON.stringify({passed:true,localDeactivation:true,reactivationRequiresNewLogin:true,ssoRejectsInactive:true,ssoOutageFailsClosed:true,protectedStreamClosed:true,introspectionChecks:checks}));
 }finally{
  if(browser)await browser.close();server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await new Promise(r=>provider.close(r));if(board)await q('delete from boards where id=$1',[board]);for(const u of people)await q('delete from users where id=$1',[u.id]);await pool.end();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
