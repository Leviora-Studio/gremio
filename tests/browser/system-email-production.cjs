// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
// Real settings/actions/public HTTP against an isolated local production server.
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
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/gremio_workflows_test_/);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const query = (sql, args = []) => pool.query(sql, args);
  const output = mkdtempSync(join(tmpdir(), 'gremio-email-browser-'));
  const reservation = createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const sso = await require('./synthetic-sso.cjs').startSyntheticSso();
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: process.env.GREMIO_TEST_BUILD_DIR || process.cwd(), env: { ...process.env, APP_BASE_URL: base, PUBLIC_BASE_URL: base, OIDC_ISSUER: sso.issuer, UPLOAD_DIR: join(output, 'uploads'), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
  let userId, boardId, inventoryId, systemId, browser;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 200)); }
    assert.ok(ready, log);
    userId = (await query("insert into users(username,role) values ($1,'admin') returning id", [randomUUID()])).rows[0].id;
    await query('update users set sub=$1 where id=$2', ['synthetic:'+userId, userId]);
    boardId = (await query("insert into boards(name,owner_id) values ('Email test board',$1) returning id", [userId])).rows[0].id;
    const statusId = (await query("insert into board_statuses(board_id,name) values ($1,'Incoming') returning id", [boardId])).rows[0].id;
    const areaId = (await query("insert into feedback_areas(name,enabled,target_board_id,target_status_id) values ('Email feedback',true,$1,$2) returning id", [boardId,statusId])).rows[0].id;
    await query("insert into locations(name,enabled,target_board_id,target_status_id) values ('Email location',true,$1,$2)", [boardId,statusId]);
    inventoryId = (await query("insert into inventory_boards(name,owner_id,is_public) values ('Email inventory',$1,true) returning id", [userId])).rows[0].id;
    systemId = (await query("insert into boards(name,owner_id,inventory_board_id) values ('Email loans',$1,$2) returning id", [userId,inventoryId])).rows[0].id;
    await query('update inventory_boards set loan_board_id=$1 where id=$2',[systemId,inventoryId]);
    await query("insert into board_statuses(board_id,name) values ($1,'Loans')",[systemId]);
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    const context = await browser.newContext({viewport:{width:1400,height:1000}});
    await context.addCookies([{name:'gremio_session',value:await sealData(sso.session(userId),{password:process.env.AUTH_SECRET}),url:base,httpOnly:true,sameSite:'Lax'}]);
    const page = await context.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    assert.equal((await page.goto(`${base}/admin/email`)).status(),200);
    await page.getByLabel('SMTP-Host',{exact:true}).fill('localhost');
    await page.getByLabel('Benutzername (optional)',{exact:true}).fill('synthetic-user');
    await page.getByLabel('SMTP-Passwort',{exact:true}).fill('synthetic-browser-password');
    await page.getByLabel('Absenderadresse',{exact:true}).fill('sender@example.invalid');
    await page.getByRole('button',{name:'SMTP speichern',exact:true}).click();
    await page.getByRole('status').filter({hasText:'SMTP-Einstellungen gespeichert.'}).waitFor();
    const saved=(await query('select * from smtp_settings')).rows[0];assert.equal(saved.enabled,false);assert.notEqual(saved.password_enc,'synthetic-browser-password');
    await page.reload();assert.equal(await page.getByLabel('SMTP-Passwort',{exact:true}).inputValue(),'');
    assert.equal((await page.content()).includes(saved.password_enc),false);
    for (const label of ['Email test board','Email inventory']) assert.ok(await page.getByText(label,{exact:true}).count());
    const confirmationCheckbox=page.getByLabel('Email test board',{exact:true}).first();
    await confirmationCheckbox.check();
    await page.locator('form').filter({has:confirmationCheckbox}).first().getByRole('button',{name:'Speichern',exact:true}).click();
    for(let i=0;i<30;i++) { if((await query("select enabled from email_confirmation_settings where board_id=$1 and kind='application'",[boardId])).rows[0]?.enabled)break; await new Promise(resolve=>setTimeout(resolve,100)); }
    assert.equal((await query("select enabled from email_confirmation_settings where board_id=$1 and kind='application'",[boardId])).rows[0].enabled,true);
    await page.screenshot({path:join(output,'smtp-desktop.png'),fullPage:true});
    for (const width of [1400,390]) {
      await page.setViewportSize({width,height:1000});
      for(const url of [`/admin/email`,`/intern/board/${boardId}/einstellungen`,`/intern/inventar/${inventoryId}/einstellungen`]) {
        await page.goto(base+url);
        if(!url.startsWith('/admin')) await page.getByText('Email-Settings',{exact:true}).click();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),url+' must fit viewport');
      }
      await page.screenshot({path:join(output,`inventory-settings-${width}.png`),fullPage:true});
    }
    await page.goto(`${base}/intern/board/${boardId}/einstellungen`);
    await page.getByText('Email-Settings',{exact:true}).click();
    await page.getByLabel('E-Mail beim Erreichen dieser Spalte versenden',{exact:true}).check();
    await page.getByLabel('Empfangsadressen',{exact:true}).fill('one@example.invalid; two@example.invalid');
    await page.getByRole('button',{name:'E-Mail-Regel speichern',exact:true}).click();
    await page.getByRole('status').filter({hasText:'E-Mail-Regel gespeichert.'}).waitFor();
    assert.equal((await query('select recipients from board_email_rules where status_id=$1',[statusId])).rows[0].recipients.length,2);
    await page.goto(`${base}/admin/standorte`);
    const locationCard=page.locator('.card').filter({has:page.getByRole('button',{name:'Email location',exact:true})});
    // Legacy routes with disabled fields get a named warning instead of silent repair.
    const locationWarning=page.getByRole('alert').filter({hasText:'E-Mail-Adresse'});await locationWarning.waitFor();
    assert.ok((await locationWarning.textContent()).includes('Studierendenausweis'));
    await page.goto(`${base}/intern/board/${boardId}/einstellungen`);await page.getByText('Kartenfelder',{exact:true}).click();
    const fieldPanel=page.locator('details').filter({has:page.getByRole('button',{name:'Kartenfelder speichern',exact:true})});
    assert.equal(await fieldPanel.getByRole('checkbox',{name:/^E-Mail-Adresse/}).isDisabled(),true);
    assert.equal(await fieldPanel.getByRole('checkbox',{name:/^Anlage A/}).isDisabled(),false);
    await fieldPanel.getByRole('button',{name:'Alle auswählen',exact:true}).click();await fieldPanel.getByRole('button',{name:'Kartenfelder speichern',exact:true}).click();await fieldPanel.getByText('Kartenfelder gespeichert.',{exact:true}).waitFor();
    await page.goto(`${base}/admin/standorte`);assert.equal(await page.getByRole('alert').filter({hasText:'E-Mail-Adresse'}).count(),0);
    const publicPage = await browser.newPage();
    for(const url of ['/', '/feedback']) {
      await publicPage.goto(base+url);
      assert.equal(await publicPage.locator('input[name=email]').getAttribute('required'),url==='/'?'':null);
    }
    const submit = payload => fetch(base+'/api/public/v1/feedback',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(payload)});
    assert.equal((await submit({areaId,feedback:'Test'})).status,201);
    assert.equal((await submit({areaId,feedback:'Test',email:'bad'})).status,400);
    const response=await submit({areaId,feedback:'Test',email:'person@example.invalid'});assert.equal(response.status,201);
    const result=await response.json();assert.equal(JSON.stringify(result).includes('person@example.invalid'),false);
    assert.equal((await query('select * from email_outbox')).rowCount,0,'SMTP remains off; no external emails');
    assert.deepEqual(errors,[]);console.log('SMTP UI, encrypted credentials, board/inventory settings, desktop/mobile and required application / optional survey email verified. Screenshots: '+output);
  } finally {
    if(browser)await browser.close();child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
    await query('delete from smtp_settings');await query('delete from email_outbox');
    if(boardId){await query('delete from locations where target_board_id=$1',[boardId]);await query('delete from feedback_areas where target_board_id=$1',[boardId]);await query('delete from boards where id=$1',[boardId]);}
    if(inventoryId){await query('update inventory_boards set loan_board_id=null where id=$1',[inventoryId]);if(systemId)await query('delete from boards where id=$1',[systemId]);await query('delete from inventory_boards where id=$1',[inventoryId]);}
    if(userId)await query('delete from users where id=$1',[userId]);await pool.end();await sso.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
