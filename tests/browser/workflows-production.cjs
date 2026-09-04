// Real Next production server + isolated database. No OIDC/Nextcloud calls.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { Pool } = require('pg');
const { sealData } = require('iron-session');
const { randomUUID } = require('node:crypto');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const assert = require('node:assert/strict');
(async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname, /^\/gremio_workflows_test_/, 'use isolated workflow test DB only');
  const pool = new Pool({ connectionString: url.toString() });
  const output = mkdtempSync(join(tmpdir(), 'gremio-workflows-production-'));
  const reservation = createServer(); await new Promise(resolve => reservation.listen(0,'127.0.0.1',resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'),'start','-p',String(port),'-H','127.0.0.1'], { env: { ...process.env, APP_BASE_URL: base, PUBLIC_BASE_URL: base, UPLOAD_DIR: join(output,'uploads'), NODE_ENV:'production' }, stdio:['ignore','pipe','pipe'] });
  let log=''; child.stdout.on('data',data=>{log+=data.toString();}); child.stderr.on('data',data=>{log+=data.toString();});
  let browser, ownerId, boardId; const accountIds=[];
  const query = (sql,args=[])=>pool.query(sql,args);
  try {
    let ready=false;
    for(let i=0;i<100;i++) { try { if((await fetch(base+'/api/health')).ok) {ready=true;break;} } catch {} await new Promise(resolve=>setTimeout(resolve,200)); }
    assert.ok(ready,'production server should start');
    const suffix=`browser-${randomUUID()}`;
    ownerId=(await query("insert into users(username,role) values ($1,'admin') returning id",[suffix])).rows[0].id;
    const accs=(await query("insert into accounts(name) values ($1),($2) returning id",[suffix+'-A',suffix+'-B'])).rows; accountIds.push(...accs.map(a=>a.id));
    boardId=(await query("insert into boards(name,owner_id,default_account_id) values ($1,$2,$3) returning id",[suffix,ownerId,accs[1].id])).rows[0].id;
    const statuses=(await query("insert into board_statuses(board_id,name,is_receipt_trigger,position) values ($1,'Quittungen offen',true,0),($1,'Eingereicht',false,1) returning id",[boardId])).rows;
    await query('update boards set resubmit_status_id=$1,receipt_to_status_id=$2 where id=$3',[statuses[0].id,statuses[1].id,boardId]);
    for(const key of ['budget_title','account','requested_amount','approved_amount','actual_amount','other_pdfs']) await query('insert into board_card_fields(board_id,field_key,visible) values ($1,$2,true)',[boardId,key]);
    const token=randomUUID().replaceAll('-','').slice(0,30);
    const card=(await query("insert into cards(board_id,status_id,title,applicant,token,number,budget_title,account_id,requested_amount,approved_amount,actual_amount) values ($1,$2,'Browser-Antrag','Test',$3,'TEST_1','12345',$4,20000,15000,13000) returning id",[boardId,statuses[0].id,token,accs[0].id])).rows[0];
    browser=await chromium.launch({ executablePath:process.env.CHROME_PATH || undefined,headless:true });
    const page=await browser.newPage({viewport:{width:1400,height:1000}});
    await page.context().addCookies([{name:'gremio_session',value:await sealData({userId:ownerId},{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);
    await page.goto(`${base}/intern/card/${card.id}`);
    await page.getByRole('button',{name:'Weiteren Haushaltstitel hinzufügen',exact:true}).click();
    const first=page.getByRole('group',{name:'Position 1',exact:true}), second=page.getByRole('group',{name:'Position 2',exact:true});
    await first.getByLabel('Bezeichnung',{exact:true}).fill('Gegenstand A');
    await second.getByLabel('Haushaltstitel',{exact:true}).fill('12344');
    await second.getByLabel('Bezeichnung',{exact:true}).fill('Gegenstand B');
    await second.getByLabel('Beantragter Betrag (€)',{exact:true}).fill('200');
    await second.getByLabel('Genehmigter Betrag (€)',{exact:true}).fill('200');
    await second.getByLabel('Tatsächliche Ausgaben (€)',{exact:true}).fill('180');
    for(let i=0;i<40;i++){const c=(await query('select approved_amount from cards where id=$1',[card.id])).rows[0];if(c.approved_amount===35000)break;await new Promise(resolve=>setTimeout(resolve,150));}
    const stored=(await query('select * from cards where id=$1',[card.id])).rows[0]; assert.equal(stored.approved_amount,35000); assert.equal(stored.actual_amount,31000);
    assert.equal((await query('select * from card_budget_positions where card_id=$1',[card.id])).rowCount,2);
    await page.screenshot({path:join(output,'card-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'real card editor must not overflow on mobile');
    await page.screenshot({path:join(output,'card-mobile.png'),fullPage:true});
    const publicPage=await browser.newPage({viewport:{width:390,height:1000}});
    await publicPage.goto(`${base}/status/${token}`); await publicPage.getByText('350,00 €',{exact:true}).waitFor();
    const statusApi = (statusUrl=`${base}/status/${token}`) => fetch(base+'/api/public/v1/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({statusUrl})});
    const overlapping = await statusApi();
    assert.equal(overlapping.status,200);
    assert.equal(overlapping.headers.get('cache-control'),'no-store');
    assert.equal(overlapping.headers.get('referrer-policy'),'no-referrer');
    const overlap = await overlapping.json();
    assert.deepEqual(overlap.availableActions,{canResubmit:true,canReceipt:true,canUploadDocuments:true,submitMode:'resubmission'});
    assert.equal(overlap.application.approvedAmountCents,35000);
    assert.equal((await statusApi(`https://foreign.invalid/status/${token}`)).status,400);
    assert.equal((await statusApi(`${base}/feedback/status/${token}`)).status,404);
    for(const endpoint of ['locations','feedback-areas']) {
      const catalog=await fetch(`${base}/api/public/v1/${endpoint}`);
      assert.equal(catalog.status,200); assert.match(catalog.headers.get('content-type'),/application\/json/);
    }
    assert.equal(await publicPage.getByText('Genehmigter Betrag',{exact:true}).count(),1);
    const inputs=publicPage.locator('input[type=file]'); assert.equal(await inputs.count(),3,'general, resubmission and receipt coexist');
    const pdf=name=>({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nlocal test fixture')});
    await inputs.nth(0).setInputFiles([pdf('Original.pdf'),pdf('Nachtrag.pdf')]);
    await publicPage.getByText('Hinzugefügt: Nachtrag.pdf',{exact:true}).waitFor();
    await inputs.nth(2).setInputFiles([pdf('one.pdf'),pdf('two.pdf'),pdf('three.pdf')]);
    assert.equal(await publicPage.getByRole('button',{name:'Quittung einreichen',exact:true}).isDisabled(),true);
    await publicPage.getByText('Hinzugefügt: TEST_1_Q3.pdf',{exact:true}).waitFor();
    const files=(await query('select filename,upload_purpose from attachments where card_id=$1 order by id',[card.id])).rows;
    assert.deepEqual(files.map(f=>f.filename),['Original.pdf','Nachtrag.pdf','TEST_1_Q1.pdf','TEST_1_Q2.pdf','TEST_1_Q3.pdf']);
    assert.equal((await query('select status_id from cards where id=$1',[card.id])).rows[0].status_id,statuses[0].id);
    await publicPage.screenshot({path:join(output,'public-mobile.png'),fullPage:true});
    await publicPage.getByRole('button',{name:'Quittung einreichen',exact:true}).click();
    await publicPage.getByText('Eingereicht. Vielen Dank!',{exact:true}).waitFor();
    assert.equal((await query('select status_id from cards where id=$1',[card.id])).rows[0].status_id,statuses[1].id);
    // The public API adds only the total, not account/position data.
    const response=await statusApi();
    assert.equal(response.status,200,'public status API should accept the generated test status link');
    const json=await response.json(); assert.equal(json.application.approvedAmountCents,35000); assert.equal(JSON.stringify(json).includes('accountId'),false); assert.equal(JSON.stringify(json).includes('budgetPositions'),false);
    assert.deepEqual(json.availableActions,{canResubmit:false,canReceipt:false,canUploadDocuments:true,submitMode:null});
    assert.equal(json.documents.length,5,'all public workflow attachments appear in the existing status contract');
    assert.equal(json.documents.filter(d=>d.filename.startsWith('TEST_1_Q')).length,3);
    await query('update board_statuses set is_archive_trigger=true,is_receipt_trigger=true where id=$1',[statuses[1].id]);
    const archived=await (await statusApi()).json();
    assert.equal(archived.status.archived,true);
    assert.deepEqual(archived.availableActions,{canResubmit:false,canReceipt:false,canUploadDocuments:false,submitMode:null});
    console.log(`Real production workflow smoke passed: ${output}`);
  } finally {
    if(browser)await browser.close(); child.kill('SIGTERM');
    await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
    if(boardId)await query('delete from boards where id=$1',[boardId]);
    if(accountIds.length)await query('delete from accounts where id=any($1::int[])',[accountIds]);
    if(ownerId)await query('delete from users where id=$1',[ownerId]);
    await pool.end();
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
