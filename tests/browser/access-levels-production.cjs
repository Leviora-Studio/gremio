// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
// Real Next server, real sessions/actions and isolated PostgreSQL; no external services.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { Pool } = require('pg');
const { sealData } = require('iron-session');
const { PDFDocument } = require('pdf-lib');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const assert = require('node:assert/strict');

(async () => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/gremio_workflows_test_/);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const query = (sql, args = []) => pool.query(sql, args);
  const output = mkdtempSync(join(tmpdir(), 'gremio-access-production-'));
  const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const sso = await require('./synthetic-sso.cjs').startSyntheticSso();
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: process.env.GREMIO_TEST_BUILD_DIR || process.cwd(), env: { ...process.env, APP_BASE_URL: base, PUBLIC_BASE_URL: base, OIDC_ISSUER: sso.issuer, UPLOAD_DIR: join(output, 'uploads'), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
  const people = []; let boardId, fbId, inventoryId, systemId, groupId, browser;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 200)); }
    assert.ok(ready, log);
    const suffix = `access-browser-${randomUUID()}`;
    for (const role of ['owner', 'reader', 'writer']) people.push((await query('insert into users(username) values ($1) returning id', [`${suffix}-${role}`])).rows[0].id);
    for (const userId of people) await query('update users set sub=$1 where id=$2', ['synthetic:'+userId,userId]);
    const [ownerId, readerId, writerId] = people;
    boardId = (await query('insert into boards(name,owner_id) values ($1,$2) returning id', [suffix, ownerId])).rows[0].id;
    fbId = (await query('insert into finance_boards(name,owner_id) values ($1,$2) returning id', [suffix, ownerId])).rows[0].id;
    inventoryId = (await query('insert into inventory_boards(name,owner_id) values ($1,$2) returning id', [suffix, ownerId])).rows[0].id;
    groupId = (await query('insert into groups(name) values ($1) returning id', [suffix])).rows[0].id;
    await query('insert into user_groups(user_id,group_id) values ($1,$2)', [writerId, groupId]);
    for (const [table, column, id] of [['board_access','board_id',boardId],['finance_board_access','finance_board_id',fbId],['inventory_board_access','board_id',inventoryId]]) {
      await query(`insert into ${table}(${column},user_id,access_level) values ($1,$2,'read'),($1,$3,'read')`, [id,readerId,writerId]);
      await query(`insert into ${table}(${column},group_id,access_level) values ($1,$2,'write')`, [id,groupId]);
    }
    const status = (await query("insert into board_statuses(board_id,name) values ($1,'Eingegangen') returning id", [boardId])).rows[0].id;
    const officeTarget = (await query("insert into board_statuses(board_id,name,position) values ($1,'Angenommen',1) returning id", [boardId])).rows[0].id;
    await query("insert into board_statuses(board_id,name,position) values ($1,'Abgelehnt',2)", [boardId]);
    const cardToken = randomUUID();
    const cardId = (await query("insert into cards(board_id,status_id,title,applicant,token) values ($1,$2,'Testkarte','Test',$3) returning id", [boardId,status,cardToken])).rows[0].id;
    for (const key of ['number','applicant','deadline','meeting','other_pdfs']) await query('insert into board_card_fields(board_id,field_key,visible) values ($1,$2,true)', [boardId,key]);
    const itemId = (await query("insert into inventory_items(board_id,name) values ($1,'Testgegenstand') returning id", [inventoryId])).rows[0].id;
    systemId = (await query('insert into boards(name,owner_id,inventory_board_id) values ($1,$2,$3) returning id', [`${suffix}-loans`,ownerId,inventoryId])).rows[0].id;
    await query('update inventory_boards set loan_board_id=$1 where id=$2', [systemId,inventoryId]);
    const systemStatus = (await query("insert into board_statuses(board_id,name) values ($1,'Angefragt') returning id", [systemId])).rows[0].id;
    const systemCard = (await query("insert into cards(board_id,status_id,title,applicant,token) values ($1,$2,'Testausleihe','Test',$3) returning id", [systemId,systemStatus,randomUUID()])).rows[0].id;
    const loanToken = randomUUID();
    const loanId = (await query("insert into inventory_loans(item_id,borrower,status,token,card_id) values ($1,'Testperson','requested',$2,$3) returning id", [itemId,loanToken,systemCard])).rows[0].id;
    const pdf = await PDFDocument.create(); pdf.addPage();
    const bytes = await pdf.save(); const file = join('cards',String(cardId),'synthetic.pdf');
    mkdirSync(join(output,'uploads','cards',String(cardId)),{recursive:true}); writeFileSync(join(output,'uploads',file),bytes);
    const attId = (await query("insert into attachments(card_id,kind,filename,path,mime,size,uploaded_by) values ($1,'other','Synthetic.pdf',$2,'application/pdf',$3,$4) returning id", [cardId,file,bytes.length,ownerId])).rows[0].id;
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
    for (const width of [1400,390]) {
      for (const [kind,userId] of [['reader',readerId],['writer',writerId],['owner',ownerId]]) {
        const context = await browser.newContext({viewport:{width,height:1000}});
        await context.addCookies([{name:'gremio_session',value:await sealData(sso.session(userId),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);
        const page = await context.newPage(); const errors=[]; page.on('pageerror', error=>errors.push(error.message));
        const writable = kind !== 'reader';
        const boardResponse = await page.goto(`${base}/intern/board/${boardId}`); assert.equal(boardResponse.status(),200);
        assert.equal(await page.getByRole('button',{name:'+ Neue Karte',exact:true}).count()>0,writable);
        const views = page.getByRole('group',{name:'Board-Ansicht'});
        for (const view of ['Liste','Tabelle']) {
          await views.getByRole('button',{name:view,exact:true}).click();
          assert.equal(await page.getByRole('button',{name:'Status für Testkarte',exact:true}).count()>0,writable);
        }
        await page.goto(`${base}/intern/card/${cardId}`);
        assert.equal(await page.getByPlaceholder('Titel der Karte').isDisabled(),!writable);
        assert.equal(await page.getByRole('button',{name:'Ordner erstellen',exact:true}).count()>0,writable);
        assert.equal(await page.getByRole('button',{name:'Karte löschen',exact:true}).count()>0,writable);
        if (!writable) assert.equal((await page.content()).includes(cardToken),false);
        assert.equal((await page.request.get(`${base}/api/attachment/${attId}`)).status(),200);
        await page.screenshot({path:join(output,`${kind}-card-${width}.png`),fullPage:true});
        await page.goto(`${base}/finanzen/${fbId}`);
        assert.equal(await page.getByRole('link',{name:'Haushaltsplan bearbeiten',exact:true}).count()>0,writable);
        assert.equal((await page.request.get(`${base}/finanzen/${fbId}/plan`)).status(),writable?200:404);
        if (writable && width===1400) {
          await page.getByRole('link',{name:'Haushaltsplan bearbeiten',exact:true}).click();
          await page.getByRole('button',{name:'Ja, bearbeiten',exact:true}).click();
          await page.getByRole('button',{name:'+ Einnahme (Oberpunkt)',exact:true}).click();
          await page.locator('input[name=title]').first().waitFor();
        }
        await page.goto(`${base}/intern/inventar/${inventoryId}`);
        assert.equal(await page.getByRole('button',{name:'+ Neuer Gegenstand',exact:true}).count()>0,writable);
        await page.goto(`${base}/intern/inventar/item/${itemId}`);
        assert.equal(await page.getByRole('button',{name:'Bearbeiten',exact:true}).count()>0,writable);
        if (!writable) assert.equal((await page.content()).includes(loanToken),false);
        await page.goto(`${base}/intern/inventar/loan/${loanId}`);
        assert.equal(await page.getByRole('button',{name:'Vorgang löschen',exact:true}).count()>0,writable);
        if (!writable) assert.equal((await page.content()).includes(loanToken),false);
        await page.screenshot({path:join(output,`${kind}-loan-${width}.png`),fullPage:true});
        for (const settings of [`/intern/board/${boardId}/einstellungen`,`/finanzen/${fbId}/einstellungen`,`/intern/inventar/${inventoryId}/einstellungen`]) assert.equal((await page.request.get(base+settings)).status(),kind==='owner'?200:404);
        if (kind === 'owner') {
          for (const [settings,table,column,id] of [
            [`/intern/board/${boardId}/einstellungen`,'board_access','board_id',boardId],
            [`/finanzen/${fbId}/einstellungen`,'finance_board_access','finance_board_id',fbId],
            [`/intern/inventar/${inventoryId}/einstellungen`,'inventory_board_access','board_id',inventoryId],
          ]) {
            await page.goto(base+settings);
            await page.getByText('Freigaben',{exact:true}).click();
            const access = page.getByRole('button',{name:`Zugriff für ${suffix}-reader`,exact:true});
            await access.click();
            await page.getByRole('option',{name:'Lesend und schreibend',exact:true}).click();
            await page.locator('form').filter({has:access}).getByRole('button',{name:'Speichern',exact:true}).click();
            for(let i=0;i<50;i++) { if((await query(`select access_level from ${table} where ${column}=$1 and user_id=$2`,[id,readerId])).rows[0].access_level==='write') break; await new Promise(resolve=>setTimeout(resolve,100)); }
            assert.equal((await query(`select access_level from ${table} where ${column}=$1 and user_id=$2`,[id,readerId])).rows[0].access_level,'write');
            await query(`update ${table} set access_level='read' where ${column}=$1 and user_id=$2`,[id,readerId]);
          }
        }
        assert.deepEqual(errors,[]);
        await context.close();
      }
      const ownerContext = await browser.newContext({viewport:{width,height:1000}});
      await ownerContext.addCookies([{name:'gremio_session',value:await sealData(sso.session(ownerId),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto(`${base}/intern/board/${boardId}/einstellungen`);
      await ownerPage.locator('summary').filter({hasText:'Bürokraft aktivieren'}).click();
      await ownerPage.getByRole('checkbox',{name:'Bürokraft aktivieren',exact:true}).check();
      await ownerPage.getByRole('button',{name:'Bürokraft auswählen',exact:true}).click();
      await ownerPage.getByRole('option',{name:`${suffix}-reader`,exact:true}).click();
      await ownerPage.getByRole('group',{name:'Erlaubte Ausgangsspalten',exact:true}).getByRole('checkbox',{name:'Eingegangen',exact:true}).check();
      await ownerPage.getByRole('group',{name:'Erlaubte Zielspalten',exact:true}).getByRole('checkbox',{name:'Angenommen',exact:true}).check();
      await ownerPage.getByRole('button',{name:'Bürokraft-Einstellung speichern',exact:true}).click();
      await ownerPage.getByRole('status').filter({hasText:'Bürokraft-Einstellung gespeichert.'}).waitFor();
      const officeContext = await browser.newContext({viewport:{width,height:1000}});
      await officeContext.addCookies([{name:'gremio_session',value:await sealData(sso.session(readerId),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);
      const officePage = await officeContext.newPage();
      await officePage.goto(`${base}/intern/card/${cardId}`);
      assert.equal(await officePage.getByPlaceholder('Titel der Karte').isDisabled(),true);
      assert.equal(await officePage.getByRole('button',{name:'Ordner erstellen',exact:true}).count(),0);
      await officePage.goto(`${base}/intern/board/${boardId}`);
      await officePage.getByRole('group',{name:'Board-Ansicht'}).getByRole('button',{name:'Liste',exact:true}).click();
      await officePage.getByRole('button',{name:'Status für Testkarte',exact:true}).click();
      assert.equal(await officePage.getByRole('option',{name:'Abgelehnt',exact:true}).count(),0);
      await officePage.getByRole('option',{name:'Angenommen',exact:true}).click();
      for(let i=0;i<50;i++){if((await query('select status_id from cards where id=$1',[cardId])).rows[0].status_id===officeTarget)break;await new Promise(resolve=>setTimeout(resolve,100));}
      assert.equal((await query('select status_id from cards where id=$1',[cardId])).rows[0].status_id,officeTarget);
      await officePage.getByRole('button',{name:'Status für Testkarte',exact:true}).waitFor({state:'detached'});
      await officePage.screenshot({path:join(output,`office-${width}.png`),fullPage:true});
      await query('update board_office_roles set user_id=$1 where board_id=$2',[writerId,boardId]);
      const writerContext = await browser.newContext();
      await writerContext.addCookies([{name:'gremio_session',value:await sealData(sso.session(writerId),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);
      const writerPage = await writerContext.newPage();await writerPage.goto(`${base}/intern/card/${cardId}`);
      assert.equal(await writerPage.getByPlaceholder('Titel der Karte').isEnabled(),true,'group write wins over office restrictions');
      await writerContext.close();await officeContext.close();await ownerContext.close();
      await query('update board_office_roles set enabled=false,user_id=null where board_id=$1',[boardId]);
      await query('update cards set status_id=$1 where id=$2',[status,cardId]);
    }
  } finally {
    if(browser)await browser.close(); child.kill();
    await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
    writeFileSync(join(output,'server.log'),log);
    if(systemId)await query('delete from boards where id=$1',[systemId]);
    if(boardId)await query('delete from boards where id=$1',[boardId]);
    if(fbId)await query('delete from finance_boards where id=$1',[fbId]);
    if(inventoryId)await query('delete from inventory_boards where id=$1',[inventoryId]);
    if(groupId)await query('delete from groups where id=$1',[groupId]);
    for(const id of people)await query('delete from users where id=$1',[id]);
    await pool.end();await sso.close();console.log(`Browser artifacts: ${output}`);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
