// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after,test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp,readFile,rm,mkdir,writeFile,access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { eq,inArray } from "drizzle-orm";
import { db,pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { env } from "../lib/env";
import { purgeTestResource } from "./helpers/trash-cleanup";
import { restoreTrashEntry } from "../lib/trash";
after(()=>pool.end());
test("typed confirmations protect account/profile/visibility, group/template names and immediate content deletions across current and legacy actions",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);assert.match(env.UPLOAD_DIR,/^\/private\/tmp\/gremio-cashbook-test-/);
 const temporary=await mkdtemp(join(tmpdir(),"gremio-extended-confirmations-")),entry=join(temporary,"actions.cjs");
 const modules={boardSettings:"app/intern/board/[id]/einstellungen/actions.ts",users:"app/admin/users/actions.ts",profile:"app/intern/konto/actions.ts",visibility:"app/admin/inventar/actions.ts",overview:"app/admin/inventar/gesamt/actions.ts",groups:"app/admin/groups/actions.ts",template:"app/vorlagen/boards/actions.ts",items:"app/intern/inventar/[id]/item-actions.ts",loans:"app/intern/inventar/item/[itemId]/actions.ts",files:"app/intern/inventar/item/[itemId]/attachment-actions.ts",meetings:"app/intern/sitzungen/actions.ts",cards:"app/intern/card/[id]/actions.ts"};
 await build({stdin:{contents:Object.entries(modules).map(([key,path])=>`export * as ${key} from ${JSON.stringify(join(process.cwd(),path))};`).join("\n"),resolveDir:process.cwd()},outfile:entry,platform:"node",format:"cjs",bundle:true,packages:"external",plugins:[{name:"request-context",setup(builder){builder.onResolve({filter:/^@\/lib\/auth$/},()=>({path:"auth",namespace:"test"}));builder.onResolve({filter:/^next\/(navigation|cache)$/},({path})=>({path,namespace:"test"}));builder.onLoad({filter:/.*/,namespace:"test"},({path})=>({contents:path==="auth"?'export async function requireUser(){return globalThis.__extendedConfirmationUser;} export const getCurrentUser=requireUser; export async function requireAdmin(){const u=await requireUser();if(u.role!=="admin")throw Error("admin-required");return u;} export function canManageTemplates(u){return ["admin","template_manager"].includes(u.role);} export async function requireTemplateManager(){const u=await requireUser();if(!canManageTemplates(u))throw Error("template-required");return u;}':'export function revalidatePath(){} export function notFound(){throw Error("not-found")} export function redirect(){throw Error("redirect")}',loader:"js"}));}}]});
 const require=createRequire(import.meta.url),Module=require("node:module"),loaded=new Module(entry,module);loaded.filename=entry;loaded.paths=module.paths;loaded._compile(await readFile(entry,"utf8"),entry);const api=loaded.exports,context=globalThis as unknown as {__extendedConfirmationUser?:s.User};
 const people=await db.insert(s.users).values(["admin","writer","reader","target"].map(role=>({username:randomUUID(),role:role==="admin"?"admin" as const:"user" as const}))).returning();const[admin,writer,reader,target]=people;
 const [inventory]=await db.insert(s.inventoryBoards).values({name:"Confirmation inventory",ownerId:writer.id}).returning();
 const [group]=await db.insert(s.groups).values({name:"Exact group ÄÖ"}).returning();const[template]=await db.insert(s.boardTemplates).values({name:"Exact template ÄÖ"}).returning();
 const [area]=await db.insert(s.meetingAreas).values({name:"Confirmation meetings",ownerId:writer.id}).returning();const[topic]=await db.insert(s.meetingTopics).values({createdBy:writer.id,title:"Personal topic"}).returning();
 const [board]=await db.insert(s.boards).values({name:"Confirmation cards",ownerId:writer.id}).returning();const[status]=await db.insert(s.boardStatuses).values({boardId:board.id,name:"Open"}).returning();const[card]=await db.insert(s.cards).values({boardId:board.id,statusId:status.id,title:"Keep on rejected discard",applicant:"Test",token:randomUUID()}).returning();
 const form=(values:Record<string,string>={})=>{const f=new FormData();for(const[k,v]of Object.entries(values))f.set(k,v);return f;};
 const signature=`signatures/confirmation-${randomUUID()}.png`,filePath=`inventory-confirmation-${randomUUID()}.pdf`,docPath=`document-confirmation-${randomUUID()}.pdf`;
 try{
  await mkdir(join(env.UPLOAD_DIR,"signatures"),{recursive:true});await writeFile(join(env.UPLOAD_DIR,signature),"synthetic-signature");await writeFile(join(env.UPLOAD_DIR,filePath),"synthetic-file");await writeFile(join(env.UPLOAD_DIR,docPath),"synthetic-document");
  await db.update(s.users).set({signaturePath:signature,certP12Enc:"synthetic-test-only",certPassEnc:"synthetic-test-only",certSubject:"Synthetic certificate"}).where(eq(s.users.id,writer.id));const profile=(await db.select().from(s.users).where(eq(s.users.id,writer.id)))[0];
  context.__extendedConfirmationUser=profile;
  for(const word of [undefined,"","entfernen","LÖSCHEN",true,{}]){assert.ok((await api.profile.removeCertificateAction(word)).error);assert.ok((await api.profile.removeSignatureAction(word)).error);assert.deepEqual((await db.select().from(s.users).where(eq(s.users.id,writer.id)))[0],profile);await access(join(env.UPLOAD_DIR,signature));}
  await api.profile.removeCertificateAction("ENTFERNEN");await api.profile.removeSignatureAction("ENTFERNEN");assert.equal((await db.select().from(s.users).where(eq(s.users.id,writer.id)))[0].certP12Enc,null);await assert.rejects(access(join(env.UPLOAD_DIR,signature)));
  context.__extendedConfirmationUser=admin;
  for(const word of [undefined,"","deaktivieren","REAKTIVIEREN",true])assert.ok((await api.users.setUserActiveAction(target.id,false,word)).error);
  assert.ok((await api.users.setUserActiveAction(target.id,false,"DEAKTIVIEREN")).success);assert.equal((await db.select().from(s.users).where(eq(s.users.id,target.id)))[0].isActive,false);
  assert.ok((await api.users.setUserActiveAction(target.id,true,"DEAKTIVIEREN")).error);assert.ok((await api.users.setUserActiveAction(target.id,true,"REAKTIVIEREN")).success);
  for(const [action,enabled,word]of [[api.visibility.setInventoryBoardPublicConfirmedAction,true,"ÖFFENTLICH"],[api.visibility.setInventoryBoardPublicConfirmedAction,false,"VERBERGEN"],[api.overview.setBoardOverviewConfirmedAction,true,"EINBEZIEHEN"],[api.overview.setBoardOverviewConfirmedAction,false,"AUSSCHLIESSEN"]] as const){
   const before=(await db.select().from(s.inventoryBoards).where(eq(s.inventoryBoards.id,inventory.id)))[0];for(const bad of [undefined,"",word.toLowerCase(),true]){assert.ok((await action(inventory.id,enabled,bad)).error);assert.deepEqual((await db.select().from(s.inventoryBoards).where(eq(s.inventoryBoards.id,inventory.id)))[0],before);}assert.ok((await action(inventory.id,enabled,word)).success);
  }
  assert.ok((await api.visibility.setInventoryBoardPublicAction(form({boardId:String(inventory.id),isPublic:"1"}))).error);assert.ok((await api.overview.toggleBoardOverviewAction(form({boardId:String(inventory.id),include:"1"}))).error);
  for(const [kind,row,action]of [["group",group,api.groups.deleteGroupAction],["board_template",template,api.template.deleteTemplateAction]] as const){
   for(const name of [undefined,"","wrong",row.name.toLowerCase(),row.name+" ",true])assert.ok((await action(row.id,"LÖSCHEN",name)).error);
   await action(row.id,"LÖSCHEN",row.name);const entry=(await pool.query("select id from trash_entries where kind=$1 and entity_id=$2 and state='trashed'",[kind,row.id])).rows[0];await restoreTrashEntry(admin,entry.id,"WIEDERHERSTELLEN");
  }
  context.__extendedConfirmationUser=writer;
  await db.insert(s.inventoryBoardAccess).values({boardId:inventory.id,userId:reader.id,accessLevel:"read"});
  const pdfPath=`template-confirmation-${randomUUID()}.pdf`,wordPath=`template-confirmation-${randomUUID()}.docx`;
  await writeFile(join(env.UPLOAD_DIR,pdfPath),"synthetic-template");await writeFile(join(env.UPLOAD_DIR,wordPath),"synthetic-template");
  await db.insert(s.boardInstructionForms).values({boardId:board.id,enabled:true,filename:"Exact PDF.pdf",path:pdfPath,size:18});
  await db.update(s.meetingAreas).set({wordTemplatePath:wordPath,wordTemplateName:"Exact Word.docx",wordTemplateRevision:1}).where(eq(s.meetingAreas.id,area.id));
  for(const name of [undefined,"","wrong","Exact PDF.pdf ",true])assert.ok((await api.boardSettings.deleteInstructionFormAction(board.id,"LÖSCHEN",name)).error);
  for(const name of [undefined,"","wrong","Exact Word.docx ",true])assert.ok((await api.meetings.confirmedRemoveWordTemplateAction(area.id,1,"LÖSCHEN",name)).error);
  await access(join(env.UPLOAD_DIR,pdfPath));await access(join(env.UPLOAD_DIR,wordPath));
  assert.ok((await api.boardSettings.deleteInstructionFormAction(board.id,"LÖSCHEN","Exact PDF.pdf")).success);
  assert.ok((await api.meetings.confirmedRemoveWordTemplateAction(area.id,1,"LÖSCHEN","Exact Word.docx")).success);
  await assert.rejects(access(join(env.UPLOAD_DIR,pdfPath)));await assert.rejects(access(join(env.UPLOAD_DIR,wordPath)));
  const[item]=await db.insert(s.inventoryItems).values({boardId:inventory.id,name:"Deletion item"}).returning();const[loan]=await db.insert(s.inventoryLoans).values({itemId:item.id,borrower:"Synthetic",token:randomUUID(),status:"active"}).returning();
  const[file]=await db.insert(s.inventoryAttachments).values({itemId:item.id,kind:"receipt",filename:"Receipt.pdf",path:filePath,mime:"application/pdf",size:14}).returning();const[doc]=await db.insert(s.meetingDocuments).values({topicId:topic.id,filename:"Document.pdf",path:docPath,mime:"application/pdf",size:18}).returning();
  for(const word of [undefined,"","WRONG",true]){
   assert.ok((await api.cards.deleteCardAction(card.id,word)).error);assert.ok((await api.cards.discardCardAction(card.id,word)).error);
   assert.ok((await api.items.deleteInventoryItemAction({},form({itemId:String(item.id),...(typeof word==="string"?{confirmation:word}:{})}))).error);
   assert.ok((await api.loans.deleteLoanConfirmedAction(loan.id,word)).error);assert.ok((await api.files.deleteInventoryAttachmentConfirmedAction(file.id,word)).error);assert.ok((await api.meetings.confirmedRemoveDocumentAction(doc.id,word)).error);
  }
  assert.ok((await api.loans.deleteLoanAction(form({loanId:String(loan.id)}))).error);assert.ok((await api.files.deleteInventoryAttachmentAction(form({attId:String(file.id)}))).error);assert.ok((await api.meetings.removeDocumentAction(doc.id,{},form())).error);
  for(const[table,id]of [["inventory_items",item.id],["inventory_loans",loan.id],["inventory_attachments",file.id],["meeting_documents",doc.id],["cards",card.id]] as const)assert.equal((await pool.query(`select 1 from ${table} where id=$1`,[id])).rowCount,1);
  context.__extendedConfirmationUser=reader;await assert.rejects(api.files.deleteInventoryAttachmentConfirmedAction(file.id,"LÖSCHEN"));context.__extendedConfirmationUser=writer;
  await api.files.deleteInventoryAttachmentConfirmedAction(file.id,"LÖSCHEN");await assert.rejects(access(join(env.UPLOAD_DIR,filePath)));
  await api.meetings.confirmedRemoveDocumentAction(doc.id,"LÖSCHEN");await assert.rejects(access(join(env.UPLOAD_DIR,docPath)));
  await assert.rejects(api.loans.deleteLoanConfirmedAction(loan.id,"LÖSCHEN"),/redirect/);assert.ok((await api.items.deleteInventoryItemAction({},form({itemId:String(item.id),confirmation:"LÖSCHEN"}))).ok);
 }finally{
  await purgeTestResource("inventory",inventory.id);await purgeTestResource("group",group.id);await purgeTestResource("board_template",template.id);await purgeTestResource("meeting_area",area.id);await purgeTestResource("topic",topic.id);await purgeTestResource("board",board.id);
  await db.delete(s.users).where(inArray(s.users.id,people.map(p=>p.id)));delete context.__extendedConfirmationUser;await rm(temporary,{recursive:true,force:true});
 }
});
