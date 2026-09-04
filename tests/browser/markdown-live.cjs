// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { mkdtempSync, writeFileSync, readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { execFileSync } = require("node:child_process");
const repository = resolve(__dirname, "../..");
const output = mkdtempSync(join(tmpdir(), "gremio-live-browser-"));
require("esbuild").buildSync({
  entryPoints: [join(__dirname, "markdown-live.fixture.tsx")],
  bundle: true, outfile: join(output, "bundle.js"), jsx: "automatic", absWorkingDir: repository,
  alias: { react: join(repository, "node_modules/react"), "react-dom": join(repository, "node_modules/react-dom") },
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" }
});
execFileSync(process.execPath, [require.resolve("tailwindcss/lib/cli"), "-i", "app/globals.css", "-o", join(output, "styles.css")], { cwd: repository });
writeFileSync(join(output, "index.html"), '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css"><body><div id="root"></div><script src="bundle.js"></script></body></html>');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined,headless:true});
 const picture = await require('sharp')({create:{width:400,height:200,channels:4,background:'#447799'}}).png().toBuffer();
 const server = createServer((request,response)=>{
  const path = new URL(request.url,'http://localhost').pathname;
  if(path.startsWith('/api/protokolle/') && path.endsWith('/image')){response.writeHead(200,{'Content-Type':'image/png'});response.end(picture);return;}
  const name = path==='/'?'index.html':path.slice(1);
  if(!['index.html','styles.css','bundle.js'].includes(name)){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html'});response.end(readFileSync(join(output,name)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const baseUrl = `http://127.0.0.1:${server.address().port}/`;
 try {
 for (const width of [1500,600,390]) {
  const page=await browser.newPage({viewport:{width,height:900}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseUrl);
  await page.getByRole('button',{name:'Dokument durchsuchen',exact:true}).waitFor();
  await page.keyboard.press('ControlOrMeta+f');await page.getByRole('searchbox',{name:'Im Dokument suchen',exact:true}).waitFor();
  await page.getByRole('searchbox',{name:'Im Dokument suchen',exact:true}).press('Escape');
  const raw=page.getByRole('textbox',{name:'Markdown-Dokument',exact:true});
  const set=async text=>{await page.getByRole('button',{name:'Bearbeiten',exact:true}).click();await raw.fill(text);await page.getByRole('button',{name:'Live Vorschau',exact:true}).click();};
  const source=async()=>{await page.getByRole('button',{name:'Bearbeiten',exact:true}).click();const text=await raw.inputValue();await page.getByRole('button',{name:'Live Vorschau',exact:true}).click();return text;};
  const line=i=>page.locator(`[data-markdown-line="${i}"] [contenteditable]`).first();
  const select=async(locator,start,end=start)=>locator.evaluate((el,{start,end})=>{el.focus();const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;const nodes=[];while(n=walker.nextNode())nodes.push(n);const at=pos=>{for(const n of nodes){if(pos<=n.length)return[n,pos];pos-=n.length;}return[el,el.childNodes.length];};const r=document.createRange();r.setStart(...at(start));r.setEnd(...at(end));const s=getSelection();s.removeAllRanges();s.addRange(r);},{start,end});
  const searchSource = '---\nort: Suchbegriff\n---\n# Bericht\nEin **Such**begriff steht hier.\n\n' + Array.from({length:30},(_,i)=>`Absatz ${i}`).join('\n\n') + '\n\n| Suchbegriff | Wert |\n| --- | --- |\n| SUCHBEGRIFF | 42 |\n<!-- Suchbegriff -->';
  await set(searchSource);
  const header = page.locator('header');
  const expandedHeight = await header.evaluate(el=>el.getBoundingClientRect().height);
  await page.screenshot({path:join(output,`header-expanded-${width}.png`)});
  await page.getByRole('button',{name:'Kopfbereich ausblenden',exact:true}).click();
  const expand = page.getByRole('button',{name:'Kopfbereich einblenden',exact:true});
  assert.equal(await page.locator('#document-header-controls').isVisible(),false);
  assert.equal(await page.getByRole('button',{name:'Speichern',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Neu laden',exact:true}).count(),0);
  assert.equal(await page.getByRole('group',{name:'Editoransicht',exact:true}).isVisible(),true);
  const toolbarOrder = await page.locator('[data-document-toolbar] button').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('aria-label')||el.textContent));
  assert.deepEqual(toolbarOrder.slice(0,5),['Live Vorschau','Bearbeiten','Vorschau','Dokument durchsuchen','Überschrift 1']);
  assert.ok(toolbarOrder.includes('Tabellen'));
  const collapsedHeight = await header.evaluate(el=>el.getBoundingClientRect().height);
  assert.ok(collapsedHeight<=54 && expandedHeight-collapsedHeight>=40,`header did not collapse: ${expandedHeight} -> ${collapsedHeight}`);
  await page.locator('[data-document-toolbar-scroll]').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  assert.ok(await expand.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;}),'toggle must not scroll away with the formatting tools');
  const sidebarToggle = page.getByRole('button',{name:width>=768?'Werkzeuge ausblenden':'Werkzeuge',exact:true});
  assert.ok(await sidebarToggle.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;}));
  await sidebarToggle.click();await page.getByRole('button',{name:width>=768?'Werkzeuge einblenden':'Schließen',exact:true}).click();
  await select(line(4),0,3);await page.getByRole('button',{name:'Fettdruck',exact:true}).click();assert.equal(await line(4).locator('strong').first().innerText(),'Ein');await line(4).press('ControlOrMeta+z');
  await page.locator('[data-document-content]').evaluate(el=>{el.scrollTop=700;});
  assert.equal(await header.evaluate(el=>el.getBoundingClientRect().top),0);
  await page.keyboard.press('ControlOrMeta+s');
  assert.equal(await page.evaluate(()=>window.saved.at(-1).text),searchSource);
  await page.keyboard.press('ControlOrMeta+f');
  await page.getByRole('searchbox',{name:'Im Dokument suchen',exact:true}).fill('Bericht');
  await page.getByRole('search').getByText('1 von 1',{exact:true}).waitFor();
  await page.getByRole('searchbox',{name:'Im Dokument suchen',exact:true}).press('Escape');
  assert.equal(await page.getByRole('button',{name:'Dokument durchsuchen',exact:true}).evaluate(el=>document.activeElement===el),true);
  await page.screenshot({path:join(output,`header-collapsed-${width}.png`)});
  await expand.press('Enter');assert.equal(await page.locator('#document-header-controls').isVisible(),true);
  await page.getByRole('button',{name:'Vorschau',exact:true}).click();await page.getByRole('button',{name:'Kopfbereich ausblenden',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Überschrift 1',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Kopfbereich einblenden',exact:true}).click();
  assert.equal(await source(),searchSource);
  console.log(`PASS ${width}: compact header ${expandedHeight}px / collapsed ${collapsedHeight}px, fixed toggle, search/save shortcuts`);
  await set(searchSource);await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.keyboard.press('ControlOrMeta+f');
  const find = page.getByRole('searchbox',{name:'Im Dokument suchen',exact:true});
  const search = page.getByRole('search',{name:'Dokument durchsuchen',exact:true});
  assert.equal(await find.evaluate(el=>document.activeElement===el),true);
  await find.fill('suchbegriff');await search.getByText('1 von 3',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>CSS.highlights.get('document-search').size),3);
  assert.equal(await page.evaluate(()=>document.querySelector('style[data-document-search-styles]').sheet.cssRules.length),2);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('[data-markdown-text]'),'::highlight(document-search-active)').backgroundColor),'rgb(251, 191, 36)');
  assert.equal(await page.evaluate(()=>[...CSS.highlights.get('document-search-active')][0].toString()),'Suchbegriff');
  await find.press('Enter');await search.getByText('2 von 3',{exact:true}).waitFor();
  assert.ok(await page.locator('[data-document-content]').evaluate(el=>el.scrollTop)>400);
  assert.equal(await find.evaluate(el=>document.activeElement===el),true);
  await find.press('Shift+Enter');await search.getByText('1 von 3',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Vorheriger Treffer',exact:true}).click();await search.getByText('3 von 3',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Nächster Treffer',exact:true}).click();await search.getByText('1 von 3',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Vorschau',exact:true}).click();await search.getByText('1 von 3',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-markdown-renderer] [contenteditable="true"]').count(),0);
  await page.keyboard.press('ControlOrMeta+f');assert.equal(await find.evaluate(el=>document.activeElement===el),true);
  await find.fill('KeinTreffer');await search.getByText('Keine Treffer',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Nächster Treffer',exact:true}).isDisabled(),true);
  await find.fill('suchbegriff');await page.getByRole('button',{name:'Bearbeiten',exact:true}).click();await search.getByText('1 von 4',{exact:true}).waitFor();
  assert.equal(await raw.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),'Suchbegriff');
  assert.equal(await page.locator('[data-document-search-overlay] span').count(),1);
  assert.equal(await raw.inputValue(),searchSource);
  assert.equal(await page.locator('header').getByRole('status').first().innerText(),'Gespeichert');
  await page.screenshot({path:join(output,`search-source-${width}.png`)});
  await raw.fill('Kurz');await search.getByText('Keine Treffer',{exact:true}).waitFor();
  await find.press('Escape');assert.equal(await search.count(),0);
  assert.equal(await page.evaluate(()=>CSS.highlights.has('document-search')),false);
  assert.equal(await page.locator('style[data-document-search-styles]').count(),0);
  assert.equal(await page.getByRole('button',{name:'Dokument durchsuchen',exact:true}).evaluate(el=>document.activeElement===el),true);
  console.log(`PASS ${width}: document search, inline/table hits, keyboard navigation, raw YAML search, no mutation, cleanup`);
  await page.evaluate(()=>{window.originalHighlight=window.Highlight;window.Highlight=undefined;});
  await set(searchSource);await page.getByRole('button',{name:'Dokument durchsuchen',exact:true}).click();await find.fill('suchbegriff');await search.getByText('1 von 3',{exact:true}).waitFor();
  await find.press('Enter');await search.getByText('2 von 3',{exact:true}).waitFor();
  const fallback = page.locator('[data-document-search-overlay] span').first();await fallback.waitFor();
  await page.waitForFunction(()=>{const el=document.querySelector('[data-document-search-overlay] span');if(!el)return false;const rect=el.getBoundingClientRect();const bounds=document.querySelector('[data-document-content]').getBoundingClientRect();return rect.top>=bounds.top && rect.bottom<=bounds.bottom;},null,{timeout:3000});
  await find.press('Escape');assert.equal(await page.locator('[data-document-search-overlay]').count(),0);await page.evaluate(()=>{window.Highlight=window.originalHighlight;delete window.originalHighlight;});
  const layoutSource = [
    '---', 'ort: Test', '---', '# Titel', '', '## Tagesordnung', '', '### Details',
    'Ein Absatz mit **Fettdruck**, *Kursiv*, <u>Unterstrichen</u>, `Code` und [Link](https://example.invalid).',
    'Ein längerer Absatz mit mehreren Wörtern, der auf schmalen Ansichten umbricht und dabei in beiden Modi exakt dieselbe Höhe behalten muss.',
    '', '', '- Erster Listenpunkt', '- Zweiter Listenpunkt mit etwas mehr Text und einem möglichen Zeilenumbruch',
    '1. Nummerierter Punkt', '2. Noch ein Punkt', '> Ein Zitat mit **Formatierung**', '',
    '| Name | Zugehörigkeit | Anliegen |', '| --- | --- | --- |', '| Anna | StuRa | Mehrzeiliger Inhalt durch automatischen Textumbruch |', '|  |  |  |',
    '', '```md', '# Keine Überschrift im Code', '**Kein Fett im Code**', '```',
    '<!-- versteckter', 'Kommentar -->', '', 'Schluss', ''
  ].join('\n');
  await set(layoutSource);
  await page.locator('[data-document-content]').evaluate(el=>{el.scrollTop=0;});
  const rendered = page.locator('[data-markdown-renderer]');
  const geometry = () => rendered.evaluate(root => {
    const bounds = root.getBoundingClientRect();
    return [...root.querySelectorAll('[data-markdown-line], [data-markdown-text], th, td')].map(el => {
      const rect = el.getBoundingClientRect(); const style = getComputedStyle(el);
      return { text: el.textContent, x: rect.x - bounds.x, y: rect.y - bounds.y, width: rect.width, height: rect.height,
        font: style.font, whiteSpace: style.whiteSpace, padding: style.padding, margin: style.margin, border: style.border };
    });
  });
  const liveGeometry = await geometry();
  const liveImage = await rendered.screenshot({path:join(output, `layout-live-${width}.png`)});
  await page.getByRole('button',{name:'Vorschau',exact:true}).click();
  assert.equal(await rendered.locator('[contenteditable="true"]').count(),0,'preview must be read-only');
  assert.equal(await rendered.getByRole('link',{name:'Link',exact:true}).getAttribute('href'),'https://example.invalid');
  assert.deepEqual(await geometry(),liveGeometry,'preview changes text metrics or element geometry');
  const previewImage = await rendered.screenshot({path:join(output, `layout-preview-${width}.png`)});
  assert.ok(liveImage.equals(previewImage),'live and preview screenshots must be pixel-identical without the editing caret');
  await page.getByRole('button',{name:'Live Vorschau',exact:true}).click();
  assert.deepEqual(await geometry(),liveGeometry,'returning to live changes layout');
  const scroller = page.locator('[data-document-content]');
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const scrollTop = await scroller.evaluate(el => el.scrollTop);
  const liveBottom = await scroller.screenshot({path:join(output, `layout-live-bottom-${width}.png`)});
  await page.getByRole('button',{name:'Vorschau',exact:true}).click();
  assert.equal(await scroller.evaluate(el => el.scrollTop),scrollTop,'switching mode changes the scroll position');
  const previewBottom = await scroller.screenshot({path:join(output, `layout-preview-bottom-${width}.png`)});
  assert.ok(liveBottom.equals(previewBottom),'table and code blocks must also render identically at the document end');
  assert.equal(await source(),layoutSource,'mode changes must preserve the Markdown source');
  console.log(`PASS ${width}: identical live/preview geometry and pixels; preview is read-only`);
  await set('# Titel\n\nHallo Welt');
  await select(line(0),5);await page.keyboard.type(' live');
  assert.equal(await line(0).innerText(),'Titel live');assert.equal(await line(0).evaluate(el=>getComputedStyle(el).fontSize),'24px');
  assert.equal(await line(0).evaluate(el=>document.activeElement===el),true);
  await select(line(2),6,10);await page.getByRole('button',{name:'Fettdruck',exact:true}).click();
  assert.equal(await line(2).locator('strong').innerText(),'Welt');
  await select(line(2),8);await page.keyboard.type('XX');assert.equal(await line(2).locator('strong').innerText(),'WeXXlt');
  assert.equal(await source(),'# Titel live\n\nHallo **WeXXlt**');
  await set('');await line(0).click();await page.keyboard.type('**Fett** normal');
  assert.equal(await line(0).locator('strong').innerText(),'Fett');assert.equal(await line(0).innerText(),'Fett normal');
  assert.equal(await source(),'**Fett** normal');
  await set('');await line(0).click();await page.keyboard.type('## Neue Überschrift');
  assert.equal(await line(0).innerText(),'Neue Überschrift');assert.equal(await line(0).evaluate(el=>getComputedStyle(el).fontSize),'20px');
  assert.equal(await source(),'## Neue Überschrift');
  await set('Hallo Welt');await select(line(0),6);await page.keyboard.press('Enter');await page.keyboard.type('Neue ');
  assert.equal(await source(),'Hallo \nNeue Welt');
  await select(line(1),0);await page.keyboard.press('Backspace');assert.equal(await source(),'Hallo Neue Welt');
  await set('- Eins');await select(line(0),4);await page.keyboard.press('Enter');await page.keyboard.type('Zwei');
  assert.equal(await source(),'- Eins\n- Zwei');
  const bullet = page.locator('[data-markdown-line="0"] [data-markdown-bullet]');
  const bulletBounds = await bullet.boundingBox();
  assert.equal(bulletBounds.width,5);assert.equal(bulletBounds.height,5);
  assert.equal(await line(0).evaluate(el=>el.getBoundingClientRect().left)-bulletBounds.x-bulletBounds.width,6);
  await select(line(1),4);await page.keyboard.press('Tab');await page.keyboard.type(' Kind');
  assert.equal(await source(),'- Eins\n    - Zwei Kind');
  const indentLeft = await line(1).evaluate(el=>el.getBoundingClientRect().left);
  assert.ok(indentLeft > await line(0).evaluate(el=>el.getBoundingClientRect().left));
  await page.getByRole('button',{name:'Vorschau',exact:true}).click();
  assert.equal(await page.locator('[data-markdown-line="1"] [data-markdown-text]').evaluate(el=>el.getBoundingClientRect().left),indentLeft);
  await page.getByRole('button',{name:'Live Vorschau',exact:true}).click();
  await select(line(1),9);await page.keyboard.press('Shift+Tab');assert.equal(await source(),'- Eins\n- Zwei Kind');
  await select(line(1),9);await page.keyboard.press('ControlOrMeta+z');assert.equal(await source(),'- Eins\n    - Zwei Kind');
  await select(line(1),9);await page.keyboard.press('Enter');await page.keyboard.type('Drei');assert.equal(await source(),'- Eins\n    - Zwei Kind\n    - Drei');
  await set('1. Eins\n2. Zwei');await select(line(1),4);await page.keyboard.press('Tab');assert.equal(await source(),'1. Eins\n    2. Zwei');
  await page.getByRole('button',{name:'Bearbeiten',exact:true}).click();await raw.fill('A\nB\nC');
  await raw.evaluate(el=>{el.focus();el.setSelectionRange(0,4);});await raw.press('Tab');
  assert.equal(await raw.inputValue(),'    A\n    B\nC');
  assert.deepEqual(await raw.evaluate(el=>[el.selectionStart,el.selectionEnd]),[4,12]);
  await raw.press('Shift+Tab');assert.equal(await raw.inputValue(),'A\nB\nC');
  console.log(`PASS ${width}: Tab/Shift+Tab indentation, list continuation, caret, undo and preview alignment`);
  await set('**Hallo Welt**');await select(line(0),6);await page.keyboard.press('Enter');
  assert.equal(await source(),'**Hallo** \n**Welt**');
  await set('# Heading');await select(line(0),0);await page.keyboard.press('Backspace');assert.equal(await source(),'Heading');
  await set('ABC');await select(line(0),3);await page.keyboard.type('D');await page.keyboard.press('ControlOrMeta+z');assert.equal(await line(0).innerText(),'ABC');await page.keyboard.press('ControlOrMeta+Shift+z');assert.equal(await line(0).innerText(),'ABCD');
  await set('---\nort: Test\n---\n# Heading\n\nText\n<!-- gremio:marker -->');await select(line(5),4);await page.keyboard.type(' live');assert.equal(await source(),'---\nort: Test\n---\n# Heading\n\nText live\n<!-- gremio:marker -->');
  await set('---\nort: Test\n---\nText');await select(line(3),0);await page.keyboard.press('Backspace');assert.equal(await source(),'---\nort: Test\n---\nText');
  await set('Hallo Welt');await select(line(0),6);await line(0).evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertParagraph'})));assert.equal(await source(),'Hallo \nWelt');
  await set('');await line(0).click();await line(0).evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','<img src=x onerror="alert(1)">');data.setData('text/html','<img src=x onerror="alert(1)">');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});assert.equal(await line(0).locator('img').count(),0);assert.equal(await source(),'<img src=x onerror="alert(1)">');
  await set('Text');await select(line(0),4);await page.getByRole('button',{name:'Tabellen',exact:true}).click();
  const assertPickerPosition = async () => {
    await page.waitForFunction(() => {
      const triggerNode = document.querySelector('[data-document-toolbar] button[aria-controls][aria-expanded="true"]');
      const picker = document.getElementById(triggerNode?.getAttribute('aria-controls') ?? '')?.getBoundingClientRect();
      const trigger = triggerNode?.getBoundingClientRect();
      const toolbar = document.querySelector('[data-document-toolbar]')?.getBoundingClientRect();
      if (!picker || !trigger || !toolbar) return false;
      const expectedLeft = Math.max(toolbar.left + 8, Math.min(trigger.left, toolbar.right - picker.width - 8));
      return Math.abs(picker.left - expectedLeft) < 1 && Math.abs(picker.top - trigger.bottom - 4) < 1 && picker.right <= innerWidth;
    }, null, {timeout:3000});
  };
  await assertPickerPosition();
  if (width < 1000) {
    await page.locator('[data-document-toolbar-scroll]').evaluate(el=>{el.scrollLeft-=40;});
    await assertPickerPosition();
  }
  await page.screenshot({path:join(output,`table-picker-${width}.png`)});
  await page.getByRole('button',{name:'2 Spalten, 2 Datenzeilen',exact:true}).click();assert.equal(await raw.count(),0);assert.equal(await page.getByRole('textbox',{name:'Markdown-Tabellenzelle',exact:true}).count(),6);await page.keyboard.type('Name');assert.equal(await page.getByRole('textbox',{name:'Markdown-Tabellenzelle',exact:true}).first().innerText(),'Name');
  await set('| Name | Zugehörigkeit | Anliegen |\n| --- | --- | --- |\n| Anna | StuRa | Hallo |\n|  |  |  |\n\nEnde');
  const cells=page.getByRole('textbox',{name:'Markdown-Tabellenzelle',exact:true});
  assert.equal(await cells.count(),9);await select(cells.nth(4),5);await page.keyboard.type(' live');
  assert.equal(await cells.nth(4).innerText(),'StuRa live');assert.equal(await cells.nth(3).innerText(),'Anna');
  assert.equal(await cells.nth(4).evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('Tab');assert.equal(await cells.nth(5).evaluate(el=>document.activeElement===el),true);
  await select(cells.nth(6),0);await page.keyboard.type('Ben');assert.equal(await cells.nth(6).innerText(),'Ben');
  await page.keyboard.press('Shift+Tab');assert.equal(await cells.nth(5).evaluate(el=>document.activeElement===el),true);
  const table=await source();assert.ok(table.includes('| Anna | StuRa live | Hallo |'));assert.ok(table.includes('Ben'));assert.equal(table.split('\n').length,6);
  await select(cells.nth(5),5);await page.keyboard.type('|Text');assert.equal(await cells.count(),9);assert.equal(await cells.nth(5).innerText(),'Hallo|Text');assert.ok((await source()).includes('Hallo\\|Text'));
  await select(cells.nth(4),0,5);await page.getByRole('button',{name:'Unterstrichen',exact:true}).click();assert.equal(await cells.nth(4).locator('u').innerText(),'StuRa');
  await page.getByRole('button',{name:'Speichern',exact:true}).click();assert.ok((await page.evaluate(()=>window.saved.at(-1).text)).includes('<u>StuRa</u> live'));
  await page.screenshot({path:join(output, `rich-${width}.png`)});
  await select(cells.nth(4),0);await page.keyboard.press('ArrowDown');assert.equal(await cells.nth(7).evaluate(el=>document.activeElement===el),true);
  await select(cells.nth(8),0);await page.keyboard.press('Tab');assert.equal(await cells.count(),12);await page.keyboard.type('Neue Zeile');assert.equal(await cells.nth(9).innerText(),'Neue Zeile');
  await set('| Name | Wert |\n| --- | --- |');await select(cells.nth(1),4);await page.keyboard.press('Tab');await page.keyboard.type('Anna');assert.equal(await source(),'| Name | Wert |\n| --- | --- |\n| Anna |  |');
  assert.deepEqual(errors,[]);console.log(`PASS ${width}: live characters, heading, inline typing, cell editing, table navigation, source preservation, save`);
  await page.goto(baseUrl+'?images');
  await set('VorNach');await select(line(0),3);
  await page.getByRole('button',{name:'Bild einfügen',exact:true}).click();
  await page.getByLabel('Bild auswählen',{exact:true}).setInputFiles({name:'Testbild.png',mimeType:'image/png',buffer:picture});
  await page.waitForFunction(()=>typeof window.releaseImageUpload==='function');
  await select(line(0),7);await page.keyboard.type('X');
  await page.evaluate(()=>window.releaseImageUpload());
  const pictureElement = page.locator('[data-markdown-renderer] img');
  await pictureElement.waitFor();await pictureElement.evaluate(img=>img.decode());
  const inserted = 'Vor\n\n![Testbild](attachments/Testbild.png)\n\nNachX';
  assert.equal(await source(),inserted);
  assert.equal(new URL(await pictureElement.getAttribute('src'),baseUrl).searchParams.get('folder'),'Anlagen/attachments');
  await pictureElement.hover();
  const corner = page.getByRole('button',{name:'Bild skalieren: unten rechts',exact:true});
  await corner.waitFor();
  const imageBefore = await pictureElement.boundingBox();const handle = await corner.boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2-60,handle.y+handle.height/2-30,{steps:8});await page.mouse.up();
  const imageWidth = Math.round(imageBefore.width)-60;
  const resized = inserted.replace('(attachments/Testbild.png)',`(attachments/Testbild.png){width=${imageWidth}}`);
  assert.equal(await source(),resized);
  const liveBounds = await pictureElement.boundingBox();assert.ok(Math.abs(liveBounds.width-imageWidth)<1);assert.ok(Math.abs(liveBounds.width/liveBounds.height-2)<0.01);
  await page.getByRole('button',{name:'Vorschau',exact:true}).click();assert.deepEqual(await pictureElement.boundingBox(),liveBounds);assert.equal(await page.locator('[data-image-resize]').count(),0);
  await page.getByRole('button',{name:'Live Vorschau',exact:true}).click();
  await line(4).click();await page.keyboard.press('ControlOrMeta+z');assert.equal(await source(),inserted);
  await line(4).click();await page.keyboard.press('ControlOrMeta+Shift+z');assert.equal(await source(),resized);
  await page.getByRole('button',{name:'Speichern',exact:true}).click();assert.equal(await page.evaluate(()=>window.saved.at(-1).text),resized);
  await page.screenshot({path:join(output,`image-resized-${width}.png`)});
  await page.getByRole('button',{name:'Bild einfügen',exact:true}).click();await page.getByLabel('Bild auswählen',{exact:true}).setInputFiles({name:'bad.png',mimeType:'image/png',buffer:picture});
  await page.getByRole('alert').filter({hasText:'Test-Upload fehlgeschlagen'}).waitFor();assert.equal(await source(),resized);
  console.log(`PASS ${width}: image upload without lost typing, relative folder URL, corner resizing, persisted width, preview parity, undo/redo and failure safety`);
  const pasteImage = async (locator, name='clipboard.png') => locator.evaluate((element,{base64,name})=>{
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(base64),char=>char.charCodeAt(0))],name,{type:'image/png'}));
    data.setData('text/plain','Do not paste this image fallback');
    data.setData('text/html','<img src="https://example.invalid/clipboard.png">');
    return element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  },{base64:picture.toString('base64'),name});
  await set('LinksRechts');await select(line(0),5);
  let uploadsBefore = await page.evaluate(()=>window.imageUploads.length);
  assert.equal(await pasteImage(line(0)),false);
  await page.waitForFunction(count=>window.imageUploads.length===count+1,uploadsBefore);
  assert.equal(await line(0).innerText(),'LinksRechts');
  // A second paste during the upload must not insert its HTML/text fallback.
  await pasteImage(line(0));assert.equal(await page.evaluate(()=>window.imageUploads.length),uploadsBefore+1);
  await select(line(0),11);await page.keyboard.type('!');
  await page.evaluate(()=>window.releaseImageUpload());await pictureElement.waitFor();
  const pasted = 'Links\n\n![Testbild](attachments/Testbild.png)\n\nRechts!';
  assert.equal(await source(),pasted);
  await line(4).click();await page.keyboard.press('ControlOrMeta+z');assert.equal(await source(),'LinksRechts!');
  await page.getByRole('button',{name:'Bearbeiten',exact:true}).click();await raw.fill('AB');
  await raw.evaluate(el=>{el.focus();el.setSelectionRange(1,1);});
  uploadsBefore = await page.evaluate(()=>window.imageUploads.length);
  assert.equal(await pasteImage(raw),false);
  await page.waitForFunction(count=>window.imageUploads.length===count+1,uploadsBefore);
  assert.equal(await raw.inputValue(),'AB');await page.evaluate(()=>window.releaseImageUpload());
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Markdown-Dokument"]').value.includes('attachments/Testbild.png'));
  assert.equal(await raw.inputValue(),'A\n\n![Testbild](attachments/Testbild.png)\n\nB');
  await raw.fill('Unverändert');await raw.evaluate(el=>el.select());await pasteImage(raw,'bad.png');
  await page.getByRole('alert').filter({hasText:'Test-Upload fehlgeschlagen'}).waitFor();assert.equal(await raw.inputValue(),'Unverändert');
  await page.getByRole('button',{name:'Vorschau',exact:true}).click();
  uploadsBefore = await page.evaluate(()=>window.imageUploads.length);
  await pasteImage(page.locator('[data-markdown-renderer]'));assert.equal(await page.evaluate(()=>window.imageUploads.length),uploadsBefore);
  await set('Normal');await select(line(0),6);
  await line(0).evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','er Text');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  assert.equal(await source(),'Normaler Text');
  console.log(`PASS ${width}: clipboard images in live/raw mode, fresh caret, no fallback text, busy/error safety, undo and ordinary text paste`);
  await page.goto(baseUrl+'?protocol');
  await page.getByRole('heading',{name:'Protokoll.md',exact:true}).waitFor();
  const actions = await page.locator('#document-header-controls button').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('aria-label')||el.textContent));
  assert.deepEqual(actions,['Speichern','Neu laden','Protokoll exportieren','Sitzungsdaten']);
  for(const name of ['Speichern','Neu laden','Protokoll exportieren','Sitzungsdaten'])assert.equal(await page.getByRole('button',{name,exact:true}).evaluate(el=>el.getBoundingClientRect().height),32);
  await page.screenshot({path:join(output,`protocol-header-expanded-${width}.png`)});
  await page.getByRole('button',{name:'Kopfbereich ausblenden',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Sitzungsdaten',exact:true}).count(),0);
  await page.getByRole('button',{name:'Kopfbereich einblenden',exact:true}).click();
  await page.getByRole('button',{name:'Speichern',exact:true}).click();
  await page.getByRole('button',{name:'Protokoll exportieren',exact:true}).click();await page.getByRole('textbox',{name:'PDF-Dateiname',exact:true}).waitFor();
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
  assert.deepEqual(errors,[]);
  await page.close();
 }
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));console.log(`Browser artifacts: ${output}`);}
})().catch(e=>{console.error(e);process.exitCode=1});
