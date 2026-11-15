// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after,test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir,writeFile,readFile,access } from "node:fs/promises";
import { join } from "node:path";
import { eq,inArray } from "drizzle-orm";
import { db,pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { env } from "../lib/env";
import { moveToTrash,purgeTrashEntry,restoreTrashEntry,sweepTrash } from "../lib/trash";
import { boardCardTrash,restoreBoardCard } from "../lib/card-trash";
import { stageAttachmentTrash,restoreBoardAttachment } from "../lib/attachment-trash";
import { activeRows } from "../lib/trash-visibility";
import { getApplicationStatusByToken } from "../lib/public-status";
import { generateApiToken } from "../lib/api-token";
import { GET,DELETE } from "../app/api/v1/cards/[id]/route";
import { callMcpTool } from "../lib/mcp-tools";
import { purgeTestResource } from "./helpers/trash-cleanup";
after(()=>pool.end());
test("card bin retains complete contents, hides all normal/public/API reads and protects scoped restore/purge and 30-day expiry",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);assert.match(env.UPLOAD_DIR,/^\/private\/tmp\/gremio-cashbook-test-/);await mkdir(env.UPLOAD_DIR,{recursive:true});
 const people=await db.insert(s.users).values(["owner","writer","reader","admin"].map(role=>({username:randomUUID(),role:role==="admin"?"admin" as const:"user" as const}))).returning();const[owner,writer,reader,admin]=people;
 const [board,foreign]=await db.insert(s.boards).values([{name:"Card bin",ownerId:owner.id,isApplicationBoard:true},{name:"Foreign bin",ownerId:writer.id}]).returning();
 const [status]=await db.insert(s.boardStatuses).values({boardId:board.id,name:"Pending"}).returning();
 const [card,locked]=await db.insert(s.cards).values(["Retained card","Locked card"].map(title=>({boardId:board.id,statusId:status.id,title,applicant:"Original applicant",notes:"Internal notes",number:"SECRET-NUMBER",token:randomUUID()}))).returning();
 const path=`card-bin-${randomUUID()}.pdf`,removedPath=`card-bin-removed-${randomUUID()}.pdf`;
 const read=async()=>(await db.select().from(s.cards).where(eq(s.cards.id,card.id)))[0];const entry=async(kind="card",id=card.id)=>(await pool.query("select * from trash_entries where kind=$1 and entity_id=$2 and state in ('trashed','purging')",[kind,id])).rows[0];
 const token=generateApiToken();const req=(method="GET",body?:unknown)=>new Request("http://localhost/api/v1/cards",{method,headers:{authorization:`Bearer ${token.token}`,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});const params={params:Promise.resolve({id:String(card.id)})};
 try{
  await db.insert(s.boardAccess).values([{boardId:board.id,userId:writer.id,accessLevel:"write"},{boardId:board.id,userId:reader.id,accessLevel:"read"}]);await db.insert(s.apiTokens).values({userId:writer.id,name:"Card bin",tokenHash:token.hash,prefix:token.prefix,scope:"write"});
  await db.insert(s.boardCardFields).values([{boardId:board.id,fieldKey:"number",visible:false},{boardId:board.id,fieldKey:"other_pdfs",visible:true}]);
  await writeFile(join(env.UPLOAD_DIR,path),"retained-original");await writeFile(join(env.UPLOAD_DIR,removedPath),"removed-original");
  const files=await db.insert(s.attachments).values([{cardId:card.id,kind:"other" as const,filename:"Original.pdf",path,mime:"application/pdf",size:17},{cardId:card.id,kind:"other" as const,filename:"Already removed.pdf",path:removedPath,mime:"application/pdf",size:16}]).returning();
  await db.insert(s.cardComments).values({cardId:card.id,userId:owner.id,body:"Original comment"});await db.insert(s.cardAssignees).values({cardId:card.id,userId:writer.id});
  await db.transaction(tx=>stageAttachmentTrash(tx,card.id,files[1].id,writer.id));const removed=await entry("attachment",files[1].id);
  const original=await read();const comments=(await pool.query("select * from card_comments where card_id=$1",[card.id])).rows;
  for(const word of [undefined,"","DELETE",true,123])await assert.rejects(moveToTrash(writer,"card",card.id,word),/LÖSCHEN/);
  await assert.rejects(moveToTrash(reader,"card",card.id,"LÖSCHEN"),/Schreibzugriff/);assert.deepEqual(await read(),original);
  await db.update(s.cards).set({lockedAt:new Date(),lockedBy:owner.id}).where(eq(s.cards.id,locked.id));await assert.rejects(moveToTrash(admin,"card",locked.id,"LÖSCHEN"),/gesperrt/);
  for(const body of [undefined,{}, {confirmation:"wrong"},{confirmation:true}])assert.equal((await DELETE(req("DELETE",body),params)).status,400);
  assert.equal((await DELETE(req("DELETE",{confirmation:"LÖSCHEN"}),params)).status,200);
  const deleted=await read();assert.ok(deleted.deletedAt);assert.deepEqual({...deleted,deletedAt:null},original);assert.deepEqual((await pool.query("select * from card_comments where card_id=$1",[card.id])).rows,comments);
  assert.equal((await db.select().from(s.cards).where(activeRows.cards)).some(row=>row.id===card.id),false);assert.equal((await GET(req(),params)).status,404);assert.equal(await getApplicationStatusByToken(card.token),undefined);assert.deepEqual((await pool.query("select * from attachments where id=$1",[files[0].id])).rows[0].path,path);await access(join(env.UPLOAD_DIR,path));
  await assert.rejects(db.update(s.cards).set({title:"Forbidden"}).where(eq(s.cards.id,card.id)));await assert.rejects(db.insert(s.cardComments).values({cardId:card.id,userId:owner.id,body:"Forbidden"}));
  const trash=await entry();const listing=(await boardCardTrash(reader,board.id)).find(row=>row.id===trash.id)!;assert.equal(listing.title,original.title);assert.equal(listing.number,null);assert.doesNotMatch(JSON.stringify(listing),/Internal notes|retained-original|Original applicant/);
  for(const word of [undefined,"","LÖSCHEN"])await assert.rejects(restoreBoardCard(writer,board.id,trash.id,word));await assert.rejects(restoreBoardCard(reader,board.id,trash.id,"WIEDERHERSTELLEN"));await assert.rejects(restoreBoardCard(writer,foreign.id,trash.id,"WIEDERHERSTELLEN"));await assert.rejects(purgeTrashEntry(reader,trash.id,"ENDGÜLTIG",new Date(),board.id,"card"));
  await assert.rejects(restoreBoardAttachment(writer,board.id,removed.id,"WIEDERHERSTELLEN"),/Karte/);
  const boardBin=await moveToTrash(admin,"board",board.id,"LÖSCHEN",{boardName:board.name});await assert.rejects(restoreBoardCard(admin,board.id,trash.id,"WIEDERHERSTELLEN"));await restoreTrashEntry(admin,boardBin,"WIEDERHERSTELLEN");assert.ok((await read()).deletedAt);
  await restoreBoardCard(writer,board.id,trash.id,"WIEDERHERSTELLEN");assert.deepEqual(await read(),original);assert.equal((await GET(req(),params)).status,200);assert.ok(await getApplicationStatusByToken(card.token));assert.equal((await pool.query("select 1 from attachments where id=$1",[files[1].id])).rowCount,0,"independently removed files stay in their own bin");
  const context={user:writer,scope:"write" as const,boardIds:new Set([board.id]),accessTokenHash:"synthetic",accessTokenExpiresAt:new Date(Date.now()+60000)};
  assert.equal((await callMcpTool(context,"delete_card",{id:card.id})).isError,true);assert.equal((await callMcpTool(context,"delete_card",{id:card.id,confirmation:"LÖSCHEN"})).isError??false,false);
  const last=await entry();await assert.rejects(purgeTrashEntry(writer,last.id,"LÖSCHEN",new Date(),board.id,"card"));
  await sweepTrash(new Date(new Date(last.expires_at).getTime()-1));assert.ok(await read());await sweepTrash(new Date(new Date(last.expires_at).getTime()+1));assert.equal(await read(),undefined);await assert.rejects(access(join(env.UPLOAD_DIR,path)));await assert.rejects(access(join(env.UPLOAD_DIR,removedPath)));assert.equal((await pool.query("select state from trash_entries where id=$1",[removed.id])).rows[0].state,"purged");
 }finally{await purgeTestResource("board",board.id);await purgeTestResource("board",foreign.id);await db.delete(s.users).where(inArray(s.users.id,people.map(p=>p.id)));}
});
