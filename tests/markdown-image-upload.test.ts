// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { pool } from "../lib/db";
import { uploadMarkdownImage } from "../lib/markdown-image-upload";
import { normalizeProtocolLogo } from "../lib/protocol-logos";
import { MarkdownDocumentError } from "../lib/markdown-documents";
import type { User } from "../lib/db/schema";
after(async () => { await pool.end(); });

test("document images create attachments next to Markdown with exclusive unique PNG writes", async () => {
  const png = await sharp({create:{width:120,height:60,channels:4,background:'#447799'}}).png().toBuffer();
  const writes: { path: string; replace: boolean }[] = []; const directories: string[] = [];
  const target = { areaId: 2, sessionId: 3, filename: "Notizen.md", subfolder: "Anlagen" };
  type Deps = NonNullable<Parameters<typeof uploadMarkdownImage>[3]>;
  let resolves = 0;
  const deps: Deps = {
    resolveMarkdownDocument: async (_user, request) => { resolves++; assert.deepEqual(request, target); return { area: {rootPath:'/Protokolle'}, session:{folderName:'Sitzung'}, creds:{} } as Awaited<ReturnType<Deps['resolveMarkdownDocument']>>; },
    normalizeProtocolLogo,
    createWebDavDirectoryExclusive: async (_c,path) => {directories.push(path);return false;},
    statWebDavEntry: async (_c,path) => ({path,name:'attachments',type:'directory',fileId:'a',size:0,mime:null,etag:null,lastModified:null}),
    writeWebDavBinary: async (_c,path,bytes,mime,replace) => {assert.equal(mime,'image/png');assert.equal((await sharp(bytes).metadata()).width,120);writes.push({path,replace});return true;},
    randomUUID: () => '11111111-1111-4111-8111-111111111111',
  };
  const user = {id:1} as User;
  const file = new File([new Uint8Array(png)],'Bild ä.png',{type:'image/png'});
  const result = await uploadMarkdownImage(user,target,file,deps);
  assert.ok(result.reference?.startsWith('attachments/Bild-%C3%A4-'));
  assert.deepEqual(directories,['/Protokolle/Sitzung/Anlagen/attachments']);
  assert.equal(writes[0].path,'/Protokolle/Sitzung/Anlagen/attachments/Bild-ä-11111111-1111-4111-8111-111111111111.png');
  assert.equal(writes[0].replace,false); assert.equal(resolves,2);
  assert.ok((await uploadMarkdownImage(user,target,file,{...deps,resolveMarkdownDocument:async()=>{throw new MarkdownDocumentError('Kein Zugriff');}})).error);
  assert.ok((await uploadMarkdownImage(user,target,new File(['<svg/>'],'bad.png'),deps)).error);
  assert.ok((await uploadMarkdownImage(user,target,file,{...deps,statWebDavEntry:async(c,p)=>({...await deps.statWebDavEntry(c,p),type:'file'})})).error);
  assert.ok((await uploadMarkdownImage(user,target,file,{...deps,writeWebDavBinary:async()=>false})).error);
  assert.ok((await uploadMarkdownImage(user,target,new File([new Uint8Array(5*1024*1024+1)],'large.png'),deps)).error);
  assert.equal(writes.length,1);
});
