// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {mkdtempSync,writeFileSync,readFileSync}=require('node:fs');const {createServer}=require('node:http');
const {tmpdir}=require('node:os');const {join,resolve}=require('node:path');const {execFileSync}=require('node:child_process');const assert=require('node:assert/strict');
const repository=resolve(__dirname,'../..'),output=mkdtempSync(join(tmpdir(),'gremio-meeting-visibility-'));
require('esbuild').buildSync({entryPoints:[join(__dirname,'meeting-visibility.fixture.tsx')],bundle:true,outfile:join(output,'bundle.js'),jsx:'automatic',absWorkingDir:repository,alias:{react:join(repository,'node_modules/react'),'react-dom':join(repository,'node_modules/react-dom'),'next/navigation':join(__dirname,'live-refresh.navigation.fixture.ts'),'@/app/intern/sitzungen/actions':join(__dirname,'meeting-visibility.actions.fixture.ts')},define:{'process.env.NODE_ENV':'"development"','process.env':'{}'}});
execFileSync(process.execPath,[require.resolve('tailwindcss/lib/cli'),'-i','app/globals.css','-o',join(output,'styles.css')],{cwd:repository});
writeFileSync(join(output,'index.html'),'<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
(async()=>{
 const server=createServer((req,res)=>{const name=['/bundle.js','/styles.css'].includes(req.url)?req.url.slice(1):'index.html';res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(join(output,name)));});let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true});
  for(const [width,height] of [[1440,900],[768,700],[390,700],[320,568]]){
   const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('tab',{name:/Tagesordnung/}).waitFor();
   const fits=async()=>{
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`horizontal overflow at ${width}`);
    const clipped=await page.locator('main button,main a[class*=btn-]').evaluateAll(elements=>elements.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.x<0||r.right>innerWidth+1||el.scrollWidth>el.clientWidth+1);}).map(el=>el.textContent));
    assert.deepEqual(clipped,[],`clipped actions at ${width}`);
   };
   const alignedActions=async()=>{
    const mismatches=await page.locator('button[aria-label^="Status für "]').evaluateAll(buttons=>buttons.flatMap(button=>{
     const status=button.closest('[data-live-refresh-block]'),group=status.parentElement;
     const controls=Array.from(group.children).flatMap(child=>child===status?[button]:child.matches('button,a[class*=btn-]')?[child]:[]);
     const first=button.getBoundingClientRect();
     return controls.filter(control=>{const r=control.getBoundingClientRect();return Math.abs(r.top-first.top)<1&&Math.abs(r.height-first.height)>1;}).map(control=>({label:control.textContent,status:first.height,height:control.getBoundingClientRect().height}));
    }));
    assert.deepEqual(mismatches,[],`unequal adjacent action heights at ${width}`);
   };
   const grantSelect=await page.getByRole('button',{name:'Testfreigabe',exact:true}).boundingBox();
   const grantSave=await page.getByRole('button',{name:'Freigabe speichern',exact:true}).boundingBox();
   assert.ok(Math.abs(grantSelect.height-grantSave.height)<=1,'compact form submit must match select height');
   // Verify hit testing, not just DOM visibility: every option must be clickable outside clipped ancestors.
   const reachable=async menu=>{await menu.waitFor();const box=await menu.evaluate(el=>{const r=(el.closest('[data-app-popover]')??el).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,'menu outside viewport');await menu.getByRole('option').last().scrollIntoViewIfNeeded();assert.ok(await menu.getByRole('option').last().evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'last option clipped or covered');};
   const lastStatus=page.getByRole('button',{name:/^Status für /}).last();await lastStatus.scrollIntoViewIfNeeded();await lastStatus.click();await reachable(page.getByRole('listbox'));await page.screenshot({path:join(output,`status-${width}.png`)});await page.getByRole('option',{name:'Zurückgezogen',exact:true}).click();await alignedActions();assert.equal(await lastStatus.textContent(),'Zurückgezogen');await fits();
   for(const tab of ['Vorschläge','Vertagt','Zurückgezogen']){await page.getByRole('tab',{name:new RegExp('^'+tab)}).click();await fits();if(tab==='Vorschläge'){await alignedActions();await lastStatus.click();await reachable(page.getByRole('listbox'));await page.keyboard.press('Escape');}}
   await page.getByRole('tab',{name:/Tagesordnung/}).click();await page.getByRole('button',{name:'In andere Sitzung übernehmen',exact:true}).last().click();await page.getByRole('button',{name:'Zielsitzung',exact:true}).click();await reachable(page.getByRole('listbox'));await page.getByRole('option').last().click();assert.equal(await page.getByRole('dialog').isVisible(),true);await page.getByRole('button',{name:'Schließen',exact:true}).click();
   await page.getByRole('button',{name:'Neue Sitzung',exact:true}).click();const modal=page.getByRole('dialog',{name:'Sitzung anlegen',exact:true});
   await modal.getByRole('button',{name:'Einreichungsfrist (Europe/Berlin): Datum',exact:true}).click();const calendar=page.getByRole('dialog',{name:'Einreichungsfrist (Europe/Berlin): Datum: Kalender',exact:true});await calendar.waitFor();let box=await calendar.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,'calendar outside viewport');assert.ok(await calendar.getByRole('button',{name:'Heute',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));await page.screenshot({path:join(output,`calendar-${width}.png`)});await calendar.getByRole('button',{name:'Heute',exact:true}).click();
   await modal.getByRole('button',{name:'Einreichungsfrist (Europe/Berlin): Minute',exact:true}).click();await reachable(page.getByRole('listbox'));await page.getByRole('option',{name:'59',exact:true}).click();assert.equal(await modal.isVisible(),true);
   await modal.getByRole('button',{name:'Sitzungsstatus',exact:true}).click();await reachable(page.getByRole('listbox'));await page.keyboard.press('Escape');assert.equal(await modal.isVisible(),true);await modal.getByRole('button',{name:'Schließen',exact:true}).click();
   await page.getByRole('button',{name:'TOP anlegen',exact:true}).click();const topicModal=page.getByRole('dialog',{name:'Thema einreichen',exact:true});await topicModal.getByRole('button',{name:'TOP-Status',exact:true}).click();await reachable(page.getByRole('listbox'));await page.keyboard.press('Escape');await topicModal.getByRole('button',{name:'Schließen',exact:true}).click();
   await page.getByRole('button',{name:'Zielspalte beim Einplanen',exact:true}).click();await reachable(page.getByRole('listbox'));await page.keyboard.press('Escape');await fits();
   await page.locator('input[type=file]').setInputFiles({name:'Sitzungsunterlage'.repeat(18)+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('fixture')});await fits();
   await page.getByRole('button',{name:'Lesend ansehen',exact:true}).click();assert.equal(await page.getByRole('button',{name:/^Status für /}).count(),0);await page.getByRole('button',{name:'TOP vorschlagen',exact:true}).click();assert.equal(await page.getByRole('button',{name:'TOP-Status',exact:true}).count(),0);await page.getByRole('button',{name:'Art',exact:true}).click();await reachable(page.getByRole('listbox'));await page.keyboard.press('Escape');await page.getByRole('button',{name:'Schließen',exact:true}).click();await fits();
   await page.screenshot({path:join(output,`reader-${width}.png`),fullPage:true});
   if(width===768){await page.addStyleTag({content:'html{font-size:200%}'});await fits();await page.getByRole('button',{name:'Planung ansehen',exact:true}).click();await page.getByRole('tab',{name:/Tagesordnung/}).click();await alignedActions();await lastStatus.click();await reachable(page.getByRole('listbox'));await page.keyboard.press('Escape');await fits();await page.screenshot({path:join(output,'text-200.png')});}
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS meeting menu hit testing, status changes, tabs, transfers, calendars, time selectors, topic dialogs, finance settings, long texts/uploads, reader/writer at 1440/768/390/320px. Screenshots: '+output);
 }catch(error){const page=browser?.contexts().flatMap(c=>c.pages()).at(-1);if(page)await page.screenshot({path:join(output,'failure.png')});console.log('Screenshots: '+output);throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
