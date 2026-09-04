const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdtempSync, writeFileSync, readFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const repository = resolve(__dirname, '../..');
const output = mkdtempSync(join(tmpdir(), 'gremio-workflows-browser-'));
(async () => {
  await require('esbuild').build({ entryPoints: [join(__dirname, 'workflows.fixture.tsx')], bundle: true, outfile: join(output, 'bundle.js'), jsx: 'automatic', absWorkingDir: repository, define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' }, plugins: [{ name: 'local-action-doubles', setup(build) {
    build.onResolve({ filter: /app\/(status|intern\/card)\/\[.*\]\/actions$/ }, () => ({ path: join(__dirname, 'workflows-actions.fixture.ts') }));
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useRouter = () => ({refresh(){}});', loader: 'js' }));
  } }] });
  execFileSync(process.execPath, [require.resolve('tailwindcss/lib/cli'), '-i', 'app/globals.css', '-o', join(output, 'styles.css')], { cwd: repository });
  writeFileSync(join(output, 'index.html'), '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css"><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const server = createServer((req,res) => { const file = new URL(req.url,'http://localhost').pathname.slice(1) || 'index.html'; if (!['index.html','bundle.js','styles.css'].includes(file)) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(readFileSync(join(output,file))); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  try { for (const width of [1400,390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); const errors=[]; page.on('pageerror',e=>{ errors.push(e.message); console.error('Browser:', e.message); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for (const id of [2,3,4]) await page.getByLabel(`Spalte ${id}`,{exact:true}).check();
    await page.getByRole('button',{name:'Setzen',exact:true}).click();
    await page.waitForFunction(()=>window.triggers?.length === 4);
    assert.equal(await page.locator('input[name=statusIds]:checked').count(),4,'React form reset must not undo the visible saved selection');
    const general = page.getByRole('region',{name:'Allgemeine Dateien'});
    const receipts = page.locator('fieldset.card').filter({has:page.getByRole('heading',{name:'Quittung einreichen',exact:true})});
    const explanation = await general.locator('p').boundingBox();
    const uploadButton = await general.getByRole('button',{name:'Dateien hochladen',exact:true}).boundingBox();
    assert.ok(uploadButton.y - (explanation.y + explanation.height) >= 16, 'upload button has comfortable spacing after explanation');
    const pdf = name => ({ name, mimeType:'application/pdf', buffer:Buffer.from('%PDF-1.7 test') });
    await general.locator('input[type=file]').setInputFiles([pdf('first.pdf'),pdf('fail.pdf'),pdf('last.pdf')]);
    assert.equal(await page.getByRole('button',{name:'Quittung einreichen',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Live-Aktualisierung',exact:true}).click();
    await general.getByText('Hinzugefügt: last.pdf',{exact:true}).waitFor();
    assert.equal(await general.getByText('Testfehler für diese Datei',{exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>window.submissions.length),0);
    await general.getByRole('button',{name:'Erneut versuchen',exact:true}).click();
    await general.getByText('Hinzugefügt: fail.pdf',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.uploads.map(f=>f.name)),['first.pdf','fail.pdf','last.pdf','fail.pdf']);
    await general.locator('input[type=file]').setInputFiles([pdf('again.pdf')]); await general.getByText('Hinzugefügt: again.pdf',{exact:true}).waitFor();
    await receipts.locator('input[type=file]').setInputFiles([pdf('q1.pdf'),pdf('q2.pdf'),pdf('q3.pdf')]);
    await receipts.getByText('Hinzugefügt: q3.pdf',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.uploads.filter(f=>f.purpose==='receipt').length),3);
    await page.getByRole('button',{name:'Gate sperren',exact:true}).click(); assert.equal(await receipts.getByText('Hinzugefügt: q3.pdf',{exact:true}).isVisible(),true);
    assert.equal(await receipts.getByRole('button',{name:'Quittung einreichen',exact:true}).isDisabled(),true);
    assert.equal(await receipts.getByText('Dieser Bereich ist inzwischen gesperrt.',{exact:false}).isVisible(),true,'revocation notice stays inside receipt card');
    await general.getByRole('button',{name:'Nachreichung einreichen',exact:true}).click(); await page.waitForFunction(()=>window.submissions.length===1);
    const budget = page.getByRole('region',{name:'Budget'});
    await budget.getByRole('button',{name:'Weiteren Haushaltstitel hinzufügen',exact:true}).click();
    await budget.getByText('Konto erforderlich – noch nicht gespeichert',{exact:true}).waitFor();
    await page.waitForTimeout(800); assert.equal(await page.evaluate(()=>window.budgetSaves.length),0);
    await page.getByRole('button',{name:'Live-Aktualisierung',exact:true}).click();
    assert.equal(await budget.getByRole('group',{name:'Position 2',exact:true}).count(),1);
    const first = budget.getByRole('group',{name:'Position 1',exact:true});
    await first.getByLabel('Haushaltstitel',{exact:true}).fill('54321');
    await first.getByLabel('Beantragter Betrag (€)',{exact:true}).fill('210');
    await budget.getByRole('button',{name:'Konto Position 1',exact:true}).click(); await page.getByRole('option',{name:'Konto A',exact:true}).click();
    const second = budget.getByRole('group',{name:'Position 2',exact:true});
    await second.getByLabel('Haushaltstitel',{exact:true}).fill('12344');
    await second.getByLabel('Bezeichnung',{exact:true}).fill('Gegenstand B');
    await second.getByLabel('Beantragter Betrag (€)',{exact:true}).fill('200');
    await second.getByLabel('Genehmigter Betrag (€)',{exact:true}).fill('200');
    await second.getByLabel('Tatsächliche Ausgaben (€)',{exact:true}).fill('180');
    await budget.getByText('Gespeichert ✓',{exact:true}).waitFor();
    assert.equal(await budget.getByText('410,00 €',{exact:true}).count(),1);
    assert.equal(await budget.getByText('350,00 €',{exact:true}).count(),1);
    assert.equal(await budget.getByText('310,00 €',{exact:true}).count(),1);
    const saved = await page.evaluate(()=>window.budgetSaves.at(-1)); assert.equal(saved[0].accountId,1); assert.equal(saved[1].accountId,2);
    assert.equal(saved[0].budgetTitle,'54321'); assert.equal(saved[0].requestedAmount,21000);
    await page.getByRole('button',{name:'Gespeicherte Positionen neu laden',exact:true}).click();
    await first.getByLabel('Bezeichnung',{exact:true}).fill('Nach Neuladen bearbeitet');
    await budget.getByText('Gespeichert ✓',{exact:true}).waitFor();
    const reloaded = await page.evaluate(()=>window.budgetSaves.at(-1));
    assert.equal(reloaded[0].description,'Nach Neuladen bearbeitet');
    assert.equal(reloaded[0].id,saved[0].id);
    assert.equal('cardId' in reloaded[0],false); assert.equal('position' in reloaded[0],false);
    const disclosure = budget.locator('details.collapsible');
    const toggle = disclosure.locator('summary');
    await first.getByLabel('Bezeichnung',{exact:true}).fill('Eingeklappt gespeichert');
    await toggle.click();
    assert.equal(await first.isVisible(),false,'positions collapse without unmounting');
    await budget.getByText('Gespeichert ✓',{exact:true}).waitFor();
    await page.waitForTimeout(100);
    assert.equal(await disclosure.evaluate(el=>el.open),false,'autosave/live refresh keeps section collapsed');
    assert.equal(await page.evaluate(()=>window.budgetSaves.at(-1)[0].description),'Eingeklappt gespeichert','autosave continues when collapsed');
    await toggle.focus(); await page.keyboard.press('Enter');
    assert.equal(await first.isVisible(),true,'keyboard expands positions');
    assert.equal(await first.getByLabel('Bezeichnung',{exact:true}).inputValue(),'Eingeklappt gespeichert','expanding retains draft');
    for (const [label, text, key, cents] of [
      ['Beantragter Betrag (€)','12','requestedAmount',1200],
      ['Genehmigter Betrag (€)','12,5','approvedAmount',1250],
      ['Tatsächliche Ausgaben (€)','0','actualAmount',0],
      ['Tatsächliche Ausgaben (€)','','actualAmount',null],
    ]) {
      const amount = first.getByLabel(label,{exact:true});
      const count = await page.evaluate(()=>window.budgetSaves.length);
      await amount.fill(text);
      await amount.evaluate(el=>el.setSelectionRange(Math.min(1,el.value.length),Math.min(1,el.value.length)));
      await page.waitForFunction(n=>window.budgetSaves.length>n,count);
      await page.waitForTimeout(100);
      assert.equal(await amount.inputValue(),text,'autosave echo preserves literal input');
      assert.equal(await amount.evaluate(el=>el.selectionStart),Math.min(1,text.length),'autosave preserves cursor');
      assert.equal(await amount.evaluate(el=>document.activeElement===el),true,'autosave preserves focus');
      assert.equal(await page.evaluate(key=>window.budgetSaves.at(-1)[0][key],key),cents);
    }
    assert.equal(await budget.getByText('212,00 €',{exact:true}).count(),1,'totals remain formatted');
    await page.evaluate(() => {
      const rows = structuredClone(window.budgetSaves.at(-1));
      rows[1].requestedAmount = 25000;
      window.dispatchEvent(new CustomEvent('budget-saved',{detail:{rows,revision:window.budgetSaves.length+1}}));
    });
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('input')).some(el=>el.value==='250,00'));
    assert.equal(await first.getByLabel('Beantragter Betrag (€)',{exact:true}).inputValue(),'12','unrelated remote edits preserve local formatting');
    assert.equal(await second.getByLabel('Beantragter Betrag (€)',{exact:true}).inputValue(),'250,00','real external changes still update clean fields');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('budget-saved',{detail:{rows:[],revision:0}})));
    await page.waitForTimeout(100);
    assert.equal(await first.count(),1,'stale server snapshots do not reset saved positions');
    await budget.getByRole('group',{name:'Position 1',exact:true}).getByRole('button',{name:'Position entfernen',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Abbrechen',exact:true}).click(); assert.equal(await budget.getByRole('group',{name:'Position 1',exact:true}).count(),1);
    await budget.getByRole('group',{name:'Position 1',exact:true}).getByRole('button',{name:'Position entfernen',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Entfernen',exact:true}).click(); await budget.getByText('Gespeichert ✓',{exact:true}).waitFor();
    assert.equal(await budget.getByLabel('Bezeichnung',{exact:true}).inputValue(),'Gegenstand B');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no viewport overflow');
    await page.screenshot({path:join(output,`workflows-${width}.png`),fullPage:true});
    assert.deepEqual(errors,[]); await page.close();
  } console.log(`Passed desktop/mobile workflows: ${output}`); }
  finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
