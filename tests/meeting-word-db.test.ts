// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import "dotenv/config";
import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {eq,inArray} from "drizzle-orm";
import {db,pool} from "../lib/db";
import * as s from "../lib/db/schema";
import * as service from "../lib/meetings/service";
import * as word from "../lib/meetings/word";
import {requireArea} from "../lib/meetings/access";
import {buildMeetingAgendaPdf} from "../lib/meetings/pdf";
import {absPath} from "../lib/attachments";
import {extractPdfText} from "../lib/pdf-text";
import {unzipOffice} from "../lib/zip";
import {wordTemplateFixture} from "./word-template-fixture";
after(()=>pool.end());
test('Word template lifecycle and both exports enforce management rights, live revisions and confidential inclusion',async()=>{
 assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/gremio_workflows_test_/);
 const suffix=randomUUID(),people=await db.insert(s.users).values(['owner','reader','writer','admin','outsider'].map(role=>({username:`word-${role}-${suffix}`,role:role==='admin'?'admin' as const:'user' as const}))).returning();
 const [owner,reader,writer,admin,outsider]=people;
 const areaId=await service.saveArea(owner,null,'Word export area','');
 let meetingId:number|undefined;
 try{
  await service.saveAreaGrant(owner,areaId,'user',reader.id,'read');await service.saveAreaGrant(owner,areaId,'user',writer.id,'write');
  meetingId=await service.saveMeeting(owner,null,{areaId,title:'Official meeting',startsAt:'2026-11-10T18:00',submissionDeadline:'',location:'Room',chair:'Chair',state:'planning'});
  const raw={title:'Public heading',description:'Public content',kind:'discussion',durationMinutes:10,confidential:false,state:'scheduled',motion:'Motion',presenter:'',outcome:'Actual recorded result'};
  await service.createTopic(owner,meetingId,raw);await service.createTopic(owner,meetingId,{...raw,title:'CONFIDENTIAL HEADING',description:'CONFIDENTIAL BODY',confidential:true,section:'non_public'});
  for(const user of [reader,writer,outsider]){await assert.rejects(word.buildMeetingAgendaWord(user,meetingId),/Zugriff/);await assert.rejects(buildMeetingAgendaPdf(user,meetingId),/Zugriff/);}
  await assert.rejects(word.buildMeetingAgendaWord(owner,meetingId),/keine Wordvorlage/);
  const bytes=wordTemplateFixture(),file=new File([new Uint8Array(bytes)],'Official.dotx');
  for(const user of [reader,writer,outsider])await assert.rejects(word.uploadWordTemplate(user,areaId,file,0),/Zugriff/);
  await assert.rejects(word.uploadWordTemplate(owner,areaId,new File(['bad'],'Invalid.dotx'),0));
  await word.uploadWordTemplate(owner,areaId,file,0);
  const first=await requireArea(owner,areaId,'manage');assert.equal(first.wordTemplateRevision,1);assert.equal(first.wordTemplateName,'Official.dotx');
  assert.deepEqual(await readFile(absPath(first.wordTemplatePath!)),bytes,'retained template is byte-identical');
  await assert.rejects(word.uploadWordTemplate(owner,areaId,file,0),/zwischenzeitlich/);
  const info=await word.wordTemplateSettings(owner,areaId);assert.ok(info);assert.equal(info.configuration.styles.publicTopic,'TOP1');
  await assert.rejects(word.saveWordConfiguration(owner,areaId,{...info.configuration,styles:{...info.configuration.styles,body:'unknown'}},1),/Absatzformatvorlage/);
  const config={...info.configuration,styles:{...info.configuration.styles,publicTopic:'NTOP1'}};
  await word.saveWordConfiguration(owner,areaId,config,1);
  await assert.rejects(word.saveWordConfiguration(owner,areaId,config,1),/zwischenzeitlich/);
  for(const user of [owner,admin]){
   const output=await word.buildMeetingAgendaWord(user,meetingId),xml=unzipOffice(output).find(f=>f.name==='word/document.xml')!.data.toString('utf8');
   assert.match(xml,/CONFIDENTIAL HEADING/);assert.match(xml,/CONFIDENTIAL BODY/);assert.match(xml,/Actual recorded result/);assert.match(xml,/w:pStyle w:val="NTOP1"/);
   const {text}=await extractPdfText(await buildMeetingAgendaPdf(user,meetingId));assert.match(text,/CONFIDENTIAL HEADING/);assert.match(text,/CONFIDENTIAL BODY/);
  }
  const before=createHash('sha256').update(bytes).digest('hex');await word.buildMeetingAgendaWord(owner,meetingId);assert.equal(createHash('sha256').update(await readFile(absPath(first.wordTemplatePath!))).digest('hex'),before);
  const races=await Promise.allSettled([word.uploadWordTemplate(owner,areaId,file,2),word.uploadWordTemplate(admin,areaId,file,2)]);assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
  const current=await requireArea(owner,areaId,'manage');assert.equal(current.wordTemplateRevision,3);assert.notEqual(current.wordTemplatePath,first.wordTemplatePath);await assert.rejects(readFile(absPath(first.wordTemplatePath!)));
  await assert.rejects(word.removeWordTemplate(owner,areaId,2),/zwischenzeitlich/);await word.removeWordTemplate(owner,areaId,3);
  await assert.rejects(readFile(absPath(current.wordTemplatePath!)));assert.equal((await requireArea(owner,areaId)).wordTemplatePath,null);await assert.rejects(word.buildMeetingAgendaWord(owner,meetingId),/keine Wordvorlage/);
  assert.ok((await buildMeetingAgendaPdf(owner,meetingId)).length>0,'PDF works without a Word template');
 }finally{
  const current=await requireArea(owner,areaId);if(current.wordTemplatePath)await word.removeWordTemplate(owner,areaId,current.wordTemplateRevision);
  if(meetingId)await service.deleteMeeting(owner,meetingId);await db.delete(s.meetingAreas).where(eq(s.meetingAreas.id,areaId));await db.delete(s.users).where(inArray(s.users.id,people.map(p=>p.id)));
 }
});
