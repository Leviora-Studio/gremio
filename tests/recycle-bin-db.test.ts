// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { moveToTrash, restoreTrashEntry, purgeTrashEntry, sweepTrash, runDailyTrashCleanup, trashKinds, type TrashKind } from "../lib/trash";
import { getBoardById, getAccessibleBoards, canAccessBoard, getUserGroupIds } from "../lib/authz";
import { getInventoryBoardById } from "../lib/inventory";
import { getFinanceBoardById } from "../lib/finance";
import { accessibleCashbooks, requireCashbook } from "../lib/cashbook/access";
import { defaultCashbookConfig } from "../lib/cashbook-types";
import { getApplicationStatusByToken } from "../lib/public-status";
import { insertPublicAttachment } from "../lib/public-workflow";
import { generateApiToken } from "../lib/api-token";
import { GET, PATCH } from "../app/api/v1/cards/[id]/route";
import { callMcpTool } from "../lib/mcp-tools";
import { activeRows } from "../lib/trash-visibility";
import { createCashbook, saveCashbookDraft } from "../lib/cashbook/service";
import { env } from "../lib/env";
after(()=>pool.end());

test("recycle bin preserves all resource types, enforces words/admin-only application deletion and keeps deleted data inaccessible",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);assert.match(env.UPLOAD_DIR,/^\/private\/tmp\/gremio-cashbook-test-/);await mkdir(env.UPLOAD_DIR,{recursive:true});
 await pool.query("delete from maintenance_runs where name='trash'");
 const [admin,owner,reader]=await db.insert(s.users).values([{username:randomUUID(),role:"admin"},{username:randomUUID()},{username:randomUUID()}]).returning();
 const insert=async(table:any,values:any)=>((await db.insert(table).values(values).returning()) as unknown as any[])[0];
 const board=await insert(s.boards,{name:"Recoverable board",ownerId:owner.id});
 const app=await insert(s.boards,{name:"Frozen application board",ownerId:owner.id,isApplicationBoard:true});
 const status=await insert(s.boardStatuses,{boardId:app.id,name:"Accepted",isLockColumn:true});
 const card=await insert(s.cards,{boardId:app.id,statusId:status.id,title:"Original frozen title",applicant:"Original applicant",token:randomUUID()});
 const historical=[{amount:1000,budgetTitle:"Historical title",accountId:null}];
 await db.insert(s.cardBudgetPlans).values({cardId:card.id,allocations:historical,revision:1});
 await db.insert(s.cardBudgetPlanCorrections).values({cardId:card.id,revision:1,beforeAllocations:[],afterAllocations:historical,reason:"Original immutable history",userId:owner.id});
 await db.update(s.cards).set({lockedAt:new Date(),lockedBy:owner.id}).where(eq(s.cards.id,card.id));
 await assert.rejects(db.delete(s.cardBudgetPlanCorrections).where(eq(s.cardBudgetPlanCorrections.cardId,card.id)));
 const filePath=`trash-${randomUUID()}.pdf`;await writeFile(join(env.UPLOAD_DIR,filePath),"synthetic-original-file");
 await insert(s.attachments,{cardId:card.id,kind:"other",uploadPurpose:"receipt",filename:"Original_Q1.pdf",path:filePath,mime:"application/pdf",size:23});
 await db.insert(s.boardAccess).values({boardId:app.id,userId:reader.id,accessLevel:"read"});
 const token=generateApiToken();await db.insert(s.apiTokens).values({userId:owner.id,name:"Trash tests",tokenHash:token.hash,prefix:token.prefix,scope:"write"});
 const req=(method="GET",body?:unknown)=>new Request("http://localhost/api/v1/cards",{method,headers:{authorization:`Bearer ${token.token}`,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const params={params:Promise.resolve({id:String(card.id)})};
 for(const word of [undefined,"","DELETE",true])await assert.rejects(moveToTrash(owner,"board",board.id,word),/LÖSCHEN/);
 await assert.rejects(moveToTrash(owner, "board", app.id, "LÖSCHEN", {boardName:app.name}),/Administrationskonten/);
 const original=(await db.select().from(s.cards).where(eq(s.cards.id,card.id)))[0];
 const appEntry=await moveToTrash(admin, "board", app.id, "LÖSCHEN", {boardName:app.name});
 assert.equal(await getBoardById(app.id),undefined);assert.equal((await getAccessibleBoards(admin)).some(row=>row.id===app.id),false);
 assert.equal((await getApplicationStatusByToken(card.token)),undefined);assert.equal((await GET(req(),params)).status,404);assert.equal((await PATCH(req("PATCH",{statusId:status.id}),params)).status,404);
 const mcp=await callMcpTool({user:owner,scope:"write",boardIds:null,accessTokenHash:"synthetic",accessTokenExpiresAt:new Date(Date.now()+60000)},"get_card",{id:card.id});assert.equal(mcp.isError,true);
 await assert.rejects(insertPublicAttachment(card.id,"receipt",{filename:"x.pdf",relPath:"never-written.pdf",mime:"application/pdf",size:1}));
 assert.equal((await db.select().from(s.cards).where(eq(s.cards.id,card.id)))[0].title,original.title);assert.equal(await readFile(join(env.UPLOAD_DIR,filePath),"utf8"),"synthetic-original-file");
 await assert.rejects(db.update(s.boards).set({name:"Changed"}).where(eq(s.boards.id,app.id)));
 await assert.rejects(db.insert(s.attachments).values({cardId:card.id,kind:"other",uploadPurpose:"receipt",filename:"Forbidden.pdf",path:"never-written.pdf",mime:"application/pdf",size:1}));
 for(const word of [undefined,"","wiederherstellen","ENDGÜLTIG"])await assert.rejects(restoreTrashEntry(admin,appEntry,word));
 await assert.rejects(restoreTrashEntry(owner,appEntry,"WIEDERHERSTELLEN"),/Administrationskonten/);
 await restoreTrashEntry(admin,appEntry,"WIEDERHERSTELLEN");
 assert.ok(await getBoardById(app.id));assert.equal((await GET(req(),params)).status,200);assert.deepEqual((await db.select().from(s.cards).where(eq(s.cards.id,card.id)))[0],original);assert.equal((await db.select().from(s.boardAccess).where(eq(s.boardAccess.boardId,app.id))).length,1);
 await assert.rejects(db.update(s.cards).set({title:"Still frozen"}).where(eq(s.cards.id,card.id)));
 const plainEntry=await moveToTrash(owner, "board", board.id, "LÖSCHEN", {boardName:board.name});await restoreTrashEntry(admin,plainEntry,"WIEDERHERSTELLEN");
 const bookId=await createCashbook(admin,"Immutable cashbook"),bookFile=`cashbook-${randomUUID()}.pdf`;await writeFile(join(env.UPLOAD_DIR,bookFile),"immutable-signature");
 await db.update(s.cashbooks).set({ownerId:owner.id}).where(eq(s.cashbooks.id,bookId));
 const payment={cardId:null,business:true,number:"G1",receiptIds:[],amount:1000,budgetTitle:"Historical",holder:"Original holder",iban:"DE89370400440532013000",bank:"Original bank",purpose:"",place:"",date:""};
 const posted=await insert(s.cashbookEntries,{cashbookId:bookId,creatorId:owner.id,state:"posted",role:"speaker",authorizedAt:new Date(),data:payment,files:[{id:"signed",filename:"Signed.pdf",path:bookFile,mime:"application/pdf",sha256:"synthetic",kind:"signed"}]});
 await insert(s.cashbookEntries,{cashbookId:bookId,creatorId:owner.id,state:"posted",role:"speaker",authorizedAt:new Date(),data:{...payment,amount:900},correctsId:posted.id,correctionReason:"Original correction"});
 await insert(s.cashbookActivity,{cashbookId:bookId,entryId:posted.id,userId:owner.id,type:"created",detail:{original:true}});
 await assert.rejects(moveToTrash(owner,"cashbook",bookId,"LÖSCHEN"),/Administrationskonten/);
 const bookEntry=await moveToTrash(admin,"cashbook",bookId,"LÖSCHEN",{cashbookName:"Immutable cashbook"});await assert.rejects(requireCashbook(owner,bookId));assert.equal((await accessibleCashbooks(owner)).some(row=>row.id===bookId),false);
 assert.equal((await db.select().from(s.cashbookEntries).where(activeRows.cashbookEntries)).some(row=>row.id===posted.id),false);
 await assert.rejects(db.insert(s.cashbookEntries).values({cashbookId:bookId,creatorId:owner.id,role:"speaker",data:payment}));
 await restoreTrashEntry(admin,bookEntry,"WIEDERHERSTELLEN");assert.equal((await requireCashbook(owner,bookId)).book.id,bookId);
 await assert.rejects(db.delete(s.cashbookEntries).where(eq(s.cashbookEntries.id,posted.id)),"single posted entries stay protected after restoration");
 const group=await insert(s.groups,{name:randomUUID()});await insert(s.userGroups,{groupId:group.id,userId:reader.id});assert.ok((await getUserGroupIds(reader.id)).includes(group.id));
 const groupEntry=await moveToTrash(admin,"group",group.id,"LÖSCHEN",{entityName:group.name});assert.equal((await getUserGroupIds(reader.id)).includes(group.id),false);await restoreTrashEntry(admin,groupEntry,"WIEDERHERSTELLEN");assert.ok((await getUserGroupIds(reader.id)).includes(group.id));
 const inventory=await insert(s.inventoryBoards,{name:"Retained inventory",ownerId:owner.id});const item=await insert(s.inventoryItems,{boardId:inventory.id,name:"Original item"});
 const invEntry=await moveToTrash(owner,"inventory",inventory.id,"LÖSCHEN",{inventoryName:inventory.name});assert.equal(await getInventoryBoardById(inventory.id),undefined);assert.equal((await db.select().from(s.inventoryItems).where(activeRows.inventoryItems)).some(row=>row.id===item.id),false);await restoreTrashEntry(admin,invEntry,"WIEDERHERSTELLEN");assert.ok(await getInventoryBoardById(inventory.id));
 const finance=await insert(s.financeBoards,{name:"Recoverable finances",ownerId:owner.id});const account=await insert(s.accounts,{name:randomUUID(),financeBoardId:finance.id});const finEntry=await moveToTrash(admin,"finance",finance.id,"LÖSCHEN",{financeName:finance.name});assert.equal(await getFinanceBoardById(finance.id),undefined);assert.equal((await db.select().from(s.accounts).where(eq(s.accounts.id,account.id)))[0].financeBoardId,finance.id);await restoreTrashEntry(admin,finEntry,"WIEDERHERSTELLEN");assert.ok(await getFinanceBoardById(finance.id));
 const area=await insert(s.meetingAreas,{name:"Original area",ownerId:owner.id});
 const cases:[TrashKind,any,any][]=[
  ["account",s.accounts,{name:randomUUID()}],["priority",s.priorities,{label:"Priority"}],["location",s.locations,{name:randomUUID()}],["feedback",s.feedbackAreas,{name:randomUUID()}],
  ["board_template",s.boardTemplates,{name:randomUUID()}],["finance_template",s.financeTemplates,{name:randomUUID()}],["meeting_template",s.meetingAreaTemplates,{name:randomUUID()}],
  ["meeting",s.meetings,{title:"Original meeting",areaId:area.id,ownerId:owner.id}],["topic",s.meetingTopics,{title:"Original topic",createdBy:owner.id}],
 ];
 for(const [kind,table,values]of cases){const row=await insert(table,values),entry=await moveToTrash(admin,kind,row.id,"LÖSCHEN",{entityName:row.name});assert.ok((await db.select().from(table).where(eq(table.id,row.id)))[0].deletedAt,kind);await restoreTrashEntry(admin,entry,"WIEDERHERSTELLEN");assert.deepEqual((await db.select().from(table).where(eq(table.id,row.id)))[0],row,kind);const final=await moveToTrash(admin,kind,row.id,"LÖSCHEN",{entityName:row.name});await purgeTrashEntry(admin,final,"ENDGÜLTIG");assert.equal((await db.select().from(table).where(eq(table.id,row.id))).length,0,kind);}
 // Trashed routing must not block final deletion of its old target.
 const routedBoard=await insert(s.boards,{name:"Former target",ownerId:owner.id});const routedStatus=await insert(s.boardStatuses,{boardId:routedBoard.id,name:"Inbox"});const route=await insert(s.locations,{name:randomUUID(),targetBoardId:routedBoard.id,targetStatusId:routedStatus.id});
 await assert.rejects(moveToTrash(admin, "board", routedBoard.id, "LÖSCHEN", {boardName:routedBoard.name}),/Routing/);const routeTrash=await moveToTrash(admin,"location",route.id,"LÖSCHEN");const targetTrash=await moveToTrash(admin, "board", routedBoard.id, "LÖSCHEN", {boardName:routedBoard.name});await purgeTrashEntry(admin,targetTrash,"ENDGÜLTIG");await restoreTrashEntry(admin,routeTrash,"WIEDERHERSTELLEN");assert.equal((await db.select().from(s.locations).where(eq(s.locations.id,route.id)))[0].targetBoardId,null);
 // Reparented children keep inherited privacy and restore only if unchanged.
 const session=await insert(s.meetings,{title:"Privacy",areaId:area.id,ownerId:owner.id});const parent=await insert(s.meetingTopics,{meetingId:session.id,title:"Private parent",createdBy:owner.id,confidential:true});const child=await insert(s.meetingTopics,{meetingId:session.id,parentId:parent.id,title:"Child",createdBy:owner.id});
 const parentTrash=await moveToTrash(admin,"topic",parent.id,"LÖSCHEN");let restoredChild=(await db.select().from(s.meetingTopics).where(eq(s.meetingTopics.id,child.id)))[0];assert.equal(restoredChild.parentId,null);assert.equal(restoredChild.confidential,true);await restoreTrashEntry(admin,parentTrash,"WIEDERHERSTELLEN");restoredChild=(await db.select().from(s.meetingTopics).where(eq(s.meetingTopics.id,child.id)))[0];assert.equal(restoredChild.parentId,parent.id);assert.equal(restoredChild.confidential,false);
 const childTrash=await moveToTrash(admin,"topic",child.id,"LÖSCHEN");await db.update(s.meetingTopics).set({section:"non_public"}).where(eq(s.meetingTopics.id,parent.id));await purgeTrashEntry(admin,childTrash,"ENDGÜLTIG");
 const sessionTrash=await moveToTrash(admin,"meeting",session.id,"LÖSCHEN");await purgeTrashEntry(admin,sessionTrash,"ENDGÜLTIG");
 // Whole-inventory purge includes its frozen tracking cards, items and local files.
 const trackedInventory=await insert(s.inventoryBoards,{name:"Whole inventory",ownerId:owner.id});const trackingBoard=await insert(s.boards,{name:"Whole tracking",ownerId:owner.id,inventoryBoardId:trackedInventory.id});const trackingStatus=await insert(s.boardStatuses,{boardId:trackingBoard.id,name:"Loan"});const trackingCard=await insert(s.cards,{boardId:trackingBoard.id,statusId:trackingStatus.id,title:"Frozen loan",applicant:"Test",token:randomUUID(),lockedAt:new Date(),lockedBy:owner.id});const trackedItem=await insert(s.inventoryItems,{boardId:trackedInventory.id,name:"Stored item"});const trackedLoan=await insert(s.inventoryLoans,{itemId:trackedItem.id,cardId:trackingCard.id,borrower:"Stored borrower",status:"active",token:randomUUID()});await db.update(s.inventoryBoards).set({loanBoardId:trackingBoard.id,loanActiveStatusId:trackingStatus.id}).where(eq(s.inventoryBoards.id,trackedInventory.id));
 const inventoryFile=`inventory-${randomUUID()}.pdf`;await writeFile(join(env.UPLOAD_DIR,inventoryFile),"inventory-bytes");await insert(s.inventoryAttachments,{itemId:trackedItem.id,loanId:trackedLoan.id,kind:"loan_contract",filename:"Contract.pdf",path:inventoryFile,mime:"application/pdf",size:15});
 const wholeInventoryTrash=await moveToTrash(owner,"inventory",trackedInventory.id,"LÖSCHEN",{inventoryName:trackedInventory.name});assert.equal(await getBoardById(trackingBoard.id),undefined);await restoreTrashEntry(admin,wholeInventoryTrash,"WIEDERHERSTELLEN");assert.ok(await getBoardById(trackingBoard.id));assert.equal((await db.select().from(s.inventoryLoans).where(eq(s.inventoryLoans.id,trackedLoan.id)))[0].cardId,trackingCard.id);const finalInventoryTrash=await moveToTrash(owner,"inventory",trackedInventory.id,"LÖSCHEN",{inventoryName:trackedInventory.name});await purgeTrashEntry(admin,finalInventoryTrash,"ENDGÜLTIG");assert.equal((await db.select().from(s.cards).where(eq(s.cards.id,trackingCard.id))).length,0);assert.equal((await db.select().from(s.inventoryLoans).where(eq(s.inventoryLoans.id,trackedLoan.id))).length,0);await assert.rejects(access(join(env.UPLOAD_DIR,inventoryFile)));
 // Only explicit whole-container purges may bypass immutable-content guards.
 const finalBookEntry=await moveToTrash(admin,"cashbook",bookId,"LÖSCHEN",{cashbookName:"Immutable cashbook"});
 for(const word of [undefined,"","endgültig","WIEDERHERSTELLEN"])await assert.rejects(purgeTrashEntry(admin,finalBookEntry,word));
 await assert.rejects(purgeTrashEntry(owner,finalBookEntry,"ENDGÜLTIG"),/Administrationskonten/);
 await assert.rejects(purgeTrashEntry(null,finalBookEntry,undefined),/Aufbewahrungsfrist/);
 await purgeTrashEntry(admin,finalBookEntry,"ENDGÜLTIG");assert.equal((await db.select().from(s.cashbooks).where(eq(s.cashbooks.id,bookId))).length,0);assert.equal((await db.select().from(s.cashbookEntries).where(eq(s.cashbookEntries.id,posted.id))).length,0);await assert.rejects(access(join(env.UPLOAD_DIR,bookFile)));await assert.rejects(restoreTrashEntry(admin,finalBookEntry,"WIEDERHERSTELLEN"));
 const finalAppEntry=await moveToTrash(admin, "board", app.id, "LÖSCHEN", {boardName:app.name});await purgeTrashEntry(admin,finalAppEntry,"ENDGÜLTIG");assert.equal((await db.select().from(s.cards).where(eq(s.cards.id,card.id))).length,0);await assert.rejects(access(join(env.UPLOAD_DIR,filePath)));
 const finalFinance=await moveToTrash(admin,"finance",finance.id,"LÖSCHEN",{financeName:finance.name});await purgeTrashEntry(admin,finalFinance,"ENDGÜLTIG");assert.equal((await db.select().from(s.accounts).where(eq(s.accounts.id,account.id)))[0].financeBoardId,null);
 const expiring=await insert(s.boards,{name:"Expire after 30 days",ownerId:owner.id});const expiringEntry=await moveToTrash(owner, "board", expiring.id, "LÖSCHEN", {boardName:expiring.name});const expiry=(await pool.query("select expires_at from trash_entries where id=$1",[expiringEntry])).rows[0].expires_at;
 await sweepTrash(new Date(new Date(expiry).getTime()-1));assert.equal((await db.select().from(s.boards).where(eq(s.boards.id,expiring.id))).length,1);
 assert.ok(await sweepTrash(new Date(new Date(expiry).getTime()+1))>=1);assert.equal((await db.select().from(s.boards).where(eq(s.boards.id,expiring.id))).length,0);
 const future=new Date(Date.now()+40*24*60*60*1000);future.setUTCHours(0,0,0,0);assert.equal(await runDailyTrashCleanup(future),false,"before 03:00 Berlin no daily run");future.setUTCHours(4);assert.equal(await runDailyTrashCleanup(future),true);assert.equal(await runDailyTrashCleanup(future),false,"same local day is recorded durably");
});
