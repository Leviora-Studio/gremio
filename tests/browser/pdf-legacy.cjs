// Serves the user-supplied PDF on loopback only. Never uploads or rewrites it.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdtempSync, writeFileSync, readFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const repository = resolve(__dirname, '../..');
const sample = process.env.PDF_LEGACY_SAMPLE;
if (!sample) throw new Error('Set PDF_LEGACY_SAMPLE to the local legacy PDF to inspect.');
const original = readFileSync(sample);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = mkdtempSync(join(tmpdir(), 'gremio-pdf-legacy-browser-'));
(async () => {
  const fields = JSON.parse(execFileSync(process.execPath, ['--import','tsx','-e',
    'const fs=require("fs");const {readPdfFields}=require("./lib/pdf-edit.ts");readPdfFields(fs.readFileSync(process.env.PDF_LEGACY_SAMPLE)).then(f=>process.stdout.write(JSON.stringify(f)));'
  ], { cwd: repository, encoding:'utf8' }));
  await require('esbuild').build({ entryPoints:[join(__dirname,'pdf-legacy.fixture.tsx')], bundle:true, format:'esm', outfile:join(output,'bundle.js'), jsx:'automatic', absWorkingDir:repository, define:{'process.env.NODE_ENV':'"development"'}, plugins:[{name:'local-actions',setup(build){
    build.onResolve({filter:/app\/intern\/card\/\[id\]\/pdf-actions$/},()=>({path:'actions',namespace:'fixture'}));
    build.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='actions'?'export const savePdfEditsAction = async () => ({ok:false,error:"Disabled in sample test"});':'export const useRouter = () => ({refresh(){}});',loader:'js'}));
  }}] });
  execFileSync(process.execPath,[require.resolve('tailwindcss/lib/cli'),'-i','app/globals.css','-o',join(output,'styles.css')],{cwd:repository});
  writeFileSync(join(output,'index.html'),'<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
  const server = createServer((req,res)=>{
    const path = new URL(req.url,'http://localhost').pathname;
    if(path==='/fields'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({fields}));return;}
    if(path==='/original.pdf'){res.setHeader('Content-Type','application/pdf');res.end(original);return;}
    if(path.endsWith('/pdf.worker.min.mjs')){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')));return;}
    const file = {'/':'index.html','/bundle.js':'bundle.js','/styles.css':'styles.css'}[path];
    if(!file){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(join(output,file)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || undefined,headless:true});
  try {
    for(const width of [1400,390]) {
      const page = await browser.newPage({viewport:{width,height:1100}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('.react-pdf__Page canvas').first().waitFor();
      await page.locator('[title^="Feld: "] textarea').first().waitFor();
      const texts = fields.filter(f=>f.type==='text'&&!f.readOnly&&!f.gremioText);
      assert.equal(await page.locator('[title^="Feld: "] textarea').count(),texts.reduce((n,f)=>n+f.widgets.length,0));
      for(const field of texts) {
        const matching=page.locator(`[title=${JSON.stringify('Feld: '+field.name)}] textarea`);
        assert.equal(await matching.count(),field.widgets.length);
        for(const input of await matching.all()) assert.equal(await input.inputValue(),field.value);
      }
      for(const field of fields.filter(f=>f.type==='radio')) {
        assert.equal(await page.locator(`input[type=radio][name=${JSON.stringify('rg-'+field.name)}]`).count(),field.optionWidgets.length);
        assert.equal(await page.locator(`input[type=radio][name=${JSON.stringify('rg-'+field.name)}]:checked`).count(),field.optionWidgets.some(w=>w.value===field.value)?1:0);
      }
      assert.ok(fields.every(f=>f.widgets?.length||f.optionWidgets?.length),'all sample fields have positions');
      for(let i=0;i<await page.locator('.react-pdf__Page').count();i++) {
        await page.locator('.react-pdf__Page').nth(i).locator('..').screenshot({path:join(output,`page-${i+1}-${width}.png`)});
      }
      await page.screenshot({path:join(output,`editor-${width}.png`)});
      assert.deepEqual(errors,[]);await page.close();
    }
    assert.equal(hash(readFileSync(sample)),hash(original),'original PDF remains byte-for-byte unchanged');
    console.log(`Legacy PDF browser checks passed: ${output}`);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
