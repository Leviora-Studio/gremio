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
import {requireArea,requireMeeting,visibleTopics} from "../lib/meetings/access";
import {saveMeetingTemplate,saveAreaDefaults,applyMeetingTemplate,deleteMeetingTemplate} from "../lib/meetings/templates";
import {regularitiesDefaults} from "../lib/meetings/presets";
import {agendaTopics} from "../lib/meetings/agenda";
after(()=>pool.end());
test('central templates and area snapshots create independent default TOPs atomically without changing earlier sessions',async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
 const people=await db.insert(s.users).values(['owner','writer','reader','manager'].map(role=>({username:`area-template-${role}-${randomUUID()}`,role:role==='manager'?'template_manager' as const:'user' as const}))).returning();
 const [owner,writer,reader,manager]=people;const areaId=await service.saveArea(owner,null,'Default topics','');let templateId:number|undefined;
 const meetingIds:number[]=[];
 const create=async()=>{const id=await service.saveMeeting(writer,null,{areaId,title:'Default session',startsAt:'2026-11-10T18:00',submissionDeadline:'',location:'',chair:'',state:'planning'});meetingIds.push(id);return id;};
 try{
  await service.saveAreaGrant(owner,areaId,'user',writer.id,'write');await service.saveAreaGrant(owner,areaId,'user',reader.id,'read');
  const existing=await create();assert.equal((await visibleTopics(owner,existing)).length,0);
  await assert.rejects(saveMeetingTemplate(owner,null,'Denied','',[],0),/Vorlagen/);
  templateId=await saveMeetingTemplate(manager,null,'Regularities '+randomUUID(),'',regularitiesDefaults,0);
  await assert.rejects(saveAreaDefaults(writer,areaId,regularitiesDefaults,0),/Zugriff/);
  await assert.rejects(applyMeetingTemplate(reader,areaId,templateId,0),/Zugriff/);
  await applyMeetingTemplate(owner,areaId,templateId,0);
  assert.equal((await visibleTopics(owner,existing)).length,0,'settings never backfill sessions automatically');
  const selected=await requireArea(owner,areaId);await saveAreaDefaults(owner,areaId,selected.defaultTopics,selected.defaultTopicsRevision,true);
  const first=await create(),second=await create();
  const firstTopics=await visibleTopics(owner,first),secondTopics=await visibleTopics(owner,second);
  assert.equal(firstTopics.length,7);assert.equal(firstTopics.filter(t=>t.parentId!=null).length,5);assert.ok(firstTopics.filter(t=>!t.isMiscellaneous).every(t=>t.section==='opening'&&t.state==='scheduled'));
  const miscellaneous=firstTopics.find(t=>t.isMiscellaneous)!;assert.equal(miscellaneous.title,'Sonstiges');assert.equal(miscellaneous.section,'public');
  assert.ok(!firstTopics.some(t=>secondTopics.some(other=>other.id===t.id)));
  assert.equal((await requireMeeting(owner,first)).defaultsApplied,true);
  const root=firstTopics.find(t=>t.parentId==null&&!t.isMiscellaneous)!;
  await service.saveTopic(writer,root.id,{...root,title:'Session-specific title'},(await requireMeeting(writer,first)).revision,false);
  assert.equal((await visibleTopics(owner,second)).find(t=>t.parentId==null)?.title,'Begrüßung und Regularien');
  const current=await requireArea(owner,areaId),edited=structuredClone(current.defaultTopics);edited[0].children[0].description='Area-specific instructions';
  await saveAreaDefaults(owner,areaId,edited,current.defaultTopicsRevision);
  await assert.rejects(saveAreaDefaults(owner,areaId,[],current.defaultTopicsRevision),/zwischenzeitlich/);
  assert.equal((await db.select().from(s.meetingAreaTemplates).where(eq(s.meetingAreaTemplates.id,templateId)))[0].topics[0].children[0].description,regularitiesDefaults[0].children[0].description);
  assert.notEqual(firstTopics.find(t=>t.parentId===root.id)?.description,'Area-specific instructions');
  const third=await create();assert.ok((await visibleTopics(owner,third)).some(t=>t.description==='Area-specific instructions'));
  const rev=(await requireMeeting(owner,existing)).revision;
  const results=await Promise.allSettled([service.applyAreaDefaultsToMeeting(writer,existing,rev),service.applyAreaDefaultsToMeeting(writer,existing,rev)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await visibleTopics(owner,existing)).length,7);
  await assert.rejects(service.applyAreaDefaultsToMeeting(writer,existing,(await requireMeeting(writer,existing)).revision),/bereits/);
  await service.createTopic(writer,first,{title:'Public business',description:'',motion:'',presenter:'',kind:'discussion',durationMinutes:5,confidential:false,state:'scheduled',outcome:'',section:'public'});
  const numbered=agendaTopics(await visibleTopics(owner,first));assert.equal(numbered.find(t=>t.title==='Public business')?.number,'2');
  const currentMeeting=await requireMeeting(owner,first);
  assert.equal(numbered.at(-1)?.id,miscellaneous.id);
  await assert.rejects(service.reorderTopics(writer,first,[miscellaneous.id,...numbered.filter(t=>t.id!==miscellaneous.id).map(t=>t.id)],currentMeeting.revision));
  await assert.rejects(service.saveTopic(writer,miscellaneous.id,{...miscellaneous,section:'non_public'},currentMeeting.revision,false),/Sonstiges/);
  await assert.rejects(service.setTopicStatus(writer,miscellaneous.id,'scheduled',currentMeeting.revision,'opening'),/Sonstiges/);
  await deleteMeetingTemplate(manager,templateId,0);templateId=undefined;
  assert.equal((await requireArea(owner,areaId)).defaultTopicsTemplateId,null);assert.equal((await requireArea(owner,areaId)).defaultTopics.length,1);
  await service.setTopicStatus(writer,root.id,'deferred',(await requireMeeting(writer,first)).revision);assert.equal((await visibleTopics(writer,first)).find(t=>t.id===root.id)?.section,'opening');
  await assert.rejects(service.saveMeeting(reader,null,{areaId,title:'Denied',startsAt:'',submissionDeadline:'',location:'',chair:'',state:'planning'}),/Zugriff/);
 }finally{
  for(const id of meetingIds)await service.deleteMeeting(owner,id);await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id,areaId));if(templateId)await db.delete(s.meetingAreaTemplates).where(eq(s.meetingAreaTemplates.id,templateId));await db.delete(s.users).where(inArray(s.users.id,people.map(p=>p.id)));
 }
});
