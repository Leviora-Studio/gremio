// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import {test,after} from "node:test";
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {db,pool} from "../lib/db";
import * as s from "../lib/db/schema";
import * as service from "../lib/meetings/service";
import {requireMeeting,requireTopic,visibleTopics,personalTopics} from "../lib/meetings/access";
import {personalTopicHistory,topicDestinations} from "../lib/meetings/history";
after(()=>pool.end());
const values={title:"Topic",description:"Shared topic",motion:"",presenter:"",kind:"discussion",durationMinutes:10,confidential:false,state:"scheduled",outcome:""};
test("personal proposals retain the private master and show deferral, scheduling and completion across meetings",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
 const [owner,reader,outsider]=await db.insert(s.users).values(['owner','reader','outsider'].map(x=>({username:'topic-history-'+x+'-'+randomUUID()}))).returning();
 const area=await service.saveArea(owner,null,'History '+randomUUID(),'');await service.saveAreaGrant(owner,area,'user',reader.id,'read');
 const ids:number[]=[];let root:number|undefined;
 try{
  for(const title of ['November','December','January'])ids.push(await service.saveMeeting(owner,null,{areaId:area,title,startsAt:'2026-11-12T18:00',submissionDeadline:'',location:'',chair:'',state:'planning'}));
  const rev=async(id:number)=>(await requireMeeting(owner,id)).revision;
  root=await service.createTopic(reader,null,{...values,title:'My proposal',state:'proposed',outcome:'Private draft outcome'});
  const first=await service.transferTopic(reader,root,ids[0],true);
  assert.equal((await requireTopic(reader,first)).topic.outcome,"","readers cannot prefill a session outcome through their private draft");
  assert.equal((await requireTopic(reader,root)).topic.meetingId,null);assert.ok((await personalTopics(reader)).some(t=>t.id===root));
  await assert.rejects(service.transferTopic(reader,root,ids[1],true),/bereits/);
  await assert.rejects(service.setTopicStatus(reader,first,'scheduled',await rev(ids[0])),/Zugriff/);
  await service.setTopicStatus(owner,first,'scheduled',await rev(ids[0]));assert.equal((await personalTopicHistory(reader,root)).at(-1)?.state,'scheduled');
  assert.deepEqual((await personalTopicHistory(reader,root)).map(h=>h.state),['proposed','scheduled']);
  await service.setTopicStatus(owner,first,'scheduled',await rev(ids[0]));assert.equal((await personalTopicHistory(reader,root)).length,2,'same status creates no duplicate activity');
  await service.setTopicStatus(owner,first,'deferred',await rev(ids[0]));const second=await service.transferTopic(reader,root,ids[1],true);
  assert.deepEqual((await personalTopicHistory(reader,root)).map(h=>[h.meetingTitle,h.state]),[['November','proposed'],['November','scheduled'],['November','deferred'],['December','proposed']]);
  assert.equal((await topicDestinations(owner,[first]))[first][0].id,second);
  await assert.rejects(service.setTopicStatus(owner,first,'scheduled',await rev(ids[0])),/andere Sitzung/);
  assert.equal((await requireTopic(owner,first)).topic.state,'deferred','conflicting status change rolls back');
  assert.equal((await personalTopicHistory(reader,root)).length,4,'rolled-back transitions never enter the activity log');
  await service.setTopicStatus(owner,second,'scheduled',await rev(ids[1]));assert.equal((await personalTopicHistory(reader,root)).at(-1)?.state,'scheduled');
  await service.setTopicStatus(owner,second,'treated',await rev(ids[1]));assert.equal((await personalTopics(reader)).some(t=>t.id===root),false);assert.ok((await personalTopics(reader,'past')).some(t=>t.id===root),'completed topics remain in personal past topics');assert.equal((await personalTopics(outsider,'past')).some(t=>t.id===root),false,'past topics remain private');
  assert.equal((await requireTopic(reader,root)).topic.state,'treated','completed private source is retained, not deleted');
  await service.setTopicStatus(owner,second,'deferred',await rev(ids[1]));assert.ok((await personalTopics(reader)).some(t=>t.id===root),'undoing completion restores the private master');assert.equal((await personalTopics(reader,'past')).some(t=>t.id===root),false,'restored topics leave past topics');
  const third=await service.transferTopic(owner,second,ids[2],true);assert.equal((await visibleTopics(owner,ids[1])).find(t=>t.id===second)?.state,'deferred');
  assert.equal((await requireTopic(owner,third)).topic.originTopicId,root);
  const events=await personalTopicHistory(reader,root);assert.deepEqual(events.map(h=>h.state),['proposed','scheduled','deferred','proposed','scheduled','treated','deferred','proposed']);assert.ok(events.every(h=>h.occurredAt&&!h.baseline));assert.equal(new Set(events.map(h=>h.eventId)).size,events.length);
  await assert.rejects(service.setTopicStatus(owner,third,'unknown',await rev(ids[2])),/Ungültiger/);
  await service.saveAreaGrant(owner,area,'user',reader.id,'remove');assert.deepEqual(await personalTopicHistory(reader,root),[],'revoked session access leaks no titles or state');
  await assert.rejects(personalTopicHistory(outsider,root));
 }finally{for(const id of ids)await service.deleteMeeting(owner,id);if(root)await service.deleteTopic(reader,root);await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id,area));for(const u of [owner,reader,outsider])await db.delete(s.users).where(eq(s.users.id,u.id));}
});
test("moving planned TOPs hides their source while all other states and mixed child history remain visible",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
 const [owner]=await db.insert(s.users).values({username:'move-history-'+randomUUID()}).returning();const area=await service.saveArea(owner,null,'Moves '+randomUUID(),'');const ids:number[]=[];
 try{
  for(const title of ['Source','Target'])ids.push(await service.saveMeeting(owner,null,{areaId:area,title,startsAt:'2026-11-12T18:00',submissionDeadline:'',location:'',chair:'',state:'planning'}));
  for(const state of ['scheduled','treated','deferred','withdrawn','proposed']){
   const source=await service.createTopic(owner,ids[0],{...values,title:'State '+state,state});if(state==='withdrawn'){await assert.rejects(service.transferTopic(owner,source,ids[1],true),/nicht übernommen/);await service.setTopicStatus(owner,source,'scheduled',(await requireMeeting(owner,ids[0])).revision);assert.equal((await requireTopic(owner,source)).topic.state,'scheduled');continue;}const target=await service.transferTopic(owner,source,ids[1],true);const rows=await visibleTopics(owner,ids[0]);
   assert.equal(rows.some(t=>t.id===source),state!=='scheduled');assert.equal((await requireTopic(owner,source)).topic.state,state);assert.equal((await requireTopic(owner,target)).topic.state,'proposed');
   if(state==='deferred'){
    const {agendaTopics}=await import('../lib/meetings/agenda');assert.ok(agendaTopics(rows).some(t=>t.id===source),'deferred TOP remains in original agenda after transfer');
    const {buildMeetingAgendaPdf}=await import('../lib/meetings/pdf');const bytes=await buildMeetingAgendaPdf(owner,ids[0]);const {extractPdfText}=await import('../lib/pdf-text');const {text}=await extractPdfText(bytes);assert.ok(text.includes('State deferred'));assert.ok(text.includes('Vertagt'));if(process.env.GREMIO_DEFERRED_PDF_OUTPUT)await writeFile(process.env.GREMIO_DEFERRED_PDF_OUTPUT,bytes);
   }
   await assert.rejects(service.setTopicStatus(owner,source,'scheduled',(await requireMeeting(owner,ids[0])).revision),/weitergegeben/);
  }
  const parent=await service.createTopic(owner,ids[0],{...values,title:'Mixed main'});const child=await service.createTopic(owner,ids[0],{...values,title:'Retained child',parentId:parent,state:'treated'});const plannedChild=await service.createTopic(owner,ids[0],{...values,title:'Moved child',parentId:parent});
  await service.transferTopic(owner,parent,ids[1],true);const rows=await visibleTopics(owner,ids[0]);assert.ok(!rows.some(t=>t.id===parent||t.id===plannedChild));assert.equal(rows.find(t=>t.id===child)?.parentId,null,'retained child remains visible even if its planned parent moved');assert.equal(rows.find(t=>t.id===child)?.state,'treated');
  await assert.rejects(service.setTopicStatus(owner,child,'scheduled',(await requireMeeting(owner,ids[0])).revision),/weitergegeben/);
 }finally{for(const id of ids)await service.deleteMeeting(owner,id);await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id,area));await db.delete(s.users).where(eq(s.users.id,owner.id));}
});

