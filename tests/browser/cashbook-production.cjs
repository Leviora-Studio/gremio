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
    const board = (await query("insert into boards(name,owner_id,is_application_board) values ('UI applications',$1,true) returning id", [owner.id])).rows[0];
    const statuses = (await query("insert into board_statuses(board_id,name,is_lock_column) values ($1,'Incoming',false),($1,'Accepted',true) returning id", [board.id])).rows;
    for (const field of ['number', 'applicant', 'finance_request', 'requested_amount', 'approved_amount', 'budget_title', 'account', 'other_pdfs'])
        await query('insert into board_card_fields(board_id,field_key,visible) values ($1,$2,true)', [board.id, field]);
    const token = randomUUID().replaceAll('-', '').slice(0, 30);
    const card = (await query("insert into cards(board_id,status_id,title,applicant,token,number) values ($1,$2,'Browser application','Synthetic applicant',$3,'AN-UI') returning id", [board.id, statuses[0].id, token])).rows[0];
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
        let publicData = await (await fetch(base + '/api/public/v1/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusUrl: base + '/status/' + token }) })).json();
        assert.equal(publicData.status.name, 'Incoming');
        await ownerPage.getByRole('button', { name: 'Karte endgültig sperren', exact: true }).click();
        await ownerPage.getByRole('button', { name: 'Endgültig sperren', exact: true }).click();
        await waitDb('select locked_at from cards where id=$1', [card.id], rows => !!rows[0].locked_at);
        await ownerPage.reload();
        assert.equal(await ownerPage.getByRole('button', { name: 'Karte endgültig sperren', exact: true }).count(), 0);
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
        for (const [label, value] of [['Betrag', '125,50'], ['Haushaltstitel', '1200'], ['Kontoinhaber', 'Synthetic holder'], ['IBAN', 'DE89370400440532013000'], ['Bank', 'Synthetic bank'], ['Verwendungszweck (optional)', 'Materials'], ['Ort', 'Köthen']])
            await ownerPage.getByLabel(label, { exact: true }).fill(value);
        await ownerPage.getByRole('button', { name: 'Anweisungsformular erstellen', exact: true }).click();
        await ownerPage.waitForURL(/\/kassenbuch\/vorgang\/\d+/);
        const entryId = Number(ownerPage.url().split('/').at(-1));
        // A valid unrestricted owner API token still cannot fetch cashbook files/ZIPs.
        for (const suffix of ['file', 'zip']) assert.equal((await fetch(`${base}/api/cashbook/${entryId}/${suffix}`, { headers: bearerHeaders })).status, 403);
        assert.equal((await otherPage.request.get(`${base}/api/cashbook/${entryId}/file`)).status(), 403);
        assert.equal((await ownerPage.request.get(`${base}/api/cashbook/${entryId}/file`)).status(), 200);
        await ownerPage.getByRole('button', { name: /Formular ansehen und unterschreiben/ }).waitFor();
        async function sign(page) { await page.getByRole('button', { name: /Formular ansehen und unterschreiben/ }).click(); await page.locator('.react-pdf__Page canvas').first().waitFor({ timeout: 30000 }); assert.equal(await page.getByRole('button', { name: '✎ Text', exact: true }).count(), 0, 'sign-only viewer has no text editing'); await page.getByRole('button', { name: '✒ Signieren', exact: true }).click(); const area = await page.locator('.react-pdf__Page').first().boundingBox(); await page.mouse.move(area.x + area.width * .1, area.y + area.height * .35); await page.mouse.down(); await page.mouse.move(area.x + area.width * .4, area.y + area.height * .43, { steps: 8 }); await page.mouse.up(); await page.getByRole('button', { name: 'Speichern', exact: true }).click(); await waitDb('select first_signed_at,second_signed_at from cashbook_entries where id=$1', [entryId], rows => page === ownerPage ? !!rows[0].first_signed_at : !!rows[0].second_signed_at); await page.locator('.react-pdf__Page canvas').first().waitFor({ state: 'detached', timeout: 30000 }); }
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
        await secondPage.getByLabel('Ort der zweiten Unterschrift',{exact:true}).fill('Berlin');
        await secondPage.getByRole('button',{name:'Datum der zweiten Unterschrift',exact:true}).click();
        await secondPage.getByRole('dialog',{name:'Datum der zweiten Unterschrift: Kalender',exact:true}).getByRole('button',{name:'1',exact:true}).click();
        await secondPage.getByRole('button',{name:'Ort und Datum ins Formular übernehmen',exact:true}).click();
        await secondPage.getByRole('status').filter({hasText:'Ort und Datum sind im Formular eingetragen'}).waitFor();
        const preparedPdf=await secondPage.request.get(`${base}/api/cashbook/${entryId}/file`);
        const preparedText=await require('../../lib/pdf-text').extractPdfText(await preparedPdf.body());
        assert.match(preparedText.text,/Berlin, 01\./);
        await secondPage.screenshot({path:join(output,'second-signature-details.png'),fullPage:true});
        await sign(secondPage);
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
        await readerPage.screenshot({ path: join(output, 'cashbook-mobile.png'), fullPage: true });
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
