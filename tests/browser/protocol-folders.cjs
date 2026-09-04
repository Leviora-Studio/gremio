// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const repository = resolve(__dirname, "../..");
const output = mkdtempSync(join(tmpdir(), "gremio-folders-browser-"));
const mocks = {
  "next/link": "export default function Link(props) { return <a {...props}/>; }",
  "next/navigation": "export function notFound() { throw Error('Not found'); } export const useRouter = () => ({push:href=>{window.openedDocument=href;}});",
  "@/lib/db": "export const db = { select() { throw Error('Unexpected template query'); } };",
  "@/lib/db/schema": "export const protocolTemplates = {};",
  "@/lib/nextcloud": "export function nextcloudBrowserUrl(url,path) { return url + '?path=' + encodeURIComponent(path); }",
  "@/lib/markdown-documents": "export const isMarkdownFilename = name => /\\.(md|markdown)$/i.test(name);",
  "@/components/protocols/CreateProtocolForm": "export const CreateProtocolForm = () => <div>Create protocol</div>;",
  "@/components/DeleteConfirm": "export const DeleteConfirm = () => <button>Datei löschen</button>;",
  "@/components/pdf/AttachmentLink": "export const AttachmentLink = props => <a href={props.src} data-fields-url={props.fieldsUrl}>{props.filename}</a>;",
  "../../../actions": "export const createProtocolForSessionAction = async () => ({}); export const deleteProtocolFileAction = async () => ({});",
  "../../../file-actions": `export const saveProtocolPdfEditsAction = async () => ({ok:true});
    export async function createProtocolMarkdownFileAction(areaId, sessionId, folderName, subfolder, data) {
      const name = data.get('filename');
      if (name === 'Existing.md') return {error:'Eine Datei mit diesem Namen existiert bereits.'};
      const filename = name.endsWith('.md') ? name : name+'.md';
      window.created.push({areaId,sessionId,folderName,subfolder,filename});
      await window.renderFolder();
      return {filename,href:'/dokumente/'+areaId+'/'+sessionId+'?name='+encodeURIComponent(filename)+(subfolder?'&folder='+encodeURIComponent(subfolder):'')};
    }
    export async function uploadProtocolFileAction(areaId, sessionId, folderName, subfolder, state, data) {
      const file = data.get('file');
      window.uploads.push({areaId, sessionId, folderName, subfolder, filename:file.name, text:await file.text()});
      await window.renderFolder();
      return {success:'Hochgeladen'};
    }`,
  "@/lib/protocols": `
    const area = { id:2, name:'Testbereich', rootPath:'/Protokolle', ncUrl:'https://example.invalid', resultFilePattern:'Ergebnisprotokoll.md' };
    const session = { id:3, folderName:'Sitzung', sessionDate:'2026-09-04', protocolPath:'/Protokolle/Sitzung/Protokoll.md', folderFileId:'folder-3' };
    export const requireProtocolAreaAccess = async () => ({user:{},area});
    export const getProtocolSession = async () => session;
    export const syncProtocolSessionFile = async (a,s) => {window.syncs.push(window.folder);return s;};
    export async function listProtocolSessionFiles(a,s,folder='') {
      const folders = {'':[['Anlagen ä','directory'],['Protokoll.md','file'],['Ergebnisprotokoll.md','file']], 'Anlagen ä':[['Details','directory'],['Notizen.md','file'],['Anlage.pdf','file'],['Bild.png','file']], 'Anlagen ä/Details':[]};
      if (!(folder in folders)) throw Error('Missing folder');
      return [...folders[folder], ...[...window.uploads,...window.created].filter(item=>item.subfolder===folder).map(item=>[item.filename,'file'])].map(([name,type])=>({name,type,path:'/Protokolle/Sitzung/'+(folder?folder+'/':'')+name,fileId:null,mime:null,lastModified:null}));
    }`,
};
(async () => {
  await require("esbuild").build({
    entryPoints: [join(__dirname, "protocol-folders.fixture.jsx")], bundle:true,
    outfile:join(output,"bundle.js"), jsx:"automatic", absWorkingDir:repository,
    plugins:[{name:"local-folder-doubles",setup(build) {
      build.onResolve({filter:/.*/},args => mocks[args.path] ? {path:args.path,namespace:"folder-mock"} : undefined);
      build.onLoad({filter:/.*/,namespace:"folder-mock"},args=>({contents:mocks[args.path],loader:"jsx",resolveDir:repository}));
    }}],
    define:{"process.env.NODE_ENV":'"development"',"process.env":"{}"},
  });
  execFileSync(process.execPath,[require.resolve("tailwindcss/lib/cli"),"-i","app/globals.css","-o",join(output,"styles.css")],{cwd:repository});
  writeFileSync(join(output,"index.html"),'<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css"><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
  try {
    for (const width of [1500,390]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      const errors = [];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(pathToFileURL(join(output,'index.html')).href);
      await page.getByRole('link',{name:'Anlagen ä',exact:true}).click();
      await page.getByRole('heading',{name:'Dateien in „Anlagen ä“'}).waitFor();
      assert.equal(await page.getByRole('link',{name:'Notizen.md',exact:true}).getAttribute('href'),'/dokumente/2/3?name=Notizen.md&folder=Anlagen%20%C3%A4');
      for (const name of ['Anlage.pdf','Bild.png']) assert.equal(new URL(await page.getByRole('link',{name,exact:true}).getAttribute('href'),'https://example.invalid').searchParams.get('folder'),'Anlagen ä');
      await page.getByRole('row').filter({has:page.getByRole('link',{name:'Details',exact:true})}).getByRole('link',{name:'Öffnen',exact:true}).click();
      await page.getByRole('heading',{name:'Dateien in „Details“'}).waitFor();
      await page.locator('input[type=file]').setInputFiles({name:'Test.txt',mimeType:'text/plain',buffer:Buffer.from('Nested upload')});
      await page.getByRole('link',{name:'Test.txt',exact:true}).waitFor();
      assert.deepEqual(await page.evaluate(()=>window.uploads),[{areaId:2,sessionId:3,folderName:'Sitzung',subfolder:'Anlagen ä/Details',filename:'Test.txt',text:'Nested upload'}]);
      const createMarkdown = async (name, subfolder) => {
        const actionOrder = await page.getByRole('button',{name:'Markdown-Datei erstellen',exact:true}).evaluate(button => [...button.parentElement.querySelectorAll('button')].map(node => node.textContent));
        assert.deepEqual(actionOrder.slice(0, 2), ['Markdown-Datei erstellen', 'Datei hinzufügen']);
        await page.getByRole('button',{name:'Markdown-Datei erstellen',exact:true}).click();
        const filename = page.getByRole('textbox',{name:'Dateiname',exact:true});
        await filename.fill('Existing.md');
        await page.getByRole('button',{name:'Erstellen und öffnen',exact:true}).click();
        await page.getByRole('alert').filter({hasText:'existiert bereits'}).waitFor();
        assert.equal(await filename.inputValue(),'Existing.md');
        await filename.fill(name);
        await page.getByRole('button',{name:'Erstellen und öffnen',exact:true}).click();
        await page.getByRole('link',{name:name+'.md',exact:true}).waitFor();
        await page.waitForFunction(()=>window.openedDocument!==null);
        const href = await page.evaluate(()=>window.openedDocument);
        assert.equal(new URL(href,'https://example.invalid').searchParams.get('name'),name+'.md');
        assert.equal(new URL(href,'https://example.invalid').searchParams.get('folder')??'',subfolder);
        assert.equal(await filename.count(),0);
        await page.evaluate(()=>{window.openedDocument=null;});
      };
      await createMarkdown('Neue Notizen','Anlagen ä/Details');
      assert.deepEqual(await page.evaluate(()=>window.created[0]),{areaId:2,sessionId:3,folderName:'Sitzung',subfolder:'Anlagen ä/Details',filename:'Neue Notizen.md'});
      await page.screenshot({path:join(output,`subfolder-${width}.png`)});
      await page.getByRole('link',{name:'← Übergeordneter Ordner',exact:true}).click();
      await page.getByRole('heading',{name:'Dateien in „Anlagen ä“'}).waitFor();
      assert.equal(await page.getByRole('link',{name:'Test.txt',exact:true}).count(),0);
      await page.getByRole('navigation',{name:'Ordnerpfad'}).getByRole('link',{name:'Sitzung',exact:true}).click();
      await page.getByRole('heading',{name:'Dateien im Sitzungsordner',exact:true}).waitFor();
      assert.equal(await page.getByText('Verlaufsprotokoll',{exact:true}).isVisible(),true);
      assert.equal(await page.getByText('Ergebnisprotokoll',{exact:true}).isVisible(),true);
      assert.deepEqual(await page.evaluate(()=>window.syncs),['','']);
      await createMarkdown('Notizen','');
      assert.equal(await page.evaluate(()=>window.created[1].subfolder),'');
      await page.getByRole('button',{name:'Markdown-Datei erstellen',exact:true}).click();
      await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.created.length),2);
      assert.deepEqual(errors,[]);
      console.log(`PASS ${width}: folder names, open links, breadcrumbs, nested automatic upload, scoped media/Markdown links, root-only protocol sync`);
      await page.close();
    }
  } finally {await browser.close();}
  console.log('Browser artifacts: '+output);
})().catch(error=>{console.error(error);process.exitCode=1;});
