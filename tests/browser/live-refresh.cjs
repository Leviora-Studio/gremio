// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {mkdtempSync,writeFileSync,readFileSync,rmSync}=require('node:fs');
const {createServer}=require('node:http');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');
const repository=resolve(__dirname,'../..'),output=mkdtempSync(join(tmpdir(),'gremio-live-refresh-'));
require('esbuild').buildSync({entryPoints:[join(__dirname,'live-refresh.fixture.tsx')],bundle:true,outfile:join(output,'bundle.js'),jsx:'automatic',absWorkingDir:repository,alias:{react:join(repository,'node_modules/react'),'react-dom':join(repository,'node_modules/react-dom'),'next/navigation':join(__dirname,'live-refresh.navigation.fixture.ts')},define:{'process.env.NODE_ENV':'"development"'}});
writeFileSync(join(output,'index.html'),'<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
(async()=>{
 const server=createServer((req,res)=>{const name=req.url==='/bundle.js'?'bundle.js':'index.html';res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html');res.end(readFileSync(join(output,name)));});
 let browser;
 try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   window.refreshCount=0;window.addEventListener('fixture-refresh',()=>window.refreshCount++);
   window.EventSource=class {
    static CLOSED=2;readyState=1;
    constructor(){this.listener=()=>this.onmessage?.({data:''});window.addEventListener('fixture-change',this.listener);setTimeout(()=>this.onopen?.(),0);}
    close(){window.removeEventListener('fixture-change',this.listener);}
   };
  });
  const load=async()=>{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.refreshCount>=1);};
  const changed=()=>page.evaluate(()=>window.dispatchEvent(new Event('fixture-change')));
  const count=()=>page.evaluate(()=>window.refreshCount);
  const quiet=async()=>{await page.waitForTimeout(2600);assert.equal(await page.getByText('Neue Änderungen verfügbar',{exact:true}).count(),0);};
  await load();
  // Pure focus or clean modal quietly delays updates without suggesting a draft.
  await page.getByLabel('Titel',{exact:true}).focus();let before=await count();await changed();await quiet();assert.equal(await count(),before);
  await page.getByLabel('Titel',{exact:true}).blur();await page.waitForFunction(n=>window.refreshCount>n,before);
  await page.getByRole('button',{name:'Dialog',exact:true}).click();before=await count();await changed();await quiet();assert.equal(await count(),before);
  await page.getByRole('button',{name:'Dialog',exact:true}).click();await page.waitForFunction(n=>window.refreshCount>n,before);
  // Focus catchups protect drafts without inventing a change notification.
  await load();await page.getByLabel('Titel',{exact:true}).fill('Entwurf');before=await count();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await quiet();assert.equal(await count(),before);
  await changed();await page.getByText('Neue Änderungen verfügbar',{exact:true}).waitFor();assert.equal(await page.getByLabel('Titel',{exact:true}).inputValue(),'Entwurf');
  // React action disables its fieldset and resets the form after success.
  await page.getByRole('button',{name:'Speichern',exact:true}).click();await page.getByText('Gespeichert',{exact:true}).waitFor();
  await page.waitForFunction(n=>window.refreshCount>n,before);await changed();await quiet();assert.equal(await page.getByLabel('Titel',{exact:true}).inputValue(),'');
  // Search/filter values and temporary fieldset disabling are never drafts.
  await load();await page.getByLabel('Suche',{exact:true}).fill('Suchwort');await page.getByLabel('Filter',{exact:true}).fill('Filterwert');await page.getByLabel('Filter',{exact:true}).blur();before=await count();await changed();await quiet();await page.waitForFunction(n=>window.refreshCount>n,before);
  assert.deepEqual(await page.evaluate(()=>{
   const input=document.querySelector('input[name=title]'),form=input.form,fieldset=form.querySelector('fieldset'),guard=window.fixtureGuard;
   guard.capture(input);fieldset.disabled=true;const disabled=guard.hasDraft();guard.reset(form);fieldset.disabled=false;const enabled=guard.hasDraft();input.value='Neu';const edited=guard.hasDraft();fieldset.disabled=true;const editedDisabled=guard.hasDraft();input.value='';fieldset.disabled=false;return {disabled,enabled,edited,editedDisabled,reverted:guard.hasDraft()};
  }),{disabled:false,enabled:false,edited:true,editedDisabled:true,reverted:false});
  // Controlled inputs declare their own saved state instead of retaining an old baseline.
  await load();const rename=page.getByRole('region',{name:'Umbenennen'});await rename.locator('input').fill('Neuer Name');before=await count();await changed();await page.getByText('Neue Änderungen verfügbar',{exact:true}).waitFor();
  await rename.getByRole('button',{name:'Umbenennen',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Umbenennen',exact:true}).click();await page.getByText('Name gespeichert',{exact:true}).waitFor();await changed();await quiet();assert.ok(await count()>before);
  // Collapsing a section does not discard the draft protection.
  await load();await page.getByText('Thema',{exact:true}).click();await page.getByLabel('Eingeklappter Entwurf').fill('Nicht verlieren');await page.getByText('Thema',{exact:true}).click();before=await count();await changed();await page.getByText('Neue Änderungen verfügbar',{exact:true}).waitFor();assert.equal(await count(),before);
  assert.deepEqual(errors,[]);console.log('PASS live refresh: clean focus/dialog, quiet catchup, draft preservation, React action reset, disabled fields, filters, controlled save, collapsed drafts');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));rmSync(output,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