test("financial TOPs carry references forward while re-planning checks board write rights and updates the new date atomically",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
 const finance=await import('../lib/meetings/finance');
 const [owner,writer]=await db.insert(s.users).values(['owner','writer'].map(x=>({username:'financial-forward-'+x+'-'+randomUUID()}))).returning();
 const area=await service.saveArea(owner,null,'Financial history '+randomUUID(),'');const [board]=await db.insert(s.boards).values({name:'Financial history',ownerId:owner.id}).returning();const [status]=await db.insert(s.boardStatuses).values({boardId:board.id,name:'Planned'}).returning();const ids:number[]=[];
 try{
  await service.saveAreaGrant(owner,area,'user',writer.id,'write');await db.insert(s.boardAccess).values({boardId:board.id,userId:writer.id,accessLevel:'read'});await db.insert(s.boardCardFields).values({boardId:board.id,fieldKey:'meeting',visible:true});await finance.saveFinanceConfiguration(owner,area,board.id,[],status.id);
  for(const [index,title] of ['First','Second'].entries())ids.push(await service.saveMeeting(owner,null,{areaId:area,title,startsAt:`2026-11-${12+index}T18:00`,submissionDeadline:'',location:'',chair:'',state:'planning'}));
  const root=await service.createTopic(owner,ids[0],{...values,title:'Financial applications'});await finance.markFinanceTopic(owner,root,true,(await requireMeeting(owner,ids[0])).revision);
  const [card]=await db.insert(s.cards).values({boardId:board.id,statusId:status.id,title:'Application',applicant:'Example',token:randomUUID(),position:7}).returning();const child=await finance.planFinanceCard(owner,root,card.id,(await requireMeeting(owner,ids[0])).revision);
  await service.setTopicStatus(owner,child,'deferred',(await requireMeeting(owner,ids[0])).revision);
  const newRoot=await service.transferTopic(owner,root,ids[1],true);assert.ok(!(await visibleTopics(owner,ids[0])).some(t=>t.id===root));assert.equal((await visibleTopics(owner,ids[0])).find(t=>t.id===child)?.state,'deferred');
  const newChild=(await visibleTopics(owner,ids[1])).find(t=>t.parentId===newRoot)!;assert.equal(newChild.financeCardId,card.id);assert.equal((await db.select().from(s.cards).where(eq(s.cards.id,card.id)))[0].meeting,'2026-11-12','proposing does not mutate the card');
  await service.setTopicStatus(owner,newRoot,'scheduled',(await requireMeeting(owner,ids[1])).revision);
  await assert.rejects(service.setTopicStatus(writer,newChild.id,'scheduled',(await requireMeeting(owner,ids[1])).revision),/Schreibzugriff/);assert.equal((await requireTopic(owner,newChild.id)).topic.state,'proposed');
  await service.setTopicStatus(owner,newChild.id,'scheduled',(await requireMeeting(owner,ids[1])).revision);const fresh=(await db.select().from(s.cards).where(eq(s.cards.id,card.id)))[0];assert.equal(fresh.meeting,'2026-11-13');assert.equal(fresh.position,7);
 }finally{for(const id of ids)await service.deleteMeeting(owner,id);await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id,area));await db.delete(s.boards).where(eq(s.boards.id,board.id));for(const u of [owner,writer])await db.delete(s.users).where(eq(s.users.id,u.id));}
});

