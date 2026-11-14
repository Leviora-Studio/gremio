// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
// Run with node --import tsx, isolated DATABASE_URL, temporary UPLOAD_DIR and a separate production build.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { Pool } = require('pg');
const { sealData } = require('iron-session');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const forge = require('node-forge');
const {inflateRawSync}=require('node:zlib');
function exportZip(buffer){const entries=new Map();let offset=0;while(offset+30<=buffer.length&&buffer.readUInt32LE(offset)===0x04034b50){const length=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),start=offset+30+nameLength+buffer.readUInt16LE(offset+28);entries.set(buffer.subarray(offset+30,offset+30+nameLength).toString(),inflateRawSync(buffer.subarray(start,start+length)).toString());offset=start+length;}return entries;}

(async () => {
    assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/gremio_workflows_test_/);
    assert.ok(process.env.GREMIO_TEST_BUILD_DIR, 'separate build required');
    const output = mkdtempSync(join(tmpdir(), 'gremio-cashbook-browser-'));
    process.env.UPLOAD_DIR = join(output, 'uploads');
    mkdirSync(process.env.UPLOAD_DIR);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const query = (sql, args = []) => pool.query(sql, args);
    const { encryptCert } = require('../../lib/cert');
    const service = require('../../lib/cashbook/service');
    const { db, pool: appPool } = require('../../lib/db');
    const schema = require('../../lib/db/schema');
    const { defaultCashbookConfig } = require('../../lib/cashbook-types');
    const keys = forge.pki.rsa.generateKeyPair(2048), cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 60000);
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    cert.setSubject([{ name: 'commonName', value: 'Synthetic cashbook browser signer' }]);
    cert.setIssuer(cert.subject.attributes);
    cert.sign(keys.privateKey);
    const credentials = encryptCert(Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'test-only', { algorithm: '3des' })).getBytes(), 'binary'), 'test-only');
    const users = await db.insert(schema.users).values(['owner', 'second', 'office', 'reader', 'outsider', 'alternate'].map(role => ({ username: `cashbook-ui-${role}-${randomUUID()}`, role: role === 'owner' ? 'admin' : 'user', certP12Enc: credentials.p12Enc, certPassEnc: credentials.passEnc }))).returning();
    const [owner, second, office, reader, outsider, alternate] = users;
    for (const user of users)
        await query('update users set sub=$1 where id=$2', ['synthetic:' + user.id, user.id]);
    const board = (await query("insert into boards(name,owner_id,is_application_board,legacy_finance_fields) values ('UI applications',$1,true,true) returning id", [owner.id])).rows[0];
    const statuses = (await query("insert into board_statuses(board_id,name,is_lock_column) values ($1,'Incoming',false),($1,'Accepted',true) returning id", [board.id])).rows;
    for (const field of ['number', 'applicant', 'finance_request', 'requested_amount', 'approved_amount', 'budget_title', 'account', 'other_pdfs'])
        await query('insert into board_card_fields(board_id,field_key,visible) values ($1,$2,true)', [board.id, field]);
    const token = randomUUID().replaceAll('-', '').slice(0, 30);
    const card = (await query("insert into cards(board_id,status_id,title,applicant,token,number) values ($1,$2,'Browser application','Synthetic applicant',$3,'AN-UI') returning id", [board.id, statuses[0].id, token])).rows[0];
    const account=(await query("insert into accounts(name) values ($1) returning id,name",['Browser standard '+board.id])).rows[0];
    const otherAccount=(await query("insert into accounts(name) values ($1) returning id,name",['Browser alternate '+board.id])).rows[0];
    await query('update boards set default_account_id=$1 where id=$2',[account.id,board.id]);
    const doc = await PDFDocument.create();
    doc.addPage();
    const pdf = Buffer.from(await doc.save());
    writeFileSync(join(process.env.UPLOAD_DIR, 'receipt.pdf'), pdf);
    await query("insert into attachments(card_id,kind,filename,path,mime,size) values ($1,'finance_request','Application.pdf','receipt.pdf','application/pdf',$2)",[card.id,pdf.length]);
    await query("insert into attachments(card_id,kind,upload_purpose,filename,path,mime,size) values ($1,'other','receipt','AN-UI_Q1.pdf','receipt.pdf','application/pdf',$2)", [card.id, pdf.length]);
    const template = await PDFDocument.create(), page = template.addPage(), mapping = {};
    for (const [i, key] of ['amount', 'holder', 'iban', 'bank', 'purpose', 'speakerPlaceDate', 'financePlaceDate'].entries()) {
        mapping[key] = key;
        template.getForm().createTextField(key).addToPage(page, { x: 30, y: 730 - i * 45, width: 480, height: 30 });
    }
    writeFileSync(join(process.env.UPLOAD_DIR, 'template.pdf'), await template.save());
    const sso = await require('./synthetic-sso.cjs').startSyntheticSso();
    const reservation = createServer();
    await new Promise(r => reservation.listen(0, '127.0.0.1', r));
    const port = reservation.address().port;
    await new Promise(r => reservation.close(r));
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: process.env.GREMIO_TEST_BUILD_DIR, env: { ...process.env, APP_BASE_URL: base, PUBLIC_BASE_URL: base, OIDC_ISSUER: sso.issuer, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', b => log += b);
    child.stderr.on('data', b => log += b);
    let browser;
    async function session(user, width = 1400) { const context = await browser.newContext({ viewport: { width, height: 1000 } }); await context.addCookies([{ name: 'gremio_session', value: await sealData(sso.session(user.id), { password: process.env.AUTH_SECRET }), url: base, httpOnly: true, sameSite: 'Lax' }]); return context.newPage(); }
    async function waitDb(sql, args, predicate) { for (let i = 0; i < 80; i++) {
        const rows = (await query(sql, args)).rows;
        if (predicate(rows))
            return rows;
        await new Promise(r => setTimeout(r, 100));
    } throw new Error('database transition timed out: ' + sql); }
    try {
        for (let i = 0; i < 100; i++) {
            try {
                if ((await fetch(base + '/api/health')).ok)
                    break;
            }
            catch { }
            await new Promise(r => setTimeout(r, 200));
            if (i === 99)
                throw new Error(log);
        }
        browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
        const ownerPage = await session(owner), otherPage = await session(outsider);
        await otherPage.goto(base + '/intern');
        assert.equal(await otherPage.getByRole('link', { name: 'Kassenbuch', exact: true }).count(), 0);
        await ownerPage.goto(base + '/intern/kassenbuch');
        await ownerPage.getByLabel('Name', { exact: true }).fill('Browser cashbook');
        await ownerPage.getByRole('button', { name: 'Kassenbuch erstellen', exact: true }).click();
        await ownerPage.waitForURL(/\/kassenbuch\/\d+\/einstellungen/);
        const bookId = Number(ownerPage.url().match(/kassenbuch\/(\d+)/)[1]);
        await service.saveCashbookGrant(owner, bookId, 'user', second.id, 'write');
        await service.saveCashbookGrant(owner, bookId, 'user', alternate.id, 'write');
        await service.saveCashbookGrant(owner, bookId, 'user', reader.id, 'read');
        await service.saveCashbookConfig(owner, bookId, 0, { ...defaultCashbookConfig, speakerId: owner.id, financeId: second.id, officeId: office.id, sourceBoardIds: [board.id], templatePath: 'template.pdf', mapping });
        await ownerPage.reload();
        await ownerPage.getByLabel('Text und Variablen', { exact: false }).fill('{{purpose}} {{number}} HT{{budgetTitle}}');
        await ownerPage.getByLabel("Kürzel der Buchungsnummer",{exact:true}).fill("KÖT");
        await ownerPage.getByLabel("Stellen der Buchungsnummer",{exact:true}).fill("4");
        await ownerPage.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
        await waitDb('select revision from cashbooks where id=$1', [bookId], rows => rows[0].revision === 2);
        await query('update cards set status_id=$1 where id=$2', [statuses[1].id, card.id]);
        await ownerPage.goto(`${base}/intern/card/${card.id}`);
        await ownerPage.getByText('Sperrbestätigung ausstehend', { exact: true }).waitFor();
        await ownerPage.getByRole('button',{name:'Haushaltstitel einplanen',exact:true}).click();
        await ownerPage.getByLabel('Betrag Zeile 1',{exact:true}).fill('150');
        await ownerPage.getByLabel('Haushaltstitel Zeile 1',{exact:true}).fill('1200');
        assert.match(await ownerPage.getByRole('button',{name:'Konto Zeile 1',exact:true}).innerText(),new RegExp(account.name));
        await ownerPage.getByRole('button',{name:'Einplanung speichern',exact:true}).click();
        await waitDb('select revision from card_budget_plans where card_id=$1',[card.id],rows=>rows[0]?.revision===1);

        let publicData = await (await fetch(base + '/api/public/v1/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusUrl: base + '/status/' + token }) })).json();
        assert.equal(publicData.status.name, 'Incoming');
        await ownerPage.getByRole('button', { name: 'Karte endgültig sperren', exact: true }).click();
        await ownerPage.getByRole('button', { name: 'Endgültig sperren', exact: true }).click();
        await waitDb('select locked_at from cards where id=$1', [card.id], rows => !!rows[0].locked_at);
        await ownerPage.reload();
        assert.equal(await ownerPage.getByRole('button', { name: 'Karte endgültig sperren', exact: true }).count(), 0);
        await ownerPage.getByRole('button',{name:'Korrektureintrag anlegen',exact:true}).click();
        await ownerPage.getByRole('dialog',{name:'Korrektureintrag anlegen',exact:true}).getByRole('button',{name:'Korrektur vorbereiten',exact:true}).click();
        const correctionEditor=ownerPage.getByRole('dialog',{name:'Einplanung korrigieren',exact:true});
        await correctionEditor.waitFor();
        await ownerPage.screenshot({path:join(output,'application-correction-desktop.png'),fullPage:false});
        await ownerPage.setViewportSize({width:390,height:1000});
        assert.ok(await ownerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await ownerPage.screenshot({path:join(output,'application-correction-mobile.png'),fullPage:false});
        await ownerPage.setViewportSize({width:1400,height:1000});
        await ownerPage.getByLabel('Betrag Zeile 1',{exact:true}).fill('140');
        await ownerPage.getByRole('button',{name:'Konto Zeile 1',exact:true}).click();
        await ownerPage.getByRole('option',{name:otherAccount.name,exact:true}).click();
        await ownerPage.getByRole('dialog',{name:'Konto ändern',exact:true}).getByRole('button',{name:'Konto wechseln',exact:true}).click();
        await ownerPage.getByLabel('Haushaltstitel Zeile 1',{exact:true}).fill('1300');
        await ownerPage.getByLabel('Begründung (Pflichtfeld)',{exact:true}).fill('Correct approved allocation and account');
        await ownerPage.getByRole('button',{name:'Korrektureintrag prüfen',exact:true}).click();
        const allocationReview=ownerPage.getByRole('dialog',{name:'Korrektureintrag verbindlich bestätigen',exact:true});
        assert.equal(await allocationReview.getByRole('button',{name:'Korrektureintrag anlegen',exact:true}).isDisabled(),true);
        await allocationReview.getByLabel('Zur Bestätigung BESTÄTIGEN eingeben',{exact:false}).fill('BESTÄTIGEN');
        await ownerPage.screenshot({path:join(output,'frozen-plan-correction-review.png'),fullPage:true});
        await allocationReview.getByRole('button',{name:'Korrektureintrag anlegen',exact:true}).click();
        await waitDb('select revision from card_budget_plans where card_id=$1',[card.id],rows=>rows[0]?.revision===2);
        assert.equal((await query('select count(*) from card_budget_plan_corrections where card_id=$1',[card.id])).rows[0].count,'1');
        assert.equal((await query('select title from cards where id=$1',[card.id])).rows[0].title,'Browser application');

        await ownerPage.reload();
        const history=ownerPage.locator('section').filter({has:ownerPage.getByRole('heading',{name:'Aktivitätsverlauf',exact:true})});
        const correctionActivity=history.getByRole('listitem').filter({has:ownerPage.getByRole('heading',{name:'Einplanung korrigiert',exact:true})});
        await correctionActivity.getByText('Correct approved allocation and account',{exact:true}).waitFor();
        assert.equal(await correctionActivity.locator('details[open]').count(),0);
        await correctionActivity.locator('summary').click();
        await correctionActivity.getByRole('heading',{name:'Vorher',exact:true}).waitFor();
        await correctionActivity.getByRole('heading',{name:'Nachher',exact:true}).waitFor();
        await history.screenshot({path:join(output,'application-activity-desktop.png')});
        await ownerPage.setViewportSize({width:390,height:1000});
        assert.ok(await ownerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await history.screenshot({path:join(output,'application-activity-mobile.png')});
        await ownerPage.setViewportSize({width:1400,height:1000});

        const generated = require('../../lib/api-token').generateApiToken();
        await db.insert(schema.apiTokens).values({ userId: owner.id, name: 'Synthetic HTTP audit', scope: 'write', tokenHash: generated.hash, prefix: generated.prefix });
        const bearerHeaders = { authorization: `Bearer ${generated.token}`, 'content-type': 'application/json' };
        const apiCard = `${base}/api/v1/cards/${card.id}`;
        assert.equal((await fetch(apiCard, { headers: bearerHeaders })).status, 200);
        assert.equal((await fetch(apiCard, { method: 'PATCH', headers: bearerHeaders, body: JSON.stringify({ title: 'Forbidden HTTP mutation' }) })).status, 409);
        assert.equal((await fetch(apiCard, { method: 'DELETE', headers: bearerHeaders })).status, 409);
        publicData = await (await fetch(base + '/api/public/v1/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusUrl: base + '/status/' + token }) })).json();
        assert.equal(publicData.status.name, 'Accepted');
        assert.equal(publicData.availableActions.canUploadDocuments, false);
        assert.equal(publicData.availableActions.canResubmit, false);
        assert.equal(publicData.availableActions.canReceipt, true);
        const receipts = ownerPage.locator('section').filter({ has: ownerPage.getByRole('heading', { name: 'Quittungen', exact: true }) });
        await receipts.locator('input[type=file]').setInputFiles({ name: 'uploaded.pdf', mimeType: 'application/pdf', buffer: pdf });
        await receipts.getByRole('button', { name: 'Neue Quittung hinzufügen', exact: true }).click();
        await receipts.getByText('Quittung hinzugefügt.', { exact: true }).waitFor();
        await receipts.getByText('AN-UI_Q2.pdf', { exact: false }).waitFor();
        await ownerPage.goto(`${base}/intern/kassenbuch/${bookId}/neu`);
        await ownerPage.getByRole('button', { name: 'Bitte Antrag auswählen', exact: true }).click();
        await ownerPage.getByRole('option', { name: 'AN-UI · Browser application', exact: true }).click();
        await ownerPage.getByText('2 verfügbar · 0 ausgewählt',{exact:true}).waitFor();
        await ownerPage.getByRole('button', { name: 'AN-UI_Q1.pdf ansehen', exact: true }).click();
        await ownerPage.locator('.react-pdf__Page canvas').first().waitFor({ timeout: 30000 });
        assert.equal(await ownerPage.getByRole('button', { name: '✎ Text', exact: true }).count(), 0, 'receipt preview is read-only');
        assert.equal(await ownerPage.getByRole('button', { name: '✒ Signieren', exact: true }).count(), 0, 'receipt preview cannot sign source files');
        await ownerPage.getByRole('button', { name: 'Schließen', exact: true }).click();
        assert.equal(await ownerPage.getByLabel('AN-UI_Q1.pdf', { exact: true }).isChecked(), false, 'preview does not select the receipt');
        await ownerPage.getByText('2 verfügbar · 0 ausgewählt',{exact:true}).waitFor();
        await ownerPage.getByLabel('AN-UI_Q1.pdf', { exact: true }).check();
        await ownerPage.getByText('2 verfügbar · 1 ausgewählt',{exact:true}).waitFor();
        for (const [label, value] of [['Betrag', '125,50'], ['Haushaltstitel', '1200'], ['Kontoinhaber', 'Synthetic holder'], ['IBAN', 'DE89370400440532013000'], ['Bank', 'Synthetic bank'], ['Verwendungszweck (optional)', 'Materials']])
            await ownerPage.getByLabel(label, { exact: true }).fill(value);
        assert.equal(await ownerPage.getByLabel('Ort',{exact:true}).count(),0);
        await ownerPage.getByRole('button', { name: 'Anweisungsformular erstellen', exact: true }).click();
        await ownerPage.waitForURL(/\/kassenbuch\/vorgang\/\d+/);
        const entryId = Number(ownerPage.url().split('/').at(-1));
        assert.equal((await query('select data from cashbook_entries where id=$1',[entryId])).rows[0].data.place,'');
        // A valid unrestricted owner API token still cannot fetch cashbook files/ZIPs.
        for (const suffix of ['file', 'zip']) assert.equal((await fetch(`${base}/api/cashbook/${entryId}/${suffix}`, { headers: bearerHeaders })).status, 403);
        assert.equal((await otherPage.request.get(`${base}/api/cashbook/${entryId}/file`)).status(), 403);
        assert.equal((await ownerPage.request.get(`${base}/api/cashbook/${entryId}/file`)).status(), 200);
        await ownerPage.getByRole('button', { name: 'Signieren', exact:true }).waitFor();
        async function sign(page) { if(!(await page.getByLabel('Ort der Unterschrift',{exact:true}).inputValue())) await page.getByLabel('Ort der Unterschrift',{exact:true}).fill(page===ownerPage?'Köthen':'Berlin'); await page.getByRole('button',{name:'Signieren',exact:true}).click(); await page.locator('.react-pdf__Page canvas').first().waitFor({ timeout: 30000 }); assert.equal(await page.getByRole('button', { name: '✎ Text', exact: true }).count(), 0, 'sign-only viewer has no text editing'); await page.getByRole('button', { name: '✒ Signieren', exact: true }).click(); const area = await page.locator('.react-pdf__Page').first().boundingBox(); await page.mouse.move(area.x + area.width * .1, area.y + area.height * .35); await page.mouse.down(); await page.mouse.move(area.x + area.width * .4, area.y + area.height * .43, { steps: 8 }); await page.mouse.up(); await page.getByRole('button', { name: 'Speichern', exact: true }).click(); await waitDb('select first_signed_at,second_signed_at from cashbook_entries where id=$1', [entryId], rows => page === ownerPage ? !!rows[0].first_signed_at : !!rows[0].second_signed_at); await page.locator('.react-pdf__Page canvas').first().waitFor({ state: 'detached', timeout: 30000 }); }
        await sign(ownerPage);
        await ownerPage.reload();
        await ownerPage.getByRole('button', { name: 'Zur Unterschrift vorlegen', exact: true }).click();
        assert.equal(await ownerPage.getByRole('button',{name:'Zweite unterschreibende Person',exact:true}).isDisabled(),true);
        await ownerPage.getByRole('button',{name:'Anderer Person zuweisen',exact:true}).click();
        await ownerPage.getByRole('button',{name:'Zweite unterschreibende Person',exact:true}).click();
        await ownerPage.getByRole('option',{name:alternate.username,exact:true}).click();
        await ownerPage.getByRole('button', { name: 'Verbindlich vorlegen', exact: true }).click();
        await waitDb('select state from cashbook_entries where id=$1', [entryId], rows => rows[0].state === 'submitted');
        const secondPage = await session(alternate);
        await secondPage.goto(`${base}/intern/kassenbuch/vorgang/${entryId}`);
        assert.equal(await secondPage.getByRole('button', { name: 'Entwurf speichern', exact: true }).count(), 0);
        assert.equal((await query('select second_signer_id from cashbook_entries where id=$1',[entryId])).rows[0].second_signer_id,alternate.id);
        assert.equal(await secondPage.getByRole('button',{name:/Formular ansehen und unterschreiben/}).count(),0);
        await secondPage.getByLabel('Ort der Unterschrift',{exact:true}).fill('Berlin');
        await secondPage.getByRole('button',{name:'Datum der Unterschrift',exact:true}).click();
        await secondPage.getByRole('dialog',{name:'Datum der Unterschrift: Kalender',exact:true}).getByRole('button',{name:'1',exact:true}).click();
        await sign(secondPage);
        const preparedPdf=await secondPage.request.get(`${base}/api/cashbook/${entryId}/file`);
        const preparedText=await require('../../lib/pdf-text').extractPdfText(await preparedPdf.body());
        assert.match(preparedText.text,/Berlin, 01\./);
        await secondPage.screenshot({path:join(output,'second-signature-details.png'),fullPage:true});
        await secondPage.reload();
        await secondPage.getByRole('button', { name: 'Anweisung erteilen', exact: true }).click();
        await secondPage.getByRole('dialog').getByRole('button', { name: 'Anweisung erteilen', exact: true }).click();
        await waitDb('select state from cashbook_entries where id=$1', [entryId], rows => rows[0].state === 'posted');
        await ownerPage.reload();
        await ownerPage.getByRole('button',{name:'Anweisung als falsch markieren',exact:true}).click();
        const flagDialog=ownerPage.getByRole('dialog',{name:'Anweisung im Notfall als falsch markieren',exact:true});
        const flagConfirm=flagDialog.getByRole('button',{name:'Verbindlich als falsch markieren',exact:true});
        assert.equal(await flagConfirm.isDisabled(),true);
        await flagDialog.getByLabel('Zur Bestätigung MARKIEREN eingeben',{exact:false}).fill('markieren');
        assert.equal(await flagConfirm.isDisabled(),true);
        await flagDialog.getByLabel('Hinweis für die Bürokraft (optional)',{exact:false}).fill('Bitte vor der Bearbeitung Rücksprache zur Bankverbindung halten.');
        await flagDialog.getByLabel('Zur Bestätigung MARKIEREN eingeben',{exact:false}).fill('MARKIEREN');
        await flagConfirm.click();
        await waitDb('select flagged_at,flagged_by from cashbook_entries where id=$1',[entryId],rows=>!!rows[0].flagged_at&&rows[0].flagged_by===owner.id);
        const officePage = await session(office, 390);
        await officePage.goto(`${base}/intern/kassenbuch/${bookId}`);
        assert.equal(await officePage.getByRole('heading', { name: 'Gebuchte Anweisungen' }).count(), 0);
        await officePage.getByText('Noch zu erledigende Anweisungen', { exact: false }).click();
        const flaggedInstruction = officePage.getByRole('link',{name:/AN-UI/});
        assert.match(await flaggedInstruction.getAttribute('class'),/bg-red-50/);
        await flaggedInstruction.getByText('Als falsch markiert – Rücksprache erforderlich',{exact:true}).waitFor();
        await officePage.screenshot({path:join(output,'office-emergency-warning.png'),fullPage:true});
        await flaggedInstruction.click();
        await officePage.getByRole('alert').filter({hasText:'Als falsch markiert – Rücksprache erforderlich'}).waitFor();
        await officePage.getByText('Bitte vor der Bearbeitung Rücksprache zur Bankverbindung halten.',{exact:true}).first().waitFor();
        const warningReaderPage = await session(reader);
        await warningReaderPage.goto(`${base}/intern/kassenbuch/vorgang/${entryId}`);
        assert.equal(await warningReaderPage.getByRole('button',{name:'Rücksprache geklärt',exact:true}).count(),0,'readers cannot resolve warnings');
        await ownerPage.reload();
        await ownerPage.getByRole('button',{name:'Rücksprache geklärt',exact:true}).waitFor();
        await officePage.getByRole('button',{name:'Rücksprache geklärt',exact:true}).click();
        const resolveDialog=officePage.getByRole('dialog',{name:'Rücksprache als geklärt markieren',exact:true});
        await resolveDialog.getByRole('button',{name:'Rücksprache geklärt',exact:true}).click();
        await waitDb('select flag_resolved_at,flag_resolved_by,office_done from cashbook_entries where id=$1',[entryId],rows=>!!rows[0].flag_resolved_at&&rows[0].flag_resolved_by===office.id&&!rows[0].office_done);
        await officePage.getByRole('alert').filter({hasText:'Als falsch markiert – Rücksprache erforderlich'}).waitFor({state:'detached'});
        assert.equal(await officePage.getByRole('button',{name:'Rücksprache geklärt',exact:true}).count(),0);
        await officePage.screenshot({path:join(output,'office-consultation-resolved.png'),fullPage:true});
        await ownerPage.reload();
        assert.equal(await ownerPage.getByRole('alert').filter({hasText:'Als falsch markiert – Rücksprache erforderlich'}).count(),0);
        await ownerPage.goto(`${base}/intern/kassenbuch/${bookId}`);
        assert.equal(await ownerPage.getByText('Rücksprache erforderlich:',{exact:false}).count(),0);
        assert.equal(await ownerPage.getByText('Als falsch markiert',{exact:true}).count(),0);
        await officePage.getByRole('button', { name: 'Als erledigt markieren', exact: true }).click();
        await waitDb('select office_done from cashbook_entries where id=$1', [entryId], rows => rows[0].office_done);
        assert.equal((await officePage.request.get(`${base}/api/cashbook/${entryId}/zip`)).status(), 200);
        await otherPage.goto(`${base}/intern/kassenbuch/vorgang/${entryId}`);
        await otherPage.getByText('Sie haben nicht die nötigen Rechte für diesen Kassenbuchvorgang.', { exact: true }).waitFor();
        assert.equal((await otherPage.request.get(`${base}/api/cashbook/${entryId}/file`)).status(), 403);
        await ownerPage.goto(`${base}/intern/kassenbuch/vorgang/${entryId}`);
        assert.equal(await ownerPage.getByRole('button',{name:'Anweisung als falsch markieren',exact:true}).count(),0);
        await ownerPage.getByRole('button',{name:'Buchungstag festlegen',exact:true}).click();
        await ownerPage.getByRole('button',{name:'Buchungstag eintragen',exact:true}).click();
        await waitDb('select booking_date from cashbook_entries where id=$1',[entryId],rows=>!!rows[0].booking_date);
        await ownerPage.reload();
        await ownerPage.getByRole('button',{name:'Korrekturbuchung anlegen',exact:true}).click();
        await ownerPage.getByRole('button',{name:'Korrektur vorbereiten',exact:true}).click();
        await ownerPage.getByLabel('Betrag',{exact:true}).fill('100,20');
        await ownerPage.getByLabel('Begründung (Pflichtfeld)',{exact:false}).fill('Korrigierter Testbetrag');
        await ownerPage.getByRole('button',{name:'Korrekturbuchung prüfen',exact:true}).click();
        await ownerPage.getByLabel('Zur Bestätigung BESTÄTIGEN eingeben',{exact:false}).fill('BESTÄTIGEN');
        await ownerPage.getByRole('button',{name:'Korrekturbuchung endgültig anlegen',exact:true}).click();
        await ownerPage.waitForURL(url=>url.pathname.includes('/kassenbuch/vorgang/')&&!url.pathname.endsWith('/'+entryId));
        const corrections=await query('select id,data from cashbook_entries where corrects_id=$1',[entryId]);
        assert.equal(corrections.rows[0].data.amount,10020);
        await officePage.goto(`${base}/intern/kassenbuch/${bookId}`);
        assert.equal(await officePage.getByText(/KÖT-0002/).count(),0,'corrections never enter office queues');
        await officePage.goto(`${base}/intern/kassenbuch/vorgang/${corrections.rows[0].id}`);
        assert.equal(await officePage.getByRole('button',{name:'Als erledigt markieren',exact:true}).count(),0);
        assert.equal(await officePage.getByRole('button',{name:'Wieder als offen markieren',exact:true}).count(),0);
        const numbers=await query("select booking_number from cashbook_entries where cashbook_id=$1 and state='posted' order by id",[bookId]);
        assert.deepEqual(numbers.rows.map(row=>row.booking_number),["KÖT-0001","KÖT-0002"]);
        assert.equal((await query('select data from cashbook_entries where id=$1',[entryId])).rows[0].data.amount,12550);
        const readerPage = await session(reader, 390);
        await readerPage.goto(`${base}/intern/kassenbuch/${bookId}`);
        assert.equal(await readerPage.getByRole('link', { name: 'Buchung anlegen', exact: true }).count(), 0);
        assert.ok(await readerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await readerPage.getByRole("columnheader").filter({hasText:"Buchungsnummer"}).waitFor();
        await readerPage.getByText("KÖT-0001",{exact:true}).waitFor();
        assert.ok(await readerPage.getByText("Korrektur zu KÖT-0001",{exact:true}).count());
        await readerPage.screenshot({ path: join(output, 'cashbook-mobile.png'), fullPage: true });
        // Entire-book exports require a web session and full read access, never an office-only role or bearer token.
        const exportUrl=`${base}/intern/kassenbuch/${bookId}/export`;
        assert.equal((await fetch(exportUrl+'?format=xlsx',{headers:bearerHeaders})).status,401);
        assert.equal((await otherPage.request.get(exportUrl+'?format=xlsx')).status(),403);
        assert.equal((await officePage.request.get(exportUrl+'?format=xlsx')).status(),403);
        const unchangedBefore=(await query('select id,revision,data,files from cashbook_entries where cashbook_id=$1 order by id',[bookId])).rows;
        const firstExport=await readerPage.request.get(exportUrl+'?format=xlsx');assert.equal(firstExport.status(),200);assert.equal(firstExport.headers()['cache-control'],'private, no-store');
        const firstSheet=exportZip(await firstExport.body()).get('xl/worksheets/sheet1.xml');
        assert.equal((firstSheet.match(/<row r=/g)||[]).length,3,'header plus every posted original/correction; drafts excluded');
        for(const value of ['IBAN','KÖT-0001','KÖT-0002','Korrektur zu KÖT-0001'])assert.ok(firstSheet.includes(value));
        assert.match(firstSheet,/<sheetProtection[^>]+algorithmName="SHA-512"/);
        const secondExport=await readerPage.request.get(exportUrl+'?format=xlsx');const secondSheet=exportZip(await secondExport.body()).get('xl/worksheets/sheet1.xml');assert.notEqual(firstSheet.match(/hashValue="([^"]+)"/)[1],secondSheet.match(/hashValue="([^"]+)"/)[1]);
        const options={filters:[{column:'amount',operator:'gte',value:'110'}],sort:[{column:'amount',direction:'desc'}],columns:['bookingNumber','amount']};
        const filtered=await readerPage.request.get(exportUrl+'?format=pdf&options='+encodeURIComponent(JSON.stringify(options)));assert.equal(filtered.status(),200);
        const pdfText=await require('../../lib/pdf-text').extractPdfText(await filtered.body());assert.match(pdfText.text,/Filter:/);assert.match(pdfText.text,/Sortierung:/);assert.match(pdfText.text,/KÖT-0001/);assert.ok(!pdfText.text.includes('KÖT-0002'));assert.ok(!pdfText.text.includes('DE89370400440532013000'));
        assert.equal((await readerPage.request.get(exportUrl+'?format=xlsx&options='+encodeURIComponent(JSON.stringify(options)))).status(),400);
        const sortedExport=await readerPage.request.get(exportUrl+'?format=xlsx&options='+encodeURIComponent(JSON.stringify({sort:[{column:'amount',direction:'asc'}]})));const sortedSheet=exportZip(await sortedExport.body()).get('xl/worksheets/sheet1.xml');assert.ok(sortedSheet.indexOf('KÖT-0002')<sortedSheet.indexOf('KÖT-0001'));
        await readerPage.getByRole('button',{name:'PDF',exact:true}).click();
        const pdfDialog=readerPage.getByRole('dialog',{name:'PDF exportieren',exact:true});
        await pdfDialog.getByRole('button',{name:'Filter hinzufügen',exact:true}).click();
        await pdfDialog.getByRole('button',{name:'Filter 1: Spalte',exact:true}).click();await readerPage.getByRole('option',{name:'Betrag (€)',exact:true}).click();
        await pdfDialog.getByRole('button',{name:'Filter 1: Bedingung',exact:true}).click();await readerPage.getByRole('option',{name:'ab / mindestens',exact:true}).click();
        await pdfDialog.getByLabel('Filter 1: Wert',{exact:true}).fill('110');
        await pdfDialog.getByRole('button',{name:'Sortierung hinzufügen',exact:true}).click();
        await readerPage.screenshot({path:join(output,'cashbook-pdf-export-mobile.png'),fullPage:true});
        assert.ok(await readerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        const pdfDownloadPromise=readerPage.waitForEvent('download');await pdfDialog.getByRole('button',{name:'PDF herunterladen',exact:true}).click();await (await pdfDownloadPromise).saveAs(join(output,'book-selection.pdf'));
        await readerPage.getByRole('button',{name:'Excel',exact:true}).click();
        const excelDialog=readerPage.getByRole('dialog',{name:'Excel exportieren',exact:true});assert.equal(await excelDialog.getByRole('button',{name:'Filter hinzufügen',exact:true}).count(),0);
        await excelDialog.getByRole('button',{name:'Sortierung hinzufügen',exact:true}).click();await excelDialog.getByRole('button',{name:'Sortierung 1: Spalte',exact:true}).click();await readerPage.getByRole('option',{name:'Betrag (€)',exact:true}).click();
        const excelDownloadPromise=readerPage.waitForEvent('download');await excelDialog.getByRole('button',{name:'Excel herunterladen',exact:true}).click();await (await excelDownloadPromise).saveAs(join(output,'complete-book.xlsx'));
        assert.deepEqual((await query('select id,revision,data,files from cashbook_entries where cashbook_id=$1 order by id',[bookId])).rows,unchangedBefore,'exports never mutate bookkeeping');
        await service.saveCashbookGrant(owner,bookId,'user',reader.id,'remove');assert.equal((await readerPage.request.get(exportUrl)).status(),403);await service.saveCashbookGrant(owner,bookId,'user',reader.id,'read');
        await service.saveCashbookGrant(owner,bookId,'user',office.id,'read');assert.equal((await officePage.request.get(exportUrl)).status(),200);await service.saveCashbookGrant(owner,bookId,'user',office.id,'remove');
        const [finance]=await db.insert(schema.financeBoards).values({name:'Browser export finances',ownerId:owner.id,cashbookId:bookId}).returning();
        await db.insert(schema.financeBoardAccounts).values({financeBoardId:finance.id,accountId:otherAccount.id});await db.insert(schema.financeBoardSources).values({financeBoardId:finance.id,boardId:board.id,accountId:otherAccount.id});
        await db.insert(schema.financeBoardAccess).values({financeBoardId:finance.id,userId:reader.id,accessLevel:'read'});
        await db.insert(schema.financePlanItems).values({financeBoardId:finance.id,kind:'expense',title:'Material',haushaltstitel:'1200',plannedAmount:20000});
        for(const view of ['plan','live','actual','antraege','antraege_nr']){
          const url=`${base}/finanzen/${finance.id}/export?view=${view}`;
          assert.equal((await fetch(url+'&format=xlsx',{headers:bearerHeaders})).status,401);assert.equal((await otherPage.request.get(url)).status(),404);
          const response=await readerPage.request.get(url+'&format=xlsx');assert.equal(response.status(),200);assert.match(exportZip(await response.body()).get('xl/worksheets/sheet1.xml'),/<sheetProtection/);
          const pdf=await readerPage.request.get(url+'&format=pdf');assert.equal(pdf.status(),200);const text=await require('../../lib/pdf-text').extractPdfText(await pdf.body());assert.match(text.text,/Filter:/);assert.match(text.text,/Sortierung:/);assert.ok(!text.text.includes('DE89370400440532013000'));
        }
        await readerPage.goto(`${base}/finanzen/${finance.id}`);await readerPage.getByRole('button',{name:'Live-Ausgaben',exact:true}).click();await readerPage.getByRole('button',{name:'PDF',exact:true}).click();await readerPage.getByRole('dialog',{name:'PDF exportieren',exact:true}).waitFor();await readerPage.screenshot({path:join(output,'finance-pdf-export-mobile.png'),fullPage:true});

        const freshBoardId=await require('../../lib/boards').createBoardFromTemplate(owner.id,'Fresh board without legacy fields',null,null);
        await ownerPage.goto(`${base}/intern/board/${freshBoardId}/einstellungen`);
        await ownerPage.getByText('Kartenfelder',{exact:true}).click();
        for(const name of ['Konto','Haushaltstitel','Genehmigter Betrag (€)'])assert.equal(await ownerPage.getByRole('checkbox',{name,exact:true}).count(),0);
        await ownerPage.getByRole('button',{name:'Kartenfelder speichern',exact:true}).click();
        await ownerPage.getByText('Kartenfelder gespeichert.',{exact:true}).waitFor();
        assert.equal((await query("select count(*) from board_card_fields where board_id=$1 and field_key in ('account','budget_title','approved_amount')",[freshBoardId])).rows[0].count,'0');
        await ownerPage.goto(`${base}/intern/board/${board.id}/einstellungen`);
        await ownerPage.getByText('Kartenfelder',{exact:true}).click();
        for(const name of ['Konto','Haushaltstitel','Genehmigter Betrag (€)'])assert.equal(await ownerPage.getByRole('checkbox',{name,exact:true}).count(),1);

        // Admin-only application creation; fixed attachment areas and isolated form modules.
        await otherPage.goto(`${base}/admin/antragsboards`);assert.ok(!otherPage.url().includes('/admin/'));
        const moduleTemplate=(await db.insert(schema.boardTemplates).values({name:'Browser module template '+randomUUID()}).returning())[0];await db.insert(schema.boardTemplateStatuses).values({templateId:moduleTemplate.id,name:'Inbox',position:0});
        await ownerPage.goto(`${base}/admin/antragsboards`);
        const applicationCreate=ownerPage.locator('form').filter({has:ownerPage.getByRole('heading',{name:'Antragsboard erstellen',exact:true})});
        for(const name of ['Finanzantrag','Anlage A','Anlage B','Studierendenausweis','Quittungen'])assert.equal(await applicationCreate.getByRole('checkbox',{name,exact:true}).isChecked(),true);
        for(const name of ['Anlage A','Anlage B','Studierendenausweis'])await applicationCreate.getByRole('checkbox',{name,exact:true}).uncheck();
        const applicationName='Browser application module '+randomUUID();await applicationCreate.getByLabel('Name',{exact:true}).fill(applicationName);
        await applicationCreate.getByRole('button',{name:'Antragsboard erstellen',exact:true}).click();await ownerPage.waitForURL(/\/intern\/board\/\d+$/);
        const applicationId=Number(new URL(ownerPage.url()).pathname.split('/').at(-1));
        const applicationBoard=(await query('select * from boards where id=$1',[applicationId])).rows[0];assert.equal(applicationBoard.is_application_board,true);assert.deepEqual(applicationBoard.attachment_fields,['finance_request','receipts']);
        await ownerPage.goto(`${base}/intern/board/${applicationId}/einstellungen`);await ownerPage.getByText('Kartenfelder',{exact:true}).click();
        for(const name of ['Finanzantrag (PDF)','Anlage A (PDF)','Anlage B (PDF)','Studierendenausweis','Quittungen','Tatsächliche Ausgaben (€)','Anweisungsdatum','Überweisungsdatum'])assert.equal(await ownerPage.getByRole('checkbox',{name,exact:true}).count(),0);
        assert.equal(await ownerPage.getByRole('checkbox',{name:'Dateien (PDF)',exact:true}).count(),1);
        await ownerPage.getByRole('button',{name:'Kartenfelder speichern',exact:true}).click();await ownerPage.getByText('Kartenfelder gespeichert.',{exact:true}).waitFor();
        assert.equal((await query("select visible from board_card_fields where board_id=$1 and field_key='finance_request'",[applicationId])).rows[0].visible,true);
        await ownerPage.goto(`${base}/admin/finanzantraege-formular`);assert.equal(await ownerPage.getByRole('button',{name:'Modul aktivieren',exact:true}).isDisabled(),true);
        const moduleLocationName='Browser finance campus '+randomUUID();await ownerPage.getByLabel('Neuer Standort',{exact:true}).fill(moduleLocationName);await ownerPage.getByRole('button',{name:'Anlegen',exact:true}).click();
        await waitDb("select id from locations where module='finance' and name=$1",[moduleLocationName],rows=>rows.length===1);
        const moduleLocation=ownerPage.locator('div.card').filter({has:ownerPage.locator(`input[value="${moduleLocationName}"]`)});
        await moduleLocation.getByRole('button',{name:'Ziel-Board',exact:true}).click();assert.equal(await ownerPage.getByRole('option',{name:'Fresh board without legacy fields',exact:true}).count(),0);await ownerPage.getByRole('option',{name:applicationName,exact:true}).click();
        const [applicationStatus]=(await query('select id,name from board_statuses where board_id=$1 order by position,id',[applicationId])).rows;
        await moduleLocation.getByRole('button',{name:'Ziel-Spalte',exact:true}).click();await ownerPage.getByRole('option',{name:applicationStatus.name,exact:true}).click();await moduleLocation.getByRole('button',{name:'Ziel speichern',exact:true}).click();await moduleLocation.getByText('Ziel gespeichert.',{exact:true}).waitFor();
        await moduleLocation.getByRole('button',{name:'Aktivieren',exact:true}).click();await ownerPage.getByRole('dialog',{name:/Standort .* aktivieren/}).getByRole('button',{name:'Aktivieren',exact:true}).click();
        await waitDb('select enabled from locations where name=$1',[moduleLocationName],rows=>rows[0]?.enabled===true);
        await ownerPage.goto(`${base}/admin/standorte`);await ownerPage.getByRole('button',{name:'Modul deaktivieren',exact:true}).click();
        let moduleDialog=ownerPage.getByRole('dialog',{name:'Modul deaktivieren',exact:true});assert.equal(await moduleDialog.getByRole('button',{name:'Modul deaktivieren',exact:true}).isDisabled(),true);await moduleDialog.getByLabel('Zur Bestätigung DEAKTIVIEREN eingeben',{exact:true}).fill('DEAKTIVIEREN');await moduleDialog.getByRole('button',{name:'Modul deaktivieren',exact:true}).click();
        await waitDb('select active_module from application_form_modules',[],rows=>rows[0]?.active_module===null);
        assert.deepEqual((await (await fetch(base+'/api/public/v1/locations')).json()).locations,[]);
        await ownerPage.goto(`${base}/admin/finanzantraege-formular`);await ownerPage.getByRole('button',{name:'Modul aktivieren',exact:true}).click();moduleDialog=ownerPage.getByRole('dialog',{name:'Modul aktivieren',exact:true});await moduleDialog.getByLabel('Zur Bestätigung BESTÄTIGEN eingeben',{exact:true}).fill('BESTÄTIGEN');await moduleDialog.getByRole('button',{name:'Modul aktivieren',exact:true}).click();await waitDb('select active_module from application_form_modules',[],rows=>rows[0]?.active_module==='finance');
        await ownerPage.setViewportSize({width:390,height:1000});await ownerPage.screenshot({path:join(output,'finance-form-module-mobile.png'),fullPage:true});assert.ok(await ownerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await ownerPage.setViewportSize({width:1400,height:1000});
        const publicPage=await browser.newPage();await publicPage.goto(base);assert.equal(await publicPage.locator('input[name=student_card]').count(),0);await publicPage.getByRole('button',{name:'Standort',exact:true}).click();await publicPage.getByRole('option',{name:moduleLocationName,exact:true}).click();
        assert.equal(await publicPage.locator('input[name="student_card"]').count(),0);assert.equal(await publicPage.locator('input[name="annex_a"]').count(),0);
        await publicPage.getByLabel('Antragsgegenstand *',{exact:true}).fill('Public finance module UI');await publicPage.getByLabel('E-Mail-Adresse *',{exact:true}).fill('synthetic@example.org');await publicPage.getByLabel('Antragsteller *',{exact:true}).fill('Synthetic applicant');await publicPage.locator('input[name="finance_request"]').setInputFiles({name:'application.pdf',mimeType:'application/pdf',buffer:pdf});
        await publicPage.screenshot({path:join(output,'public-finance-form.png'),fullPage:true});await publicPage.waitForTimeout(3500);await publicPage.getByRole('button',{name:'Antrag einreichen',exact:true}).click();await publicPage.waitForURL(/\/status\//);
        const publicSubmitted=(await query("select id,board_id from cards where title='Public finance module UI'")).rows;assert.equal(publicSubmitted.length,1);assert.equal(publicSubmitted[0].board_id,applicationId);assert.deepEqual((await query('select kind from attachments where card_id=$1',[publicSubmitted[0].id])).rows,[{kind:'finance_request'}]);
        await ownerPage.goto(`${base}/admin/finanzantraege-formular`);await ownerPage.getByRole('button',{name:'Modul deaktivieren',exact:true}).click();moduleDialog=ownerPage.getByRole('dialog',{name:'Modul deaktivieren',exact:true});await moduleDialog.getByLabel('Zur Bestätigung DEAKTIVIEREN eingeben',{exact:true}).fill('DEAKTIVIEREN');await moduleDialog.getByRole('button',{name:'Modul deaktivieren',exact:true}).click();await waitDb('select active_module from application_form_modules',[],rows=>rows[0]?.active_module===null);
        await ownerPage.goto(`${base}/admin/standorte`);await ownerPage.getByRole('button',{name:'Modul aktivieren',exact:true}).click();moduleDialog=ownerPage.getByRole('dialog',{name:'Modul aktivieren',exact:true});await moduleDialog.getByLabel('Zur Bestätigung BESTÄTIGEN eingeben',{exact:true}).fill('BESTÄTIGEN');await moduleDialog.getByRole('button',{name:'Modul aktivieren',exact:true}).click();await waitDb('select active_module from application_form_modules',[],rows=>rows[0]?.active_module==='locations');

        await ownerPage.goto(`${base}/intern/kassenbuch/${bookId}`);
        await ownerPage.screenshot({ path: join(output, 'cashbook-desktop.png'), fullPage: true });
        console.log('Cashbook production workflow passed: ' + output);
    }
    catch (error) {
        if (browser) {
            for (const [index, context] of browser.contexts().entries()) {
                const page = context.pages()[0];
                if (page) {
                    await page.screenshot({ path: join(output, `failure-${index}.png`), fullPage: true }).catch(() => { });
                    writeFileSync(join(output, `failure-${index}.txt`), await page.locator('body').innerText().catch(() => ''));
                    console.error('Failed page', page.url(), (await page.locator('body').innerText().catch(() => '')).slice(0, 1400));
                }
            }
        }
        console.error('Artifacts:', output, 'Server:', log.slice(-2500));
        throw error;
    }
    finally {
        if (browser)
            await browser.close();
        child.kill('SIGTERM');
        await new Promise(resolve => child.once('exit', resolve));
        await sso.close();
        await pool.end();
        await appPool.end();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
