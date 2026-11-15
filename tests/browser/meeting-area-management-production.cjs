// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
// Real session actions with isolated synthetic data only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {Pool}=require('pg');const {sealData}=require('iron-session');const {randomUUID}=require('node:crypto');
const {mkdtempSync,writeFileSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');const {spawn}=require('node:child_process');const {createServer}=require('node:net');const assert=require('node:assert/strict');
(async()=>{
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/gremio_workflows_test_/);
 const pool=new Pool({connectionString:process.env.DATABASE_URL}),q=(sql,args=[])=>pool.query(sql,args),output=mkdtempSync(join(tmpdir(),'gremio-area-management-browser-'));
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const base=`http://127.0.0.1:${port}`,sso=await require('./synthetic-sso.cjs').startSyntheticSso();
 const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port),'-H','127.0.0.1'],{cwd:process.env.GREMIO_TEST_BUILD_DIR,env:{...process.env,APP_BASE_URL:base,PUBLIC_BASE_URL:base,OIDC_ISSUER:sso.issuer,UPLOAD_DIR:join(output,'uploads'),NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});let log='',browser;const users=[],areas=[];child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,log);
  const suffix=randomUUID(),names=['owner','writer','reader','admin'].map(role=>`${role}-${suffix}`);
  for(const [index,name]of names.entries()){const id=(await q('insert into users(username,role) values($1,$2) returning id',[name,index===3?'admin':'user'])).rows[0].id;users.push(id);await q('update users set sub=$1 where id=$2',['synthetic:'+id,id]);}const[owner,writer,reader,admin]=users;
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
  for(const width of [1400,390]){
   const contexts=[],pages=[];for(const user of users){const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context);await context.addCookies([{name:'gremio_session',value:await sealData(sso.session(user),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);pages.push(await context.newPage());}const[ownerPage,writerPage,readerPage,adminPage]=pages;
   const name=`Bereich ${width} ${suffix}`,area=(await q('insert into meeting_areas(name,owner_id) values($1,$2) returning id',[name,owner])).rows[0].id;areas.push(area);
   await q("insert into meeting_area_access(area_id,user_id,access_level) values($1,$2,'write'),($1,$3,'read')",[area,writer,reader]);
   const meeting=(await q("insert into meetings(area_id,owner_id,title) values($1,$2,'Test-Sitzung') returning id",[area,owner])).rows[0].id;
   const settings=`${base}/intern/sitzungen/bereich/${area}/einstellungen`;
   assert.equal((await writerPage.request.get(settings)).status(),404);assert.equal((await readerPage.request.get(settings)).status(),404);
   await ownerPage.goto(settings);const management=ownerPage.locator('details').filter({has:ownerPage.locator('summary').filter({hasText:/^Verwaltungsrechte vergeben$/})});await management.locator('summary').click();await management.getByLabel('Person mit Schreibzugriff',{exact:true}).click();assert.equal(await ownerPage.getByRole('option',{name:names[2],exact:true}).count(),0);await ownerPage.getByRole('option',{name:names[1],exact:true}).click();await management.getByRole('button',{name:'Verwaltungsrechte vergeben',exact:true}).click();await management.getByRole('status').filter({hasText:'Verwaltungsrechte vergeben.'}).waitFor();
   await writerPage.goto(`${base}/intern/sitzungen/bereich/${area}`);await writerPage.getByRole('link',{name:'Bereichseinstellungen',exact:true}).click();await writerPage.waitForURL(url=>url.pathname===`/intern/sitzungen/bereich/${area}/einstellungen`);await writerPage.getByRole('heading',{name:'Bereichseinstellungen',exact:true}).waitFor();
   assert.deepEqual(await writerPage.locator('summary').allTextContents(),['Allgemein','Tagesordnung','Standard-TOPs','Wordexport','Finanzanträge','Freigaben']);
   assert.equal(await writerPage.getByRole('button',{name:'Sitzungsbereich löschen',exact:true,includeHidden:true}).count(),0);assert.equal(await writerPage.getByRole('button',{name:'Verwaltungsrechte vergeben',exact:true,includeHidden:true}).count(),0);
   const general=writerPage.locator('details').filter({has:writerPage.locator('summary').filter({hasText:/^Allgemein$/})});await general.locator('input[name="name"]').fill(`Verwaltet ${width}`);await general.getByRole('button',{name:'Speichern',exact:true}).click();await general.getByRole('status').filter({hasText:'Sitzungsbereich gespeichert.'}).waitFor();assert.equal((await q('select name,owner_id from meeting_areas where id=$1',[area])).rows[0].owner_id,owner);
   assert.ok(await writerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await writerPage.screenshot({path:join(output,`delegate-settings-${width}.png`),fullPage:true});
   await writerPage.goto(`${base}/intern/sitzungen/${meeting}/einstellungen`);assert.equal(await writerPage.locator('summary').filter({hasText:/^Boards anbinden$/}).count(),1);assert.equal(await writerPage.getByRole('button',{name:'Sitzung löschen',exact:true,includeHidden:true}).count(),0);assert.equal(await writerPage.getByRole('link',{name:'Bereichsfreigaben verwalten',exact:true}).count(),1);
   await q("update meeting_area_access set access_level='read' where area_id=$1 and user_id=$2",[area,writer]);assert.equal((await writerPage.request.get(settings)).status(),404);await q("update meeting_area_access set access_level='write' where area_id=$1 and user_id=$2",[area,writer]);assert.equal((await writerPage.request.get(settings)).status(),200);
   await ownerPage.goto(settings);await management.locator('summary').click();await management.getByRole('button',{name:'Verwaltungsrechte entziehen',exact:true}).click();await management.getByRole('status').filter({hasText:'Verwaltungsrechte entzogen.'}).waitFor();assert.equal((await writerPage.request.get(settings)).status(),404);
   await adminPage.goto(settings);assert.equal(await adminPage.getByRole('button',{name:'Sitzungsbereich löschen',exact:true,includeHidden:true}).count(),1);assert.equal(await adminPage.locator('summary').filter({hasText:/^Verwaltungsrechte vergeben$/}).count(),1);for(const context of contexts)await context.close();
  }
 }finally{
  if(browser)await browser.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));writeFileSync(join(output,'server.log'),log);
  const {purgeTestResource}=await import('../helpers/trash-cleanup.ts');for(const id of areas)await purgeTestResource('meeting_area',id);for(const id of users)await q('delete from users where id=$1',[id]);await(await import('../../lib/db/index.ts')).pool.end();await pool.end();await sso.close();console.log(`Browser artifacts: ${output}`);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
