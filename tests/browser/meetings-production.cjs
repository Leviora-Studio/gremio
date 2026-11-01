// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {Pool}=require('pg');const {sealData}=require('iron-session');const {PDFDocument}=require('pdf-lib');
const {randomUUID}=require('node:crypto');const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join}=require('node:path');const {spawn}=require('node:child_process');const {createServer}=require('node:net');const assert=require('node:assert/strict');
async function assertMenuReachable(page) {
  const menu=page.getByRole('listbox');await menu.waitFor();
  const last=menu.getByRole('option').last();await last.scrollIntoViewIfNeeded();
  assert.ok(await last.evaluate(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}), 'last menu option must be visible and clickable');
}
(async()=>{
  assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/gremio_workflows_test_/);
  const pool=new Pool({connectionString:process.env.DATABASE_URL});const query=(sql,args=[])=>pool.query(sql,args);
  const output=mkdtempSync(join(tmpdir(),'gremio-meetings-browser-'));
  const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));const base=`http://127.0.0.1:${port}`;
  const sso=await require("./synthetic-sso.cjs").startSyntheticSso();
  const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port),'-H','127.0.0.1'],{cwd:process.env.GREMIO_TEST_BUILD_DIR||process.cwd(),env:{...process.env,APP_BASE_URL:base,PUBLIC_BASE_URL:base,OIDC_ISSUER:sso.issuer,UPLOAD_DIR:join(output,'uploads'),NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
  const people=[];let browser,meetingId,boardId,backlogId,areaId,proposalId;
  try {
    let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,log);
    const suffix=randomUUID().slice(0,8);
    for(const kind of ['owner','reader','writer','board-only'])people.push((await query('insert into users(username) values ($1) returning id',[`meetings-${kind}-${suffix}`])).rows[0].id);
    for(const userId of people)await query('update users set sub=$1 where id=$2',['synthetic:'+userId,userId]);
    const [owner,reader,writer,boardOnly]=people;
    boardId=(await query("insert into boards(name,owner_id) values ('SECRET BOARD',$1) returning id",[owner])).rows[0].id;
    const status=(await query("insert into board_statuses(board_id,name) values ($1,'Incoming') returning id",[boardId])).rows[0].id;
    const cardId=(await query("insert into cards(board_id,status_id,title,applicant,token) values ($1,$2,'SECRET CARD TITLE','SECRET APPLICANT',$3) returning id",[boardId,status,randomUUID()])).rows[0].id;
    await query("insert into board_access(board_id,user_id,access_level) values ($1,$2,'read')",[boardId,boardOnly]);
    await query("insert into board_card_fields(board_id,field_key,visible) values ($1,'other_pdfs',true)",[boardId]);
    const pdf=await PDFDocument.create();pdf.addPage();const bytes=Buffer.from(await pdf.save());const rel=`meeting-test/${suffix}/source.pdf`;
    mkdirSync(join(output,'uploads',`meeting-test/${suffix}`),{recursive:true});writeFileSync(join(output,'uploads',rel),bytes);
    const attachmentId=(await query("insert into attachments(card_id,kind,filename,path,mime,size) values ($1,'other','Shared fixture.pdf',$2,'application/pdf',$3) returning id",[cardId,rel,bytes.length])).rows[0].id;
    browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
    const context=await browser.newContext({viewport:{width:1400,height:1000}});
    await context.addCookies([{name:'gremio_session',value:await sealData(sso.session(owner),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error at '+page.url()+': '+e.stack);});
    await page.goto(base+'/intern/sitzungen');await page.getByText('+ Neuer Sitzungsbereich',{exact:true}).click();
    await page.getByLabel('Bezeichnung',{exact:true}).fill(`Test committee ${suffix}`);
    await page.getByRole('button',{name:'Bereich anlegen',exact:true}).click();await page.waitForURL(/\/intern\/sitzungen\/bereich\/\d+$/);
    areaId=Number(page.url().split('/').at(-1));
    const longUser=(await query('insert into users(username) values ($1) returning id',['SitzungsteilnehmendePersonMitLangemAnzeigenamen'.repeat(2)+suffix])).rows[0].id;
    people.push(longUser);await query("insert into meeting_area_access(area_id,user_id,access_level) values ($1,$2,'read')",[areaId,longUser]);
    await page.getByRole('link',{name:'Bereichseinstellungen',exact:true}).click();
    await page.getByRole('button',{name:'Nutzer freigeben',exact:true}).click();await page.getByRole('option',{name:`meetings-reader-${suffix}`,exact:true}).click();
    await page.getByRole('button',{name:'+',exact:true}).first().click();await page.getByRole('status').filter({hasText:'Freigabe gespeichert.'}).waitFor();
    await page.goto(`${base}/intern/sitzungen/bereich/${areaId}`);await page.getByText('+ Neue Sitzung',{exact:true}).click();
    await page.getByLabel('Titel',{exact:true}).fill(`Browser meeting ${suffix}`);
    assert.equal(await page.locator('input[name=committee]').count(),0);
    await page.getByRole('button',{name:'Beginn (Europe/Berlin): Datum',exact:true}).click();
    const calendar=page.getByRole('dialog',{name:'Beginn (Europe/Berlin): Datum: Kalender',exact:true});
    for(let i=0;i<12;i++){if(await calendar.getByText('November 2026',{exact:true}).count())break;await calendar.getByRole('button',{name:'Nächster Monat',exact:true}).click();}
    await calendar.getByRole('button',{name:'10',exact:true}).click();
    await page.getByRole('button',{name:'Sitzung anlegen',exact:true}).click();await page.waitForURL(/\/intern\/sitzungen\/\d+$/);
    meetingId=Number(page.url().split('/').at(-1));
    assert.equal((await query('select starts_at from meetings where id=$1',[meetingId])).rows[0].starts_at.toISOString(),'2026-11-10T17:00:00.000Z');
    await query("insert into meeting_area_access(area_id,user_id,access_level) values ($1,$2,'write')",[areaId,writer]);
    await page.getByRole('button',{name:'+ TOP anlegen',exact:true}).click();
    await page.getByLabel('TOP-Titel',{exact:true}).fill('Shared agenda topic');
    await page.getByLabel('Beschreibung',{exact:true}).fill('Explicitly shared agenda content.');
    await page.getByRole('button',{name:'TOP-Status',exact:true}).click();await page.getByRole('option',{name:'Eingeplant',exact:true}).click();
    await page.getByRole('button',{name:'TOP anlegen',exact:true}).click();await page.waitForURL(/\/intern\/sitzungen\/top\/\d+$/);
    const topicId=Number(page.url().split('/').at(-1));
    await page.getByText('Kartenverknüpfungen', {exact:false}).first().click();
    await page.getByLabel('Karten-ID',{exact:false}).fill(String(cardId));await page.getByRole('button',{name:'Karte verknüpfen',exact:true}).click();
    await page.getByRole('link',{name:'SECRET CARD TITLE',exact:true}).waitFor();
    await page.getByText('Dateikopie aus einer verknüpften Karte freigeben',{exact:true}).click();
    await page.getByRole('button',{name:'Quelldatei',exact:true}).click();await page.getByRole('option',{name:'SECRET CARD TITLE: Shared fixture.pdf',exact:true}).click();
    await page.getByLabel('Diese Kopie dürfen alle zum TOP berechtigten Sitzungsteilnehmer lesen. Der Board-Zugriff begrenzt die Kopie anschließend nicht mehr.',{exact:true}).check();
    await page.getByRole('button',{name:'Eigenständige Kopie freigeben',exact:true}).click();
    await page.getByRole('button',{name:/Shared fixture\.pdf/}).waitFor();
    const document=(await query('select * from meeting_documents where topic_id=$1',[topicId])).rows[0];
    assert.notEqual(document.path,rel);assert.equal(document.size,bytes.length);
    await page.getByText('+ Eigene Unterlage hochladen',{exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Datei auswählen',exact:true}).count(),1);
    await page.locator('input[type=file][name=file]').setInputFiles({name:'Additional.pdf',mimeType:'application/pdf',buffer:bytes});
    await page.getByRole('button',{name:'Andere Datei',exact:true}).waitFor();
    await page.getByLabel('Ich gebe diese Datei für alle zum TOP berechtigten Sitzungsteilnehmer frei.',{exact:true}).check();
    await page.getByRole('button',{name:'Unterlage freigeben',exact:true}).click();
    await page.getByRole('button',{name:/Additional\.pdf/}).waitFor();
    await page.getByRole('button',{name:/Additional\.pdf/}).click();
    await page.locator('.react-pdf__Page canvas').first().waitFor({timeout:30000});
    await page.getByRole('button',{name:'Schließen',exact:true}).click();
    const imageRel=`meeting-test/${suffix}/image.png`;
    const imageBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=','base64');
    writeFileSync(join(output,'uploads',imageRel),imageBytes);
    await query("insert into meeting_documents(topic_id,filename,path,mime,size) values ($1,'Image.png',$2,'image/png',$3) returning id",[topicId,imageRel,imageBytes.length]);
    await page.reload();
    const imageLink=page.getByRole('link',{name:'Image.png',exact:true});assert.notEqual(await imageLink.getAttribute('download'),null);
    const downloadEvent=page.waitForEvent('download');await imageLink.click();assert.equal((await downloadEvent).suggestedFilename(),'Image.png');
    assert.equal(await page.locator('.react-pdf__Page canvas').count(),0);

    for(const url of [`/api/meeting-document/${document.id}`,`/api/meetings/${meetingId}/pdf`])assert.equal((await fetch(base+url,{headers:{Authorization:'Bearer synthetic-unaccepted-token'}})).status,401);
    const privateTopic=(await query("insert into meeting_topics(meeting_id,created_by,title,description,confidential,state,position) values ($1,$2,'SECRET PRIVATE TOP','SECRET PRIVATE BODY',true,'scheduled',1) returning id",[meetingId,owner])).rows[0].id;
    await query("insert into meeting_topics(meeting_id,created_by,title,state,position) values ($1,$2,'Second shared topic','scheduled',2)",[meetingId,owner]);
    for(const width of [1400,768,390,320]){
      await page.setViewportSize({width,height:width===320?640:1000});
      await page.goto(`${base}/intern/sitzungen/bereich/${areaId}/einstellungen`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'area sharing must fit viewport');
      assert.ok((await page.locator('[title^=SitzungsteilnehmendePerson]').boundingBox()).width>=21,'long names must not squeeze the avatar');
      await page.getByRole('button',{name:/^Zugriff für SitzungsteilnehmendePerson/}).click();await assertMenuReachable(page);await page.keyboard.press('Escape');
      await page.screenshot({path:join(output,`area-settings-${width}.png`),fullPage:true});
      await page.goto(`${base}/intern/sitzungen/${meetingId}`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'meeting page must fit viewport');
      await page.getByRole('button',{name:/^Status für /}).last().click();await assertMenuReachable(page);await page.screenshot({path:join(output,`last-status-${width}.png`)});await page.keyboard.press('Escape');
      await page.screenshot({path:join(output,`meeting-${width}.png`),fullPage:true});
      await page.goto(`${base}/intern/sitzungen/top/${topicId}`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'topic must fit viewport');
      await page.screenshot({path:join(output,`topic-${width}.png`),fullPage:true});
      await page.goto(`${base}/intern/sitzungen/${meetingId}/einstellungen`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'settings must fit viewport');
    }
    for(const [kind,userId] of [['reader',reader],['writer',writer],['board-only',boardOnly]]){
      const ctx=await browser.newContext({viewport:{width:1400,height:1000}});await ctx.addCookies([{name:'gremio_session',value:await sealData(sso.session(userId),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);const p=await ctx.newPage();
      const response=await p.goto(`${base}/intern/sitzungen/${meetingId}`);
      if(kind==='board-only'){assert.equal(response.status(),404);assert.equal((await ctx.request.get(`${base}/api/meeting-document/${document.id}`)).status(),404);}
      else {
        assert.equal(response.status(),200);assert.equal((await p.content()).includes('SECRET PRIVATE TOP'),false);
        for(const width of [1400,390]){await p.setViewportSize({width,height:1000});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(width===390)assert.ok((await p.locator('h1').boundingBox()).width>250,'meeting title must keep mobile width');await p.screenshot({path:join(output,`workspace-${kind}-${width}.png`),fullPage:true});}
        await p.setViewportSize({width:1400,height:1000});await p.getByRole('tab',{name:/Vorschläge/}).click();await p.screenshot({path:join(output,`proposals-${kind}.png`),fullPage:true});
        assert.equal(await p.getByRole('button',{name:'Status für Reader proposal',exact:true}).count()>0,kind==='writer'&&!!proposalId);
        if(kind==='writer'&&proposalId){await p.getByRole('button',{name:'Status für Reader proposal',exact:true}).first().click();await p.getByRole('option',{name:'Einplanen: öffentlich',exact:true}).click();await p.waitForTimeout(500);assert.equal((await query('select state from meeting_topics where id=$1',[proposalId])).rows[0].state,'scheduled');await p.getByRole('tab',{name:/Tagesordnung/}).click();await p.getByRole('link',{name:/Reader proposal/}).waitFor();}
        await p.goto(`${base}/intern/sitzungen/top/${topicId}`);const html=await p.content();for(const secret of ['SECRET CARD TITLE','SECRET BOARD','SECRET APPLICANT'])assert.equal(html.includes(secret),false,secret+' must not leak through RSC');
        assert.equal((await p.getByRole('button',{name:/Shared fixture\.pdf/}).count()),1);
        const file=await ctx.request.get(`${base}/api/meeting-document/${document.id}`);assert.equal(file.status(),200);assert.equal(file.headers()['cache-control'],'private, no-store');assert.deepEqual(await file.body(),bytes);
        assert.equal((await ctx.request.get(`${base}/api/attachment/${attachmentId}`)).status(),403,'session copy grants no source attachment access');
        assert.equal((await ctx.request.get(`${base}/intern/sitzungen/top/${privateTopic}`)).status(),404);
        assert.equal((await ctx.request.get(`${base}/intern/sitzungen/${meetingId}/einstellungen`)).status(),kind==='writer'?200:404);
        assert.equal((await ctx.request.get(`${base}/intern/sitzungen/bereich/${areaId}/einstellungen`)).status(),404);
        assert.equal(await p.getByRole('button',{name:'TOP bearbeiten',exact:true}).count()>0,kind==='writer');
        assert.equal((await ctx.request.get(`${base}/api/meetings/${meetingId}/pdf`)).status(),404);assert.equal(await p.getByRole('link',{name:'Tagesordnung als PDF',exact:true}).count(),0);
        if(kind==='reader') {
          await p.goto(`${base}/intern/sitzungen/${meetingId}`);await p.getByRole('button',{name:'+ TOP vorschlagen',exact:true}).click();await p.screenshot({path:join(output,'reader-proposal-dialog.png'),fullPage:true});
          assert.equal(await p.getByRole('button',{name:'Einplanen als',exact:true}).count(),0,'readers propose main TOPs only');
          assert.equal(await p.getByRole('button',{name:'Tagesordnungsbereich',exact:true}).count(),0,'readers do not choose a section');
          await p.getByLabel('TOP-Titel',{exact:true}).fill('Reader proposal');await p.getByRole('button',{name:'Vorschlag einreichen',exact:true}).click();
          await p.waitForURL(/\/intern\/sitzungen\/top\/\d+$/);proposalId=Number(p.url().split('/').at(-1));
          assert.equal((await query('select parent_id from meeting_topics where id=$1',[proposalId])).rows[0].parent_id,null);
        }
        await query('delete from meeting_area_access where area_id=$1 and user_id=$2',[areaId,userId]);
        assert.equal((await ctx.request.get(`${base}/api/meeting-document/${document.id}`)).status(),404);
        assert.equal((await ctx.request.get(`${base}/api/meetings/${meetingId}/pdf`)).status(),404);
      }
      await ctx.close();
    }
    await query("update meeting_topics set state='proposed' where id=$1",[proposalId]);
    await page.setViewportSize({width:1400,height:1100});await page.goto(`${base}/intern/sitzungen/${meetingId}`);const handle=page.getByRole('button',{name:'TOP 1 verschieben',exact:true});
    await page.waitForTimeout(500);await handle.focus();await page.keyboard.press('Space');await page.waitForTimeout(150);await page.keyboard.press('ArrowDown');await page.waitForTimeout(200);await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    for(let i=0;i<30;i++){const rows=(await query("select id from meeting_topics where meeting_id=$1 and state='scheduled' order by position,id",[meetingId])).rows;if(rows[0].id!==topicId)break;await new Promise(r=>setTimeout(r,100));}
    assert.notEqual((await query("select id from meeting_topics where meeting_id=$1 and state='scheduled' order by position,id limit 1",[meetingId])).rows[0].id,topicId,'keyboard drag-and-drop persists order');
    await page.reload();await page.waitForTimeout(500);
    const beforePointer=(await query("select id from meeting_topics where meeting_id=$1 and state='scheduled' order by position,id",[meetingId])).rows.map(row=>row.id);
    const from=await page.getByRole('button',{name:'TOP 3 verschieben',exact:true}).boundingBox();
    const to=await page.getByRole('button',{name:'TOP 1 verschieben',exact:true}).boundingBox();
    assert.ok(from&&to);await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
    await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:20});await page.waitForTimeout(150);await page.mouse.up();
    for(let i=0;i<30;i++){if((await query("select id from meeting_topics where meeting_id=$1 and state='scheduled' order by position,id limit 1",[meetingId])).rows[0].id===beforePointer[2])break;await new Promise(r=>setTimeout(r,100));}
    assert.equal((await query("select id from meeting_topics where meeting_id=$1 and state='scheduled' order by position,id limit 1",[meetingId])).rows[0].id,beforePointer[2],'pointer drag-and-drop persists order');
    await page.goto(`${base}/intern/sitzungen/top/${proposalId}`);
    await page.getByRole('button',{name:'TOP bearbeiten',exact:true}).click();
    await page.getByRole('button',{name:'Einplanen als',exact:true}).click();await page.getByRole('option',{name:'Unter-TOP von: Shared agenda topic',exact:true}).click();
    await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.getByRole('status').filter({hasText:'TOP gespeichert.'}).waitFor();
    assert.equal((await query('select parent_id,state from meeting_topics where id=$1',[proposalId])).rows[0].parent_id,topicId);
    await page.goto(`${base}/intern/sitzungen/top/${topicId}`);await page.getByText('+ Unter-TOP anlegen',{exact:true}).click();
    const childForm=page.locator('form').filter({has:page.getByRole('button',{name:'Unter-TOP anlegen',exact:true})});
    await childForm.getByLabel('TOP-Titel',{exact:true}).fill('Planned subtopic');
    await childForm.getByRole('button',{name:'Unter-TOP anlegen',exact:true}).click();await page.waitForURL(url=>url.pathname!==`/intern/sitzungen/top/${topicId}`&&/\/intern\/sitzungen\/top\/\d+$/.test(url.pathname));
    const childId=Number(page.url().split('/').at(-1));
    await page.goto(`${base}/intern/sitzungen/${meetingId}`);
    let mainLabel=await page.getByRole('link',{name:/^TOP \d+: Shared agenda topic$/}).textContent();let mainNumber=mainLabel.match(/^TOP (\d+):/)[1];
    await page.getByRole('link',{name:`TOP ${mainNumber}.1: Reader proposal`,exact:true}).waitFor();
    await page.getByRole('link',{name:`TOP ${mainNumber}.2: Planned subtopic`,exact:true}).waitFor();
    await page.waitForTimeout(500);await page.getByRole('button',{name:`TOP ${mainNumber}.1 verschieben`,exact:true}).focus();
    await page.keyboard.press('Space');await page.waitForTimeout(150);await page.keyboard.press('ArrowDown');await page.waitForTimeout(200);await page.keyboard.press('Space');
    for(let i=0;i<30;i++){if((await query('select id from meeting_topics where parent_id=$1 order by position,id',[topicId])).rows[0].id===childId)break;await new Promise(r=>setTimeout(r,100));}
    assert.equal((await query('select id from meeting_topics where parent_id=$1 order by position,id',[topicId])).rows[0].id,childId);
    for(const direction of ['ArrowUp','ArrowDown']){
      await page.reload();await page.waitForTimeout(500);
      const label=await page.getByRole('link',{name:/^TOP \d+: Shared agenda topic$/}).textContent();const number=Number(label.match(/^TOP (\d+):/)[1]);
      await page.getByRole('button',{name:`TOP ${number} verschieben`,exact:true}).focus();await page.keyboard.press('Space');await page.waitForTimeout(150);await page.keyboard.press(direction);await page.waitForTimeout(200);await page.keyboard.press('Space');
      const expected=number+(direction==='ArrowUp'?-1:1);
      await page.getByRole('link',{name:`TOP ${expected}: Shared agenda topic`,exact:true}).waitFor();
      await page.getByRole('link',{name:`TOP ${expected}.1: Planned subtopic`,exact:true}).waitFor();
    }
    for(const width of [1400,390]){await page.setViewportSize({width,height:1000});await page.goto(`${base}/intern/sitzungen/${meetingId}`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(output,`subtopics-${width}.png`),fullPage:true});}
    // The planner chooses the section; confidentiality and reader access stay independent.
    await page.setViewportSize({width:1400,height:1100});
    await page.getByRole('button',{name:'Status für Shared agenda topic',exact:true}).click();
    await page.getByRole('option',{name:'Einplanen: nicht öffentlich',exact:true}).click();
    await page.getByRole('link',{name:'TOP I: Shared agenda topic',exact:true}).waitFor();
    await page.getByRole('link',{name:'TOP I.1: Planned subtopic',exact:true}).waitFor();
    assert.equal((await query('select section,confidential from meeting_topics where id=$1',[topicId])).rows[0].section,'non_public');
    assert.equal((await query('select section,confidential from meeting_topics where id=$1',[topicId])).rows[0].confidential,false);
    await page.getByRole('button',{name:'Status für Second shared topic',exact:true}).click();
    await page.getByRole('option',{name:'Einplanen: nicht öffentlich',exact:true}).click();
    const privateSection=page.getByRole('region',{name:'Nicht öffentlicher Teil',exact:true});
    await privateSection.getByRole('link',{name:/Second shared topic/}).waitFor();
    // Keyboard sorting moves the full nonpublic root group.
    const beforeNonpublic=(await query("select id from meeting_topics where meeting_id=$1 and parent_id is null and section='non_public' order by position,id",[meetingId])).rows.map(row=>row.id);
    await page.waitForTimeout(500);await privateSection.getByRole('button',{name:'TOP I verschieben',exact:true}).focus();
    await page.keyboard.press('Space');await page.waitForTimeout(150);await page.keyboard.press('ArrowDown');await page.waitForTimeout(200);await page.keyboard.press('Space');
    for(let i=0;i<30;i++){if((await query("select id from meeting_topics where meeting_id=$1 and parent_id is null and section='non_public' order by position,id limit 1",[meetingId])).rows[0].id!==beforeNonpublic[0])break;await new Promise(r=>setTimeout(r,100));}
    assert.notEqual((await query("select id from meeting_topics where meeting_id=$1 and parent_id is null and section='non_public' order by position,id limit 1",[meetingId])).rows[0].id,beforeNonpublic[0]);
    await page.goto(`${base}/intern/sitzungen/bereich/${areaId}/einstellungen`);
    const agendaSettings=page.locator('form').filter({has:page.getByRole('button',{name:'Reihenfolge der Bereiche',exact:true})});
    for(const [name,option] of [['Nummerierung öffentlicher Teil','Römisch (I, II, III)'],['Nummerierung nicht öffentlicher Teil','Arabisch (1, 2, 3)'],['Reihenfolge der Bereiche','Nicht öffentlich vor öffentlich']]){
      await agendaSettings.getByRole('button',{name,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();
    }
    await agendaSettings.getByRole('button',{name:'Speichern',exact:true}).click();await page.getByRole('status').filter({hasText:'Tagesordnungseinstellungen gespeichert.'}).waitFor();
    await page.goto(`${base}/intern/sitzungen/${meetingId}`);
    const regions=page.getByRole('region').filter({has:page.locator('h3')});
    assert.equal(await regions.first().getAttribute('aria-label'),'Begrüßung und Regularien');assert.equal(await regions.nth(1).getAttribute('aria-label'),'Nicht öffentlicher Teil');
    await page.getByRole('region',{name:'Nicht öffentlicher Teil',exact:true}).getByRole('button',{name:'TOP 1 verschieben',exact:true}).waitFor();
    await page.getByRole('button',{name:'Status für Shared agenda topic',exact:true}).click();await page.getByRole('option',{name:'Vertagt',exact:true}).click();
    await page.getByRole('tab',{name:/Vertagt/}).click();await page.getByRole('link',{name:'Shared agenda topic',exact:true}).waitFor();
    await page.getByRole('button',{name:'Status für Shared agenda topic',exact:true}).click();await page.getByRole('option',{name:'Einplanen: nicht öffentlich',exact:true}).click();
    await page.getByRole('tab',{name:/Tagesordnung/}).click();await privateSection.getByRole('link',{name:/Shared agenda topic/}).waitFor();
    for(const width of [1400,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(output,`agenda-sections-${width}.png`),fullPage:true});}
    await query("insert into meeting_area_access(area_id,user_id,access_level) values ($1,$2,'read')",[areaId,reader]);
    const readerCtx=await browser.newContext();await readerCtx.addCookies([{name:'gremio_session',value:await sealData(sso.session(reader),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);
    const readerPage=await readerCtx.newPage();await readerPage.goto(`${base}/intern/sitzungen/${meetingId}`);
    await readerPage.getByRole('region',{name:'Nicht öffentlicher Teil',exact:true}).getByRole('link',{name:/Shared agenda topic/}).waitFor();
    assert.equal(await readerPage.getByText('SECRET PRIVATE TOP',{exact:true}).count(),0);await readerCtx.close();
    assert.deepEqual(errors,[]);console.log('Real area sharing, shared calendar, meeting creation, agenda, linking, explicit file copies, revocation, privacy, PDF viewer, non-PDF downloads, keyboard sorting and desktop/mobile verified. Screenshots: '+output);
  } catch(error) {
    if(browser){const p=browser.contexts().at(-1)?.pages().at(-1);if(p)await p.screenshot({path:join(output,'failure.png'),fullPage:true});console.log('Failure screenshot: '+output);}
    throw error;
  } finally {
    if(browser)await browser.close();child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await sso.close();
    if(meetingId)await query('delete from meetings where id=$1',[meetingId]);if(backlogId)await query('delete from meeting_topics where id=$1',[backlogId]);if(areaId)await query('delete from meeting_areas where id=$1',[areaId]);if(boardId)await query('delete from boards where id=$1',[boardId]);for(const userId of people)await query('delete from users where id=$1',[userId]);await pool.end();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
