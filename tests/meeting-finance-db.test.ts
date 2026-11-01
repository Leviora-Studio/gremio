// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {PDFDocument,PDFName,PDFArray,PDFDict,PDFString} from "pdf-lib";
import {eq,and} from "drizzle-orm";
import {db,pool} from "../lib/db";
import * as s from "../lib/db/schema";
import * as service from "../lib/meetings/service";
import {requireMeeting,visibleTopics} from "../lib/meetings/access";
import {saveFinanceConfiguration,markFinanceTopic,planFinanceCard,financeCandidates} from "../lib/meetings/finance";
import {uploadWordTemplate,buildMeetingAgendaWord,removeWordTemplate} from "../lib/meetings/word";
import {wordTemplateFixture} from "./word-template-fixture";
import {unzipOffice} from "../lib/zip";
import {buildMeetingAgendaPdf} from "../lib/meetings/pdf";
import {writeBudgetPositions} from "../lib/card-budget-db";
import {sortByUserFinanceBoardOrder} from "../lib/board-order";
import {getVisibleFieldKeys} from "../lib/board-fields";
after(()=>pool.end());
test("financial agenda planning is atomic, permission-filtered, revision-safe and preserves budget data",async()=>{
  assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
  const suffix=randomUUID();
  const [owner,reader,writer]=await db.insert(s.users).values(["owner","reader","writer"].map(role=>({username:`finance-agenda-${role}-${suffix}`}))).returning();
  const [board,foreign]=await db.insert(s.boards).values([{name:"Financial applications",ownerId:owner.id},{name:"Unrelated",ownerId:owner.id}]).returning();
  const [source,target,other]=await db.insert(s.boardStatuses).values([{boardId:board.id,name:"Incoming"},{boardId:board.id,name:"Scheduled",isInstructionTrigger:true},{boardId:foreign.id,name:"Other"}]).returning();
  const [account]=await db.insert(s.accounts).values({name:`Finance fixture ${suffix}`}).returning();
  const [area]=await db.insert(s.meetingAreas).values({name:"Committee",ownerId:owner.id}).returning();
  const mid=await service.saveMeeting(owner,null,{areaId:area.id,title:"Budget meeting",startsAt:"2026-11-11T00:30",submissionDeadline:"",location:"Room",chair:"Chair",state:"planning"});
  const raw={title:"Financial applications",description:"",motion:"",presenter:"",kind:"decision",durationMinutes:5,confidential:false,state:"scheduled",outcome:""};
  const root=await service.createTopic(owner,mid,raw),second=await service.createTopic(owner,mid,{...raw,title:"Other root"});
  const rev=async()=>(await requireMeeting(owner,mid)).revision;
  const [card,already,excluded]=await db.insert(s.cards).values([{boardId:board.id,statusId:source.id,title:"Cultural event",number:"AN-2026-0042",applicant:"Alex Example",token:randomUUID(),budgetTitle:"1001",accountId:account.id,requestedAmount:123456,meeting:"2026-01-01"},{boardId:board.id,statusId:target.id,title:"Already in target",applicant:"Example",token:randomUUID(),position:17},{boardId:foreign.id,statusId:other.id,title:"Foreign card",applicant:"Example",token:randomUUID()}]).returning();
  try {
    await service.saveAreaGrant(owner,area.id,"user",reader.id,"read");await service.saveAreaGrant(owner,area.id,"user",writer.id,"write");
    await db.insert(s.boardAccess).values({boardId:board.id,userId:writer.id,accessLevel:"read"});
    await db.insert(s.boardCardFields).values(["meeting","number","applicant","account","budget_title","requested_amount"].map(fieldKey=>({boardId:board.id,fieldKey,visible:true})));
    await assert.rejects(saveFinanceConfiguration(writer,area.id,board.id,[],target.id),/Zugriff/);
    await assert.rejects(saveFinanceConfiguration(owner,area.id,board.id,[other.id],target.id),/gültige/);
    await assert.rejects(saveFinanceConfiguration(owner,area.id,board.id,[],other.id),/gültige/);
    await assert.rejects(saveFinanceConfiguration(owner,area.id,board.id,[source.id],target.id,'{{notes}}'),/Kartenfeld/);
    await assert.rejects(saveFinanceConfiguration(owner,area.id,board.id,[source.id],target.id,'{{unknown}}'),/Kartenfeld/);
    await assert.rejects(saveFinanceConfiguration(owner,area.id,board.id,[source.id],target.id,'{{requested_amount'),/Kartenfeld/);
    await saveFinanceConfiguration(owner,area.id,board.id,[source.id,target.id],target.id,'Bis zu {{requested_amount}} für {{title}} durch {{applicant}}.');
    await markFinanceTopic(owner,root,true,await rev());
    await assert.rejects(markFinanceTopic(owner,second,true,await rev()),/bereits/);
    await assert.rejects(planFinanceCard(reader,root,card.id,await rev()),/Zugriff/);
    await assert.rejects(planFinanceCard(writer,root,card.id,await rev()),/Schreibzugriff/);
    await db.update(s.boardAccess).set({accessLevel:"write"}).where(eq(s.boardAccess.userId,writer.id));
    assert.equal((await financeCandidates(writer,root)).length,2);
    assert.equal((await financeCandidates(writer,root)).some(c=>c.id===excluded.id),false);
    await assert.rejects(planFinanceCard(owner,root,excluded.id,await rev()),/Quellspalte/);
    const beforeRevision=await rev();
    await assert.rejects(planFinanceCard(owner,root,card.id,beforeRevision-1),/zwischenzeitlich/);
    assert.equal((await db.select().from(s.cards).where(eq(s.cards.id,card.id)))[0].statusId,source.id);
    const child=await planFinanceCard(writer,root,card.id,beforeRevision);
    const fresh=(await db.select().from(s.cards).where(eq(s.cards.id,card.id)))[0];
    assert.equal(fresh.statusId,target.id);assert.equal(fresh.meeting,"2026-11-11","Berlin day, not UTC day");assert.ok(fresh.instructionDate,"existing status triggers run");
    assert.equal(fresh.requestedAmount,123456);assert.equal(fresh.budgetRevision,card.budgetRevision);
    assert.equal((await financeCandidates(owner,root)).some(c=>c.id===card.id),false);
    await assert.rejects(planFinanceCard(owner,root,card.id,await rev()),/bereits/);
    const current=(await visibleTopics(owner,mid)).find(t=>t.id===child)!;
    assert.equal(current.motion,'Bis zu 1.234,56 € für Cultural event durch Alex Example.');
    await saveFinanceConfiguration(owner,area.id,board.id,[source.id,target.id],target.id,'Neuer Vorschlag {{title}}');
    assert.equal((await visibleTopics(owner,mid)).find(t=>t.id===child)?.motion,current.motion,'existing TOP retains its own template');
    assert.equal(current.title,"AN-2026-0042 Cultural event");assert.equal(current.financeDetails?.applicant,"Alex Example");assert.match(current.financeDetails?.amount??"",/1.234,56/);
    const hidden=(await visibleTopics(reader,mid)).find(t=>t.id===child)!;
    assert.ok(!JSON.stringify(hidden).includes("Cultural event"));assert.equal(hidden.financeDetails,undefined);assert.equal(hidden.financeCardId,null);assert.ok(!hidden.motion.includes("Alex Example"));assert.ok(!hidden.motion.includes("1.234,56"));assert.ok(!hidden.motion.includes("Cultural event"));
    const stored=(await db.select().from(s.meetingTopics).where(eq(s.meetingTopics.id,child)))[0];assert.equal(stored.motion,"Bis zu {{requested_amount}} für {{title}} durch {{applicant}}.");assert.equal(stored.title,"Finanzantrag","no card metadata persisted as shared TOP title");
    await assert.rejects(markFinanceTopic(owner,root,false,await rev()),/zuerst/);
    await assert.rejects(service.deleteTopic(owner,root),/zuerst/);
    await assert.rejects(service.saveTopic(owner,child,{...raw,parentId:second},await rev(),false),/zugeordnet/);
    await db.update(s.boardCardFields).set({visible:false}).where(and(eq(s.boardCardFields.boardId,board.id),eq(s.boardCardFields.fieldKey,"meeting")));
    const child2=await planFinanceCard(owner,root,already.id,await rev());assert.equal((await visibleTopics(owner,mid)).find(t=>t.id===child2)?.motion,"Neuer Vorschlag Already in target");
    const same=(await db.select().from(s.cards).where(eq(s.cards.id,already.id)))[0];assert.equal(same.position,17,"same target retains position");assert.equal(same.meeting,null,"disabled meeting field preserved");
    const positions=[{id:randomUUID(),accountId:account.id,budgetTitle:"2001",description:"First",requestedAmount:200,approvedAmount:null,actualAmount:null},{id:randomUUID(),accountId:account.id,budgetTitle:"2002",description:"Second",requestedAmount:300,approvedAmount:null,actualAmount:null}];
    await db.transaction(async tx=>writeBudgetPositions(tx,fresh,positions,fresh.budgetRevision,await getVisibleFieldKeys(board.id)));
    const multi=(await visibleTopics(owner,mid)).find(t=>t.id===child)!;assert.equal(multi.financeDetails?.budgetTitle,"2001, 2002");assert.equal(multi.financeDetails?.amount,"5,00 €");assert.match(multi.motion,/5,00 €/);
    const pdfBytes=await buildMeetingAgendaPdf(owner,mid);const pdf=await PDFDocument.load(pdfBytes);
    const links=pdf.getPages().flatMap(page=>{const arr=page.node.lookup(PDFName.of("Annots"),PDFArray);return arr?arr.asArray().map(ref=>{const d=pdf.context.lookup(ref,PDFDict);return d.lookup(PDFName.of("A"),PDFDict).lookup(PDFName.of("URI"),PDFString).decodeText();}):[];});
    assert.ok(links.some(url=>url.endsWith('/intern/card/'+card.id)));
    await uploadWordTemplate(owner,area.id,new File([new Uint8Array(wordTemplateFixture())],"Financial.dotx"),0);
    const wordParts=unzipOffice(await buildMeetingAgendaWord(owner,mid)),wordDocument=wordParts.find(f=>f.name==="word/document.xml")!.data.toString("utf8"),wordRels=wordParts.find(f=>f.name==="word/_rels/document.xml.rels")!.data.toString("utf8");
    assert.match(wordDocument,/<w:hyperlink r:id="gremioCard/);assert.ok(wordRels.includes(`/intern/card/${card.id}`));assert.match(wordRels,/TargetMode="External"/);
    if(process.env.GREMIO_FINANCE_PDF_OUTPUT)await writeFile(process.env.GREMIO_FINANCE_PDF_OUTPUT,pdfBytes);
    await db.update(s.boardCardFields).set({visible:false}).where(and(eq(s.boardCardFields.boardId,board.id),eq(s.boardCardFields.fieldKey,"applicant")));
    assert.equal((await visibleTopics(owner,mid)).find(t=>t.id===child)?.financeDetails?.applicant,"Nicht freigegeben");assert.ok(!(await visibleTopics(owner,mid)).find(t=>t.id===child)?.motion.includes("Alex Example"));
    await db.delete(s.boardAccess).where(eq(s.boardAccess.userId,writer.id));assert.equal((await visibleTopics(writer,mid)).find(t=>t.id===child)?.financeDetails,undefined);
    await assert.rejects(buildMeetingAgendaPdf(reader,mid),/Zugriff/);await assert.rejects(buildMeetingAgendaPdf(writer,mid),/Zugriff/);
    await db.update(s.boards).set({ownerId:writer.id}).where(eq(s.boards.id,board.id));
    const hiddenWord=unzipOffice(await buildMeetingAgendaWord(owner,mid));
    assert.ok(!hiddenWord.find(f=>f.name==="word/_rels/document.xml.rels")!.data.toString("utf8").includes(`/intern/card/${card.id}`));
    await db.update(s.boards).set({ownerId:owner.id}).where(eq(s.boards.id,board.id));
    await db.delete(s.cards).where(eq(s.cards.id,card.id));assert.equal((await visibleTopics(owner,mid)).find(t=>t.id===child)?.financeDetails,undefined);assert.ok(!(await visibleTopics(owner,mid)).find(t=>t.id===child)?.motion.includes("Cultural event"));
    await saveFinanceConfiguration(owner,area.id,null,[],null,'Neuer Vorschlag {{title}}');
    assert.equal((await db.select().from(s.meetingAreas).where(eq(s.meetingAreas.id,area.id)))[0].financeBoardId,null);
    await service.deleteTopic(owner,child);await service.deleteTopic(owner,child2);await markFinanceTopic(owner,root,false,await rev());
  } finally {
    const [currentArea]=await db.select().from(s.meetingAreas).where(eq(s.meetingAreas.id,area.id));if(currentArea?.wordTemplatePath)await removeWordTemplate(owner,area.id,currentArea.wordTemplateRevision);
    await db.delete(s.meetings).where(eq(s.meetings.id,mid));await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id,area.id));await db.delete(s.boards).where(eq(s.boards.id,board.id));await db.delete(s.boards).where(eq(s.boards.id,foreign.id));await db.delete(s.accounts).where(eq(s.accounts.id,account.id));for(const u of [owner,reader,writer])await db.delete(s.users).where(eq(s.users.id,u.id));
  }
});

test("finance board queries match migrated columns after adding meeting motion settings",async()=>{
  assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
  for(const table of [s.financeBoardAccounts,s.financeBoardExpenseAccounts,s.financeBoardAccess,s.financeBoardSources,s.financePlanItems,s.userFinanceBoardOrder,s.meetingAreas]){
    // A real SELECT catches accidental ORM columns that TypeScript/builds accept.
    await db.select().from(table).limit(0);
  }
  assert.deepEqual(await sortByUserFinanceBoardOrder(0,[{id:2,name:"Z"},{id:1,name:"A"}]),[{id:1,name:"A"},{id:2,name:"Z"}]);
});
