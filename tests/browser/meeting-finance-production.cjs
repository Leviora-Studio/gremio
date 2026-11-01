// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),{Pool}=require('pg'),{sealData}=require('iron-session'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process'),{createServer}=require('node:net'),{mkdtempSync,writeFileSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/gremio_workflows_test_/);
 const output=mkdtempSync(join(tmpdir(),'gremio-meeting-finance-browser-')),pool=new Pool({connectionString:process.env.DATABASE_URL}),q=(sql,args=[])=>pool.query(sql,args);
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const base='http://127.0.0.1:'+port;
 const sso=await require('./synthetic-sso.cjs').startSyntheticSso(),child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port),'-H','127.0.0.1'],{cwd:process.env.GREMIO_TEST_BUILD_DIR,env:{...process.env,APP_BASE_URL:base,PUBLIC_BASE_URL:base,OIDC_ISSUER:sso.issuer,NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 let browser,board,area,meeting;const users=[];
 try {
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}assert.ok(ready,log);
  for(const kind of ['owner','reader']){const u=(await q('insert into users(username) values ($1) returning id',['finance-browser-'+kind+'-'+randomUUID()])).rows[0];await q('update users set sub=$1 where id=$2',['synthetic:'+u.id,u.id]);users.push(u.id);}
  const [owner,reader]=users;
  board=(await q("insert into boards(name,owner_id) values ('Financial applications board',$1) returning id",[owner])).rows[0].id;
  const statuses=(await q("insert into board_statuses(board_id,name,position) values ($1,'Incoming',0),($1,'Scheduled',1),($1,'Unselected',2) returning id,name",[board])).rows;
  const [source,target,excluded]=statuses;
  for(const field of ['number','meeting','applicant','requested_amount'])await q('insert into board_card_fields(board_id,field_key,visible) values ($1,$2,true)',[board,field]);
  const card=(await q("insert into cards(board_id,status_id,title,number,applicant,token,requested_amount) values ($1,$2,'Campus festival','FA-2042','Alex Example',$3,200000) returning id",[board,source.id,randomUUID()])).rows[0].id;
  await q("insert into cards(board_id,status_id,title,number,applicant,token) values ($1,$2,'NOT OFFERED','FA-HIDDEN','Example',$3)",[board,excluded.id,randomUUID()]);
  area=(await q("insert into meeting_areas(name,owner_id) values ('Finance committee',$1) returning id",[owner])).rows[0].id;
  await q("insert into meeting_area_access(area_id,user_id,access_level) values ($1,$2,'read')",[area,reader]);
  meeting=(await q("insert into meetings(area_id,owner_id,title,starts_at) values ($1,$2,'Finance meeting','2026-11-12T17:00:00Z') returning id",[area,owner])).rows[0].id;
  const root=(await q("insert into meeting_topics(meeting_id,title,state,created_by) values ($1,'Finanzanträge','scheduled',$2) returning id",[meeting,owner])).rows[0].id;
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});const ctx=await browser.newContext({viewport:{width:1400,height:1000}}),readCtx=await browser.newContext();
  for(const [c,id] of [[ctx,owner],[readCtx,reader]])await c.addCookies([{name:'gremio_session',value:await sealData(sso.session(id),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);
  const page=await ctx.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/intern/sitzungen/bereich/'+area+'/einstellungen');
  await page.getByRole('button',{name:'Antragsboard',exact:true}).click();await page.getByRole('option',{name:'Financial applications board',exact:true}).click();
  await page.getByRole('checkbox',{name:'Incoming',exact:true}).check();
  await page.getByRole('button',{name:'Zielspalte beim Einplanen',exact:true}).click();await page.getByRole('option',{name:'Scheduled',exact:true}).click();
  const financeForm=page.locator('form').filter({has:page.getByRole('button',{name:'Antragsboard',exact:true})});
  await financeForm.getByRole('button',{name:'Speichern',exact:true}).click();await financeForm.getByRole('status').filter({hasText:'Finanzanträge-Einstellungen gespeichert.'}).waitFor();
  const config=(await q('select finance_board_id,finance_source_status_ids,finance_target_status_id from meeting_areas where id=$1',[area])).rows[0];assert.equal(config.finance_board_id,board);assert.deepEqual(config.finance_source_status_ids,[source.id]);assert.equal(config.finance_target_status_id,target.id);
  for(const width of [1400,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(400);await page.screenshot({path:join(output,'settings-'+width+'.png'),fullPage:true,animations:"disabled"});}
  await page.setViewportSize({width:1400,height:1000});await page.goto(base+'/intern/sitzungen/top/'+root);
  await page.getByRole('button',{name:'Als Finanzanträge-TOP festlegen',exact:true}).click();await page.getByRole('button',{name:'Finanzantrag auswählen',exact:true}).waitFor();
  for(const width of [1400,390]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(400);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(output,'financial-top-'+width+'.png'),fullPage:true,animations:'disabled'});}await page.setViewportSize({width:1400,height:1000});
  assert.equal(await page.getByRole('searchbox',{name:'Finanzanträge durchsuchen',exact:true}).count(),0,'financial planning has no search');
  await page.getByRole('button',{name:'Finanzantrag auswählen',exact:true}).click();await page.getByRole('option',{name:'FA-2042 Campus festival',exact:true}).waitFor();assert.equal(await page.getByRole('option',{name:'FA-HIDDEN NOT OFFERED',exact:true}).count(),0);await page.getByRole('option',{name:'FA-2042 Campus festival',exact:true}).click();
  await page.getByRole('button',{name:'Als Unter-TOP einplanen',exact:true}).click();await page.getByRole('link',{name:'TOP 1.1: FA-2042 Campus festival',exact:true}).waitFor();
  const fresh=(await q('select status_id,meeting from cards where id=$1',[card])).rows[0];assert.equal(fresh.status_id,target.id);assert.equal(fresh.meeting,'2026-11-12');
  assert.equal(await page.getByRole('button',{name:'Finanzantrag auswählen',exact:true}).count(),0,'planned card removed from picker');
  await page.getByRole('link',{name:'TOP 1.1: FA-2042 Campus festival',exact:true}).click();await page.getByRole('heading',{name:'TOP 1.1: FA-2042 Campus festival',exact:true}).waitFor();await page.getByText('2.000,00 €',{exact:true}).waitFor();assert.ok(await page.getByRole('link',{name:'Interne Karte öffnen →',exact:true}).getAttribute('href')==='/intern/card/'+card);
  for(const width of [1400,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(400);await page.screenshot({path:join(output,'topic-'+width+'.png'),fullPage:true,animations:"disabled"});}
  const pdf=await ctx.request.get(base+'/api/meetings/'+meeting+'/pdf');assert.equal(pdf.status(),200);writeFileSync(join(output,'financial-agenda.pdf'),await pdf.body());
  const read=await readCtx.newPage();await read.goto(base+'/intern/sitzungen/'+meeting);assert.ok(!(await read.locator('body').innerText()).includes('Campus festival'));assert.equal(await read.getByRole('link',{name:/FA-2042/}).count(),0);
  await q("insert into board_access(board_id,user_id,access_level) values ($1,$2,'read')",[board,reader]);await read.getByRole('link',{name:'TOP 1.1: FA-2042 Campus festival',exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,configuration:true,sourceFilter:true,financialTop:true,planCard:true,sourceMove:true,meetingDate:true,privateProjection:true,liveAccess:true,pdf:true,mobile:true,screenshots:output}));
 }catch(error){if(browser){const p=browser.contexts().flatMap(c=>c.pages())[0];if(p)await p.screenshot({path:join(output,'failure.png'),fullPage:true});}console.log('Browser output: '+output);throw error;}
 finally{if(browser)await browser.close();child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await sso.close();if(meeting)await q('delete from meetings where id=$1',[meeting]);if(area)await q('delete from meeting_areas where id=$1',[area]);if(board)await q('delete from boards where id=$1',[board]);for(const id of users)await q('delete from users where id=$1',[id]);await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
