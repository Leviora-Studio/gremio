// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import * as s from "../lib/db/schema";
import { moveToTrash, restoreTrashEntry } from "../lib/trash";
import { getAccountBudgetCatalogs, getFinanceBudgetTitles } from "../lib/budget-title-catalog";
import { writeBudgetPlan } from "../lib/card-budget-plan-db";
import { lockApplicationCard } from "../lib/card-lock";
import { createCashbook, saveCashbookConfig, saveCashbookDraft, correctCashbookEntry } from "../lib/cashbook/service";
import { defaultCashbookConfig } from "../lib/cashbook-types";
import { canAccessFinanceBoard } from "../lib/finance";
after(() => pool.end());

test("account and cashbook catalogs constrain new titles, preserve history and enforce configuration rights", async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/gremio_workflows_test_/);
  const [owner, writer, reader, outsider] = await db.insert(s.users).values(["owner","writer","reader","outside"].map(name=>({username:`catalog-${name}-${randomUUID()}`,role:name==="owner"?"admin" as const:"user" as const}))).returning();
  const [first, second, inaccessible] = await db.insert(s.financeBoards).values([{name:"First catalog",ownerId:owner.id},{name:"Second catalog",ownerId:owner.id},{name:"Private catalog",ownerId:outsider.id}]).returning();
  await db.insert(s.financePlanItems).values([
    {financeBoardId:first.id,haushaltstitel:"1200",title:"Office materials",plannedAmount:9876543},
    {financeBoardId:first.id,haushaltstitel:"1300",title:"Travel"},
    {financeBoardId:first.id,haushaltstitel:"1400",title:"Events"},
    {financeBoardId:first.id,haushaltstitel:"1200",title:"Paper"},
    {financeBoardId:first.id,haushaltstitel:"9999",title:"Income",kind:"income"},
    {financeBoardId:first.id,haushaltstitel:"",title:"Expense heading"},
    {financeBoardId:second.id,haushaltstitel:"2200",title:"Second office"},
    {financeBoardId:second.id,haushaltstitel:"2210",title:"Second travel"},
  ]);
  const [account, other, unmapped] = await db.insert(s.accounts).values(["one","two","unmapped"].map(name=>({name:`catalog-${name}-${randomUUID()}`}))).returning();
  const output=await mkdtemp(join(tmpdir(),"gremio-catalog-actions-")),entry=join(output,"accounts.cjs");
  await build({entryPoints:[join(process.cwd(),"app/admin/accounts/actions.ts")],outfile:entry,bundle:true,platform:"node",format:"cjs",packages:"external",plugins:[{name:"session",setup(builder){
    builder.onResolve({filter:/^@\/lib\/auth$/},()=>({path:"auth",namespace:"test"}));builder.onResolve({filter:/^next\/cache$/},()=>({path:"cache",namespace:"test"}));
    builder.onLoad({filter:/.*/,namespace:"test"},({path})=>({contents:path==="auth"?'export async function requireUser(){return globalThis.__catalogActor;} export async function requireAdmin(){const user=globalThis.__catalogActor;if(!user?.isActive||user.role!=="admin")throw Error("admin-required");return user;}':'export function revalidatePath(){}',loader:"js"}));
  }}]});
  const require=createRequire(import.meta.url),Module=require("node:module"),loaded=new Module(entry,module);loaded.filename=entry;loaded.paths=module.paths;loaded._compile(await readFile(entry,"utf8"),entry);
  const actor=globalThis as unknown as {__catalogActor?:s.User};actor.__catalogActor=owner;
  const form=(id:unknown)=>{const data=new FormData();data.set("financeBoardId",String(id??""));return data;};
  try {
    for(const invalid of ["bad","1.2","-1","2147483648","2147483647"]){assert.ok((await loaded.exports.assignAccountFinanceBoardAction(account.id,{},form(invalid))).error);assert.equal((await db.select().from(s.accounts).where(eq(s.accounts.id,account.id)))[0].financeBoardId,null);}
    actor.__catalogActor=writer;await assert.rejects(loaded.exports.assignAccountFinanceBoardAction(account.id,{},form(first.id)),/admin-required/);actor.__catalogActor=owner;
    assert.ok((await loaded.exports.assignAccountFinanceBoardAction(account.id,{},form(first.id))).success);
    await loaded.exports.assignAccountFinanceBoardAction(other.id,{},form(second.id));
    const catalog=await getFinanceBudgetTitles(first.id);
    assert.deepEqual(catalog.map(option=>option.value),["1200","1300","1400"]);
    assert.match(catalog[0].label,/1200.*Office materials.*Paper/);assert.doesNotMatch(JSON.stringify(catalog),/9876543|plannedAmount|Income/);
    const catalogs=await getAccountBudgetCatalogs();assert.deepEqual(catalogs[String(account.id)],catalog);assert.deepEqual(catalogs[String(unmapped.id)],[]);
    assert.equal(await canAccessFinanceBoard(writer,first),false,"a board writer need not receive access to the financial overview to choose title codes/names");
    const [board]=await db.insert(s.boards).values({name:"Catalog applications",ownerId:owner.id,isApplicationBoard:true,defaultAccountId:account.id}).returning();
    const [status]=await db.insert(s.boardStatuses).values({boardId:board.id,name:"Accepted",isLockColumn:true}).returning();
    await db.insert(s.boardAccess).values([{boardId:board.id,userId:writer.id,accessLevel:"write"},{boardId:board.id,userId:reader.id,accessLevel:"read"}]);
    const createCard=async()=> (await db.insert(s.cards).values({boardId:board.id,statusId:status.id,title:"Catalog request",applicant:"Synthetic",token:randomUUID()}).returning())[0];
    const card=await createCard();
    for(const [accountId,budgetTitle] of [[account.id,"2200"],[account.id,"9999"],[unmapped.id,"1200"]] as const)await assert.rejects(writeBudgetPlan(writer,card.id,0,[{amount:"10",accountId,budgetTitle}],{confirmAccountChange:true}),/Finanzboard|Haushaltsplan/);
    assert.deepEqual(await db.select().from(s.cardBudgetPlans).where(eq(s.cardBudgetPlans.cardId,card.id)),[]);
    await assert.rejects(writeBudgetPlan(reader,card.id,0,[{amount:"10",budgetTitle:"1200"}]),/Schreibzugriff/);
    const rows=[{amount:"10",accountId:account.id,budgetTitle:"1200"},{amount:"20",accountId:other.id,budgetTitle:"2200"}];
    assert.equal(await writeBudgetPlan(writer,card.id,0,rows,{confirmAccountChange:true}),1);
    await lockApplicationCard(writer,card.id,status.id);
    const correction={confirmAccountChange:true,correction:{reason:"Correct title",confirmation:"BESTÄTIGEN"}};
    await assert.rejects(writeBudgetPlan(writer,card.id,1,[{...rows[0],budgetTitle:"2200"}],correction),/Haushaltsplan/);
    assert.equal(await writeBudgetPlan(writer,card.id,1,[rows[0],{...rows[1],budgetTitle:"2210"}],correction),2);
    const history=await db.select().from(s.cardBudgetPlanCorrections).where(eq(s.cardBudgetPlanCorrections.cardId,card.id));assert.equal(history.length,1);assert.equal(history[0].beforeAllocations[1].budgetTitle,"2200");
    // Removing a catalog entry never rewrites stored allocations. Existing pairs
    // can be retained; the same removed value cannot enter a new application.
    await db.delete(s.financePlanItems).where(and(eq(s.financePlanItems.financeBoardId,first.id),eq(s.financePlanItems.haushaltstitel,"1200")));
    assert.equal(await writeBudgetPlan(writer,card.id,2,[{...rows[0],amount:"9"},{...rows[1],budgetTitle:"2210"}],correction),3);
    await assert.rejects(writeBudgetPlan(writer,card.id,3,[rows[0],rows[0]],correction),/Haushaltsplan/,"a retained historic title cannot be duplicated into new allocations");
    const fresh=await createCard();await assert.rejects(writeBudgetPlan(writer,fresh.id,0,[rows[0]]),/Haushaltsplan/);
    await loaded.exports.assignAccountFinanceBoardAction(account.id,{},form(second.id));
    await assert.rejects(writeBudgetPlan(writer,fresh.id,0,[{amount:"10",budgetTitle:"1300"}]),/Haushaltsplan/);
    assert.equal(await writeBudgetPlan(writer,fresh.id,0,[{amount:"10",budgetTitle:"2200"}]),1);
    const bookId=await createCashbook(owner,"Catalog cashbook");
    const payment={business:true,cardId:null,number:"",receiptIds:[],amount:1000,budgetTitle:"1300",holder:"Synthetic",iban:"DE89370400440532013000",bank:"Bank",purpose:"",place:"",date:""};
    await assert.rejects(saveCashbookDraft(owner,bookId,null,0,payment,"speaker"),/Finanzboard/);
    await assert.rejects(saveCashbookConfig(writer,bookId,0,defaultCashbookConfig,first.id));
    // Use a non-admin owner to prove inaccessible catalog assignment is denied.
    await db.update(s.cashbooks).set({ownerId:writer.id}).where(eq(s.cashbooks.id,bookId));
    await assert.rejects(saveCashbookConfig(writer,bookId,0,defaultCashbookConfig,inaccessible.id),/zugängliches/);
    await db.update(s.cashbooks).set({ownerId:owner.id}).where(eq(s.cashbooks.id,bookId));
    await saveCashbookConfig(owner,bookId,0,defaultCashbookConfig,first.id);
    await assert.rejects(saveCashbookDraft(owner,bookId,null,0,{...payment,budgetTitle:"2200"},"speaker"),/Haushaltsplan/);
    const draft=await saveCashbookDraft(owner,bookId,null,0,payment,"speaker");
    await db.delete(s.financePlanItems).where(and(eq(s.financePlanItems.financeBoardId,first.id),eq(s.financePlanItems.haushaltstitel,"1300")));
    await saveCashbookDraft(owner,bookId,draft,0,{...payment,amount:1100},"speaker");
    await assert.rejects(saveCashbookDraft(owner,bookId,null,0,payment,"speaker"),/Haushaltsplan/);
    const [posted]=await db.insert(s.cashbookEntries).values({cashbookId:bookId,creatorId:owner.id,state:"posted",role:"speaker",authorizedAt:new Date(),data:payment}).returning();
    await assert.rejects(correctCashbookEntry(owner,posted.id,0,{...payment,budgetTitle:"2200"},"Wrong catalog","BESTÄTIGEN"),/Haushaltsplan/);
    const corrected=await correctCashbookEntry(owner,posted.id,0,{...payment,budgetTitle:"1400"},"Valid catalog title","BESTÄTIGEN");
    assert.equal((await db.select().from(s.cashbookEntries).where(eq(s.cashbookEntries.id,posted.id)))[0].data.budgetTitle,"1300");
    assert.equal((await db.select().from(s.cashbookEntries).where(eq(s.cashbookEntries.id,corrected)))[0].data.budgetTitle,"1400");
    const deletedSource=await moveToTrash(owner,"finance",first.id,"LÖSCHEN",{financeName:first.name});
    assert.equal((await db.select().from(s.cashbooks).where(eq(s.cashbooks.id,bookId)))[0].financeBoardId,first.id);
    await restoreTrashEntry(owner,deletedSource,"WIEDERHERSTELLEN");
    const deletedAccountSource=await moveToTrash(owner,"finance",second.id,"LÖSCHEN",{financeName:second.name});
    assert.equal((await db.select().from(s.accounts).where(eq(s.accounts.id,account.id)))[0].financeBoardId,second.id);
    await restoreTrashEntry(owner,deletedAccountSource,"WIEDERHERSTELLEN");
    await saveCashbookConfig(owner,bookId,1,defaultCashbookConfig);assert.equal((await db.select().from(s.cashbooks).where(eq(s.cashbooks.id,bookId)))[0].financeBoardId,first.id,"unrelated settings saves preserve the catalog assignment");
  } finally { delete actor.__catalogActor; await rm(output,{recursive:true,force:true}); }
});
