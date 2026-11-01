// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
// Run with node --import tsx; see README for isolated environment requirements.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {Pool}=require('pg');const {sealData}=require('iron-session');
const {randomUUID}=require('node:crypto');const {mkdtempSync,readFileSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join}=require('node:path');const {spawn}=require('node:child_process');const {createServer}=require('node:net');const assert=require('node:assert/strict');
const {unzipOffice,zip}=require('../../lib/zip.ts');const {wordTemplateFixture}=require('../word-template-fixture.ts');const {extractPdfText}=require('../../lib/pdf-text.ts');
(async()=>{
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/gremio_workflows_test_/);
 const pool=new Pool({connectionString:process.env.DATABASE_URL}),query=(sql,args=[])=>pool.query(sql,args),output=mkdtempSync(join(tmpdir(),'gremio-word-browser-'));
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));const base=`http://127.0.0.1:${port}`;
 const sso=await require('./synthetic-sso.cjs').startSyntheticSso();
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port),'-H','127.0.0.1'],{cwd:process.env.GREMIO_TEST_BUILD_DIR||process.cwd(),env:{...process.env,APP_BASE_URL:base,PUBLIC_BASE_URL:base,OIDC_ISSUER:sso.issuer,UPLOAD_DIR:join(output,'uploads'),NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
 let log='',browser,areaId,meetingId;server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);const people=[];
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,log);
  for(const role of ['owner','writer','reader','admin']){const user=(await query('insert into users(username,role) values ($1,$2) returning id',[`word-${role}-${randomUUID()}`,role==='admin'?'admin':'user'])).rows[0].id;people.push(user);await query('update users set sub=$1 where id=$2',['synthetic:'+user,user]);}
  const [owner,writer,reader,admin]=people;
  areaId=(await query("insert into meeting_areas(name,owner_id) values ('Official export area',$1) returning id",[owner])).rows[0].id;
  meetingId=(await query("insert into meetings(area_id,owner_id,title,starts_at,location,chair) values ($1,$2,'Official meeting','2026-11-10T17:00:00Z','Room 1','Chair') returning id",[areaId,owner])).rows[0].id;
  await query("insert into meeting_area_access(area_id,user_id,access_level) values ($1,$2,'write'),($1,$3,'read')",[areaId,writer,reader]);
  await query("insert into meeting_topics(meeting_id,created_by,title,description,state,position,confidential,section) values ($1,$2,'Public agenda','Public body','scheduled',0,false,'public'),($1,$2,'CONFIDENTIAL AGENDA','CONFIDENTIAL BODY','scheduled',1,true,'non_public')",[meetingId,owner]);
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
  const ctx=await browser.newContext({viewport:{width:1400,height:1100}});await ctx.addCookies([{name:'gremio_session',value:await sealData(sso.session(owner),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/intern/sitzungen/${meetingId}`);assert.equal(await page.getByRole('link',{name:'Tagesordnung als Word',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'Tagesordnung als PDF',exact:true}).count(),1);
  await page.goto(`${base}/intern/sitzungen/bereich/${areaId}/einstellungen`);
  const active=zip(unzipOffice(wordTemplateFixture()).map(file=>file.name==='word/document.xml'?{...file,data:Buffer.from(file.data.toString('utf8').replace('</w:body>','<w:p><w:fldSimple w:instr="DDEAUTO server topic item"/></w:p></w:body>'))}:file));
  await page.locator('input[name=template]').setInputFiles({name:'Unsafe.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:active});
  await page.getByRole('button',{name:'Wordvorlage hochladen',exact:true}).click();await page.getByRole('alert').filter({hasText:'aktive Inhalte'}).waitFor();
  assert.equal((await query('select word_template_revision from meeting_areas where id=$1',[areaId])).rows[0].word_template_revision,0,'rejected active content is never stored');
  const fixture=process.env.GREMIO_WORD_TEMPLATE_FIXTURE,bytes=fixture?readFileSync(fixture):wordTemplateFixture();
  await page.locator('input[name=template]').setInputFiles({name:'Official.dotx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.template',buffer:bytes});
  await page.getByRole('button',{name:'Wordvorlage hochladen',exact:true}).click();await page.getByRole('status').filter({hasText:'Wordvorlage gespeichert.'}).waitFor();
  for(const label of ['Öffentlicher TOP 1. Ordnung','Öffentlicher TOP 2. Ordnung','Nicht öffentlicher TOP 1. Ordnung','Nicht öffentlicher TOP 2. Ordnung'])assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),1);
  await page.getByRole('button',{name:'Öffentlicher TOP 1. Ordnung',exact:true}).click();await page.getByRole('option',{name:fixture?'TOP 1':'TOP1',exact:true}).click();
  await page.getByRole('button',{name:'Wordexport-Einstellungen speichern',exact:true}).click();await page.getByRole('status').filter({hasText:'Wordexport-Einstellungen gespeichert.'}).waitFor();
  const stored=(await query('select word_configuration from meeting_areas where id=$1',[areaId])).rows[0].word_configuration;assert.equal(stored.styles.publicTopic,'TOP1');if(fixture)assert.equal(stored.insertion,'replace');
  const original=await ctx.request.get(`${base}/api/meeting-areas/${areaId}/word-template`);assert.equal(original.status(),200);assert.deepEqual(await original.body(),bytes);
  for(const width of [1400,390]){
   await page.setViewportSize({width,height:1100});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.getByRole('button',{name:'Öffentlicher TOP 1. Ordnung',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(output,`word-settings-${width}.png`)});
   await page.getByRole('button',{name:'Wordexport-Einstellungen speichern',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(output,`word-insertion-${width}.png`)});
  }
  for(const [kind,userId] of [['owner',owner],['admin',admin],['writer',writer],['reader',reader]]){
   const userCtx=await browser.newContext();await userCtx.addCookies([{name:'gremio_session',value:await sealData(sso.session(userId),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);const p=await userCtx.newPage();await p.goto(`${base}/intern/sitzungen/${meetingId}`);
   const allowed=['owner','admin'].includes(kind);
   for(const format of ['PDF','Word'])assert.equal(await p.getByRole('link',{name:`Tagesordnung als ${format}`,exact:true}).count(),allowed?1:0);
   const word=await userCtx.request.get(`${base}/api/meetings/${meetingId}/word`),pdf=await userCtx.request.get(`${base}/api/meetings/${meetingId}/pdf`),template=await userCtx.request.get(`${base}/api/meeting-areas/${areaId}/word-template`);
   for(const response of [word,pdf,template]){assert.equal(response.status(),allowed?200:404,kind+' export status');assert.equal(response.headers()['cache-control'],'private, no-store');assert.equal(response.headers()['referrer-policy'],'no-referrer');}
   if(allowed){
    assert.match(word.headers()['content-type'],/wordprocessingml.document/);assert.match(word.headers()['content-disposition'],/\.docx/);
    const file=await word.body(),parts=unzipOffice(file),document=parts.find(f=>f.name==='word/document.xml').data.toString('utf8');assert.match(document,/CONFIDENTIAL AGENDA/);assert.match(document,/CONFIDENTIAL BODY/);assert.match(document,/w:pStyle w:val="NTOP1"/);assert.doesNotMatch(document,/Titel des Tagesordnungspunkts/);
    for(const part of unzipOffice(bytes))if(!['word/document.xml','word/numbering.xml','word/settings.xml','[Content_Types].xml','word/_rels/document.xml.rels'].includes(part.name))assert.deepEqual(parts.find(p=>p.name===part.name).data,part.data,part.name);
    const extracted=await extractPdfText(await pdf.body());assert.match(extracted.text,/CONFIDENTIAL AGENDA/);assert.match(extracted.text,/CONFIDENTIAL BODY/);
    if(kind==='owner'){writeFileSync(join(output,'official-agenda.docx'),file);writeFileSync(join(output,'agenda.pdf'),await pdf.body());}
   }
   await userCtx.close();
  }
  for(const url of [`/api/meetings/${meetingId}/word`,`/api/meetings/${meetingId}/pdf`,`/api/meeting-areas/${areaId}/word-template`,`/api/meeting-document/1`]){const response=await fetch(base+url,{headers:{Authorization:'Bearer rejected-synthetic-token'}});assert.equal(response.status,401);assert.equal(response.headers.get('referrer-policy'),'no-referrer');}
  await page.getByRole('button',{name:'Wordvorlage entfernen',exact:true}).click();await page.getByRole('button',{name:'Wordvorlage hochladen',exact:true}).waitFor();
  await page.goto(`${base}/intern/sitzungen/${meetingId}`);assert.equal(await page.getByRole('link',{name:'Tagesordnung als Word',exact:true}).count(),0);assert.equal((await ctx.request.get(`${base}/api/meetings/${meetingId}/pdf`)).status(),200);
  assert.deepEqual(errors,[]);console.log('PASS active template rejection, template upload, style mapping, original download, owner/admin-only Word/PDF, confidential contents, package preservation, no bearer access, removal and 1400/390px layouts. Artifacts: '+output);
 }catch(error){const p=browser?.contexts().at(-1)?.pages().at(-1);if(p)await p.screenshot({path:join(output,'failure.png'),fullPage:true});console.error(log.slice(-3000));throw error;}
 finally{await browser?.close();server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await sso.close();if(meetingId)await query('delete from meetings where id=$1',[meetingId]);if(areaId)await query('delete from meeting_areas where id=$1',[areaId]);for(const id of people)await query('delete from users where id=$1',[id]);await pool.end();}
})().catch(error=>{console.error(error);process.exitCode=1;});
