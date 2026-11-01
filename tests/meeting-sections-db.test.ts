// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {eq,inArray} from "drizzle-orm";
import {db,pool} from "../lib/db";
import * as s from "../lib/db/schema";
import * as service from "../lib/meetings/service";
import * as access from "../lib/meetings/access";
import {agendaTopics} from "../lib/meetings/agenda";
import {buildMeetingAgendaPdf} from "../lib/meetings/pdf";
import {extractPdfText} from "../lib/pdf-text";

after(()=>pool.end());
const values={title:"Topic",description:"Body",motion:"Motion",presenter:"Speaker",kind:"discussion",durationMinutes:10,confidential:false,state:"scheduled",outcome:""};
test("agenda sections preserve permissions, hierarchy, scheduling, transfers and PDF order",async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
 const suffix=randomUUID();
 const people=await db.insert(s.users).values(["owner","writer","reader"].map(role=>({username:`sections-${role}-${suffix}`}))).returning();
 const [owner,writer,reader]=people;
 let areaId:number|undefined;
 try{
  areaId=await service.saveArea(owner,null,"Sections","");
  await service.saveAreaGrant(owner,areaId,"user",writer.id,"write");
  await service.saveAreaGrant(owner,areaId,"user",reader.id,"read");
  const meetingValues={areaId,title:"Meeting",startsAt:"2026-11-10T18:00",submissionDeadline:"",location:"",chair:"",state:"planning"};
  const mid=await service.saveMeeting(owner,null,meetingValues);
  const target=await service.saveMeeting(owner,null,{...meetingValues,title:"Next meeting"});
  const rev=async()=>(await access.requireMeeting(owner,mid)).revision;
  const topic=async(id:number)=>(await db.select().from(s.meetingTopics).where(eq(s.meetingTopics.id,id)))[0];
  const agenda=async()=>agendaTopics(await access.visibleTopics(reader,mid),await access.requireMeeting(reader,mid));
  const publicId=await service.createTopic(writer,mid,{...values,title:"Public item"});
  const proposal=await service.createTopic(reader,mid,{...values,title:"Nonpublic item",section:"non_public"});
  assert.equal((await topic(proposal)).state,"proposed");assert.equal((await topic(proposal)).section,"public","readers cannot choose a section");
  await assert.rejects(service.setTopicStatus(reader,proposal,"scheduled",await rev(),"non_public"),/Zugriff/);
  await service.setTopicStatus(writer,proposal,"scheduled",await rev(),"non_public");
  const child=await service.createTopic(writer,mid,{...values,title:"Child item",parentId:proposal,section:"public"});
  assert.equal((await topic(child)).section,"non_public","DB inherits the root section");
  const hidden=await service.createTopic(owner,mid,{...values,title:"SECRET ITEM",parentId:proposal,confidential:true});
  const other=await service.createTopic(writer,mid,{...values,title:"Second nonpublic",section:"non_public"});
  assert.deepEqual((await agenda()).map(t=>[t.id,t.number]),[[publicId,"1"],[proposal,"I"],[child,"I.1"],[other,"II"]]);
  assert.equal((await access.requireTopic(reader,proposal)).topic.confidential,false,"nonpublic does not imply confidential");
  await assert.rejects(access.requireTopic(reader,hidden));
  await service.reorderTopics(writer,mid,[publicId,other,proposal,child],await rev());
  assert.deepEqual((await agenda()).map(t=>[t.id,t.number]),[[publicId,"1"],[other,"I"],[proposal,"II"],[child,"II.1"]]);
  await assert.rejects(service.reorderTopics(writer,mid,[other,publicId,proposal,child],await rev()),/zusammen/);
  const stale=await rev();
  await assert.rejects(service.saveAgendaSettings(writer,areaId,{publicNumbering:"roman",nonPublicNumbering:"arabic",firstSection:"non_public"}),/Zugriff/);
  await assert.rejects(service.saveAgendaSettings(owner,areaId,{publicNumbering:"bad",nonPublicNumbering:"arabic",firstSection:"non_public"}),/gültige/);
  await service.saveAgendaSettings(owner,areaId,{publicNumbering:"roman",nonPublicNumbering:"arabic",firstSection:"non_public"});
  await assert.rejects(service.setTopicStatus(writer,proposal,"deferred",stale),/zwischenzeitlich/);
  assert.deepEqual((await agenda()).map(t=>[t.id,t.number]),[[other,"1"],[proposal,"2"],[child,"2.1"],[publicId,"I"]]);
  await service.reorderTopics(writer,mid,[proposal,child,other,publicId],await rev());
  await service.setTopicStatus(writer,proposal,"deferred",await rev());
  assert.equal((await topic(proposal)).section,"non_public");
  await service.scheduleTopic(writer,proposal,await rev());
  assert.equal((await topic(proposal)).section,"non_public");
  const pdf=(await extractPdfText(await buildMeetingAgendaPdf(owner,mid))).text;
  assert.match(pdf,/Nicht öffentlicher Teil/);assert.match(pdf,/Öffentlicher Teil/);
  assert.match(pdf,/TOP 1: Nonpublic item/);assert.match(pdf,/TOP 1.1: Child item/);assert.match(pdf,/TOP I: Public item/);
  assert.ok(pdf.indexOf("TOP 1: Nonpublic item")<pdf.indexOf("TOP I: Public item"));assert.match(pdf,/SECRET ITEM/);await assert.rejects(buildMeetingAgendaPdf(reader,mid),/Zugriff/);
  // Changing a root moves every child, including those hidden from the writer.
  await service.saveTopic(writer,proposal,{...await topic(proposal),section:"public"},await rev(),false);
  assert.equal((await topic(child)).section,"public");assert.equal((await topic(hidden)).section,"public");
  await service.setTopicStatus(writer,proposal,"scheduled",await rev(),"non_public");
  await service.setTopicStatus(writer,proposal,"deferred",await rev());
  const copied=await service.transferTopic(owner,proposal,target,true);
  assert.equal((await topic(proposal)).state,"deferred");assert.equal((await topic(proposal)).section,"non_public");
  assert.equal((await topic(copied)).section,"non_public");
  const copiedChildren=await db.select().from(s.meetingTopics).where(eq(s.meetingTopics.parentId,copied));
  assert.ok(copiedChildren.length>=1);assert.ok(copiedChildren.every(t=>t.section==="non_public"));
  // Detaching via deletion retains the section in stored children.
  await service.deleteTopic(owner,copied);
  for(const row of copiedChildren){assert.equal((await topic(row.id)).parentId,null);assert.equal((await topic(row.id)).section,"non_public");}
 }finally{
  if(areaId){const rows=await db.select().from(s.meetings).where(eq(s.meetings.areaId,areaId));for(const m of rows)await service.deleteMeeting(owner,m.id);await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id,areaId));}
  await db.delete(s.users).where(inArray(s.users.id,people.map(p=>p.id)));
 }
});
