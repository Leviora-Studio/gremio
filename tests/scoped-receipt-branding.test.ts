// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {inflateSync} from "node:zlib";
import sharp from "sharp";
import {PDFDocument,PDFName,PDFRawStream} from "pdf-lib";
import {eq} from "drizzle-orm";
import {db,pool} from "../lib/db";
import * as s from "../lib/db/schema";
import {getReceiptBranding,getFeedbackReceiptBranding,getLocalReceiptBranding,saveReceiptBranding,type ReceiptScope} from "../lib/receipt-branding";
import {buildConfirmationPdf,buildFeedbackConfirmationPdf} from "../lib/pdf";
import {renderEmail} from "../lib/email";
import {receiptCopy} from "../lib/receipt-copy";
after(()=>pool.end());
function content(pdf:PDFDocument){return pdf.context.enumerateIndirectObjects().flatMap(([,obj])=>obj instanceof PDFRawStream&&obj.dict.get(PDFName.of('Subtype'))?.toString()!=='/Image'?[inflateSync(obj.contents).toString()]:[]).join('\n');}
function hasText(pdf:PDFDocument,text:string){return content(pdf).includes(Buffer.from(text,'latin1').toString('hex').toUpperCase());}
test("per-location and per-survey receipts isolate identities, preserve defaults and use consistent friendly copy",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
 const suffix=randomUUID();const [admin,reader]=await db.insert(s.users).values([{username:'receipt-admin-'+suffix,role:'admin'},{username:'receipt-reader-'+suffix}]).returning();
 const [board]=await db.insert(s.boards).values({name:'Receipt test',ownerId:admin.id}).returning();const [status]=await db.insert(s.boardStatuses).values({boardId:board.id,name:'Inbox'}).returning();
 const [first,second]=await db.insert(s.locations).values([{name:'North '+suffix,targetBoardId:board.id,targetStatusId:status.id},{name:'South '+suffix,targetBoardId:board.id,targetStatusId:status.id}]).returning();
 const [area]=await db.insert(s.feedbackAreas).values({name:'Ideas '+suffix,targetBoardId:board.id,targetStatusId:status.id}).returning();
 const [card]=await db.insert(s.cards).values({boardId:board.id,statusId:status.id,title:'Feedback',applicant:'Alex',token:randomUUID()}).returning();await db.insert(s.feedbackSubmissions).values({cardId:card.id,areaId:area.id,areaName:area.name,submitterName:'Alex',feedbackText:'More bike racks'});
 const baseline=await getReceiptBranding();const a:ReceiptScope={kind:'location',id:first.id},b:ReceiptScope={kind:'location',id:second.id},c:ReceiptScope={kind:'feedback',id:area.id};
 const logo=await sharp(await readFile('tests/fixtures/receipt-logo.svg')).png().toBuffer();
 const form=(name:string,enabled=true,image?:Buffer)=>{const f=new FormData();if(enabled)f.set('customBranding','on');f.set('organization',name);if(image)f.set('logo',new File([new Uint8Array(image)],'logo.png',{type:'image/png'}));return f;};
 try {
  assert.deepEqual(await getReceiptBranding(a),baseline);
  assert.ok((await saveReceiptBranding(reader,a,form('Unauthorized',true,logo))).error);assert.equal((await getLocalReceiptBranding(a))?.enabled,false);
  assert.ok((await saveReceiptBranding(admin,{kind:'location',id:2147483647},form('Missing'))).error);
  assert.ok((await saveReceiptBranding(admin,a,form('North council',true,logo))).success);
  assert.ok((await saveReceiptBranding(admin,b,form('South council'))).success);
  const green=await sharp({create:{width:200,height:80,channels:4,background:'#008866'}}).png().toBuffer();
  assert.ok((await saveReceiptBranding(admin,c,form('Campus ideas',true,green))).success);
  assert.equal((await getReceiptBranding(a)).organization,'North council');assert.equal((await getReceiptBranding(b)).logoPng,null,'local branding never inherits another logo');assert.equal((await getFeedbackReceiptBranding(card.id)).organization,'Campus ideas');assert.deepEqual(await getReceiptBranding(),baseline);
  const invalid=form('Invalid',true,Buffer.from('not an image'));assert.ok((await saveReceiptBranding(admin,a,invalid)).error);assert.equal((await getReceiptBranding(a)).organization,'North council');
  const input={title:'Culture project',applicant:'Alex Example',eingang:new Date('2026-11-01T10:30:00Z'),statusLink:'https://example.invalid/status/private-token',number:'AN-0042'};
  const pdf=await PDFDocument.load(await buildConfirmationPdf({...input,branding:await getReceiptBranding(a)}));assert.equal(pdf.getAuthor(),'North council');assert.ok(hasText(pdf,'Dein Antrag ist angekommen'));assert.ok(!hasText(pdf,'Sehr geehrte Damen und Herren,'));assert.ok(pdf.context.enumerateIndirectObjects().some(([,o])=>o instanceof PDFRawStream&&o.dict.get(PDFName.of('Subtype'))?.toString()==='/Image'));
  const jobs=[{kind:'application' as const,scope:a,org:'North council',logo:true},{kind:'application' as const,scope:b,org:'South council',logo:false},{kind:'feedback' as const,scope:c,org:'Campus ideas',logo:true}];
  for(const item of jobs){const job={kind:item.kind,payload:{title:input.title,applicant:input.applicant,receivedAt:input.eingang.toISOString(),statusLink:'private-token',areaName:area.name,feedbackText:'More bike racks',receiptScope:item.scope}} as typeof s.emailOutbox.$inferSelect;const rendered=await renderEmail(job);assert.ok(rendered.text.includes(item.org));assert.ok(rendered.text.includes(receiptCopy(item.kind).introduction));assert.ok(rendered.html?.includes(receiptCopy(item.kind).headline));assert.ok(rendered.text.includes('dein')||rendered.text.includes('deine'));assert.ok(!rendered.text.includes('Sehr geehrte'));assert.ok(rendered.html?.includes('Viele Grüße'));assert.equal(rendered.attachments.length,item.logo?2:1);assert.equal((await PDFDocument.load(rendered.attachments[0].content)).getAuthor(),item.org);if(process.env.GREMIO_RECEIPT_OUTPUT_DIR)await writeFile(process.env.GREMIO_RECEIPT_OUTPUT_DIR+'/'+item.org.replace(/ /g,'-')+'.pdf',rendered.attachments[0].content);}
  const before=(await getLocalReceiptBranding(a))!;await saveReceiptBranding(admin,a,form('',false));assert.deepEqual(await getReceiptBranding(a),baseline);assert.equal((await getLocalReceiptBranding(a))?.logoPng,before.logoPng,'disabling keeps local settings');
  const remove=form('North council',true,logo);remove.set('removeLogo','on');await saveReceiptBranding(admin,a,remove);assert.equal((await getReceiptBranding(a)).logoPng,null);
  await saveReceiptBranding(admin,c,form(''));assert.equal((await getReceiptBranding(c)).organization,area.name,'blank local name falls back to resource name');
  const inventory=await PDFDocument.load(await buildConfirmationPdf({...input,kind:'inventory',branding:baseline}));assert.ok(hasText(inventory,'Deine Inventaranfrage ist angekommen'));
  const feedback=await PDFDocument.load(await buildFeedbackConfirmationPdf({areaName:area.name,submitterName:'Alex',feedbackText:'More bike racks',eingang:input.eingang,statusLink:input.statusLink,branding:await getReceiptBranding(c)}));assert.ok(hasText(feedback,'Dein Feedback ist angekommen'));
 }finally{await db.delete(s.cards).where(eq(s.cards.id,card.id));await db.delete(s.locations).where(eq(s.locations.id,first.id));await db.delete(s.locations).where(eq(s.locations.id,second.id));await db.delete(s.feedbackAreas).where(eq(s.feedbackAreas.id,area.id));await db.delete(s.boards).where(eq(s.boards.id,board.id));for(const user of [admin,reader])await db.delete(s.users).where(eq(s.users.id,user.id));}
});