test("withdrawn personal proposals stay in the agenda, can be proposed anew by their author or privately resolved",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
 const [owner,author,other]=await db.insert(s.users).values(['owner','author','other'].map(x=>({username:'withdrawn-'+x+'-'+randomUUID()}))).returning();const area=await service.saveArea(owner,null,'Withdrawn '+randomUUID(),'');const meetings:number[]=[],masters:number[]=[];
 try{
  await service.saveAreaGrant(owner,area,'user',author.id,'read');for(const title of ['First','Second'])meetings.push(await service.saveMeeting(owner,null,{areaId:area,title,startsAt:'2026-11-12T18:00',submissionDeadline:'',location:'',chair:'',state:'planning'}));
  const root=await service.createTopic(author,null,{...values,title:'Author proposal',state:'proposed'});masters.push(root);const first=await service.transferTopic(author,root,meetings[0],true);const rev=async(m:number)=>(await requireMeeting(owner,m)).revision;
  await assert.rejects(service.resolvePersonalTopic(author,root),/zurückgezogen/);
  await service.setTopicStatus(owner,first,'withdrawn',await rev(meetings[0]));const {agendaTopics}=await import('../lib/meetings/agenda');assert.ok(agendaTopics(await visibleTopics(author,meetings[0])).some(t=>t.id===first));assert.ok((await personalTopics(author)).some(t=>t.id===root));assert.equal((await personalTopicHistory(author,root)).at(-1)?.state,'withdrawn');
  await assert.rejects(service.transferTopic(owner,first,meetings[1],true),/nicht übernommen/);await service.setTopicStatus(owner,first,'scheduled',await rev(meetings[0]));assert.equal((await requireTopic(owner,first)).topic.state,'scheduled');await service.setTopicStatus(owner,first,'withdrawn',await rev(meetings[0]));await service.saveTopic(owner,first,{...values,state:'deferred'},await rev(meetings[0]),false);assert.equal((await requireTopic(owner,first)).topic.state,'deferred');await service.setTopicStatus(owner,first,'withdrawn',await rev(meetings[0]));
  const next=await service.transferTopic(author,root,meetings[1],true);assert.equal((await requireTopic(owner,first)).topic.state,'withdrawn');assert.equal((await requireTopic(author,next)).topic.state,'proposed');assert.deepEqual((await personalTopicHistory(author,root)).map(h=>h.state),['proposed','withdrawn','scheduled','withdrawn','deferred','withdrawn','proposed']);
  await assert.rejects(service.resolvePersonalTopic(author,root),/aktive Einplanung/);await service.setTopicStatus(owner,next,'withdrawn',await rev(meetings[1]));await assert.rejects(service.resolvePersonalTopic(owner,root),/Zugriff/);await assert.rejects(service.resolvePersonalTopic(other,root),/Zugriff/);
  await service.resolvePersonalTopic(author,root);assert.ok(!(await personalTopics(author)).some(t=>t.id===root));assert.ok((await personalTopics(author,'past')).some(t=>t.id===root));assert.ok((await requireTopic(author,root)).topic.resolvedAt);assert.equal((await requireTopic(owner,next)).topic.state,'withdrawn','private resolution never marks the session TOP treated');assert.equal((await personalTopicHistory(author,root)).at(-1)?.state,'resolved');const count=(await personalTopicHistory(author,root)).length;await service.resolvePersonalTopic(author,root);assert.equal((await personalTopicHistory(author,root)).length,count,'resolution is idempotent');await assert.rejects(service.transferTopic(author,root,meetings[0],true),/erledigt/);await service.setTopicStatus(owner,next,'scheduled',await rev(meetings[1]));assert.equal((await requireTopic(author,root)).topic.resolvedAt,null,'reopening an occurrence restores the private topic to current topics');assert.ok((await personalTopics(author)).some(t=>t.id===root));await service.setTopicStatus(owner,next,'withdrawn',await rev(meetings[1]));await service.resolvePersonalTopic(author,root);
  const direct=await service.createTopic(author,meetings[0],{...values,title:'Direct submission',state:'proposed'});await service.setTopicStatus(owner,direct,'withdrawn',await rev(meetings[0]));assert.ok((await personalTopics(author)).some(t=>t.id===direct),'direct withdrawn submissions also appear for their author');const adopted=await service.personalTopicForAction(author,direct);masters.push(adopted);assert.notEqual(adopted,direct);assert.equal((await requireTopic(author,direct)).topic.state,'withdrawn');assert.equal((await personalTopicHistory(author,adopted))[0].baseline,true,'legacy direct state is not presented with an invented transition time');assert.equal((await personalTopics(author)).filter(t=>t.id===direct||t.id===adopted).length,1);await service.resolvePersonalTopic(author,adopted);assert.ok((await personalTopics(author,'past')).some(t=>t.id===adopted));
  const directForward=await service.createTopic(author,meetings[0],{...values,title:'Forwarded direct submission',state:'proposed'});const forwarded=await service.transferTopic(owner,directForward,meetings[1],true);assert.equal((await requireTopic(author,forwarded)).topic.createdBy,author.id,'forwarding preserves the original submitter');await service.setTopicStatus(owner,forwarded,'withdrawn',await rev(meetings[1]));assert.ok((await personalTopics(author)).some(t=>t.id===forwarded));const forwardedMaster=await service.personalTopicForAction(author,forwarded);masters.push(forwardedMaster);await service.resolvePersonalTopic(author,forwardedMaster);
  const parent=await service.createTopic(owner,meetings[0],{...values,title:'Parent'});const child=await service.createTopic(owner,meetings[0],{...values,title:'Withdrawn child',parentId:parent,state:'withdrawn'});const copied=await service.transferTopic(owner,parent,meetings[1],true);assert.equal((await visibleTopics(owner,meetings[1])).some(t=>t.parentId===copied&&t.title==='Withdrawn child'),false);assert.ok(agendaTopics(await visibleTopics(owner,meetings[0])).some(t=>t.id===child));
 }finally{for(const id of meetings)await service.deleteMeeting(owner,id);for(const id of masters)await service.deleteTopic(author,id);await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id,area));for(const u of [owner,author,other])await db.delete(s.users).where(eq(s.users.id,u.id));}
});
