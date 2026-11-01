// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {asc,and,eq,sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {meetingAreaTemplates,meetingAreas,type User} from "@/lib/db/schema";
import {canManageTemplates} from "@/lib/auth";
import {sanitizeSingleLine,sanitizeMultiLine} from "@/lib/text";
import {MeetingError,requireArea} from "./access";
import {defaultTopicsInput,type DefaultTopic} from "./presets";
function manager(user:User){if(!user.isActive||!canManageTemplates(user))throw new MeetingError("Vorlagenverwaltung erfordert Admin- oder Vorlagenverwalterrechte.");}
function topics(raw:unknown):DefaultTopic[]{const parsed=defaultTopicsInput.safeParse(raw);if(!parsed.success)throw new MeetingError("Bitte Titel, Dauer und maximal 200 Standard-TOPs prüfen.");return parsed.data;}
function revision(value:number){if(!Number.isSafeInteger(value)||value<0)throw new MeetingError("Bitte neu laden.");}
export async function meetingTemplates(user:User){if(!user.isActive)throw new MeetingError("Kein Zugriff.");return db.select().from(meetingAreaTemplates).orderBy(asc(meetingAreaTemplates.name));}
export async function saveMeetingTemplate(user:User,id:number|null,name:string,description:string,raw:unknown,rev:number){
 manager(user);revision(rev);name=sanitizeSingleLine(name);description=sanitizeMultiLine(description);
 if(!name||name.length>120||description.length>5000)throw new MeetingError("Bitte einen gültigen Vorlagennamen und eine Beschreibung angeben.");
 const values={name,description,topics:topics(raw)};
 if(id==null){const [created]=await db.insert(meetingAreaTemplates).values(values).returning();return created.id;}
 const updated=await db.update(meetingAreaTemplates).set({...values,revision:sql`${meetingAreaTemplates.revision}+1`}).where(and(eq(meetingAreaTemplates.id,id),eq(meetingAreaTemplates.revision,rev))).returning({id:meetingAreaTemplates.id});
 if(!updated.length)throw new MeetingError("Die Vorlage wurde zwischenzeitlich geändert. Bitte neu laden.");return id;
}
export async function deleteMeetingTemplate(user:User,id:number,rev:number){
 manager(user);revision(rev);const rows=await db.delete(meetingAreaTemplates).where(and(eq(meetingAreaTemplates.id,id),eq(meetingAreaTemplates.revision,rev))).returning({id:meetingAreaTemplates.id});
 if(!rows.length)throw new MeetingError("Die Vorlage wurde zwischenzeitlich geändert. Bitte neu laden.");
}
export async function saveAreaDefaults(user:User,areaId:number,raw:unknown,rev:number,includeMiscellaneous?:boolean){
 await requireArea(user,areaId,"manage");revision(rev);const defaults=topics(raw);
 const rows=await db.update(meetingAreas).set({defaultTopics:defaults,...(includeMiscellaneous!==undefined?{includeMiscellaneous}:{}),defaultTopicsRevision:sql`${meetingAreas.defaultTopicsRevision}+1`}).where(and(eq(meetingAreas.id,areaId),eq(meetingAreas.defaultTopicsRevision,rev))).returning({id:meetingAreas.id});
 if(!rows.length)throw new MeetingError("Die Standard-TOPs wurden zwischenzeitlich geändert. Bitte neu laden.");
}
export async function applyMeetingTemplate(user:User,areaId:number,templateId:number|null,rev:number){
 await requireArea(user,areaId,"manage");revision(rev);
 await db.transaction(async tx=>{
  const [area]=await tx.select().from(meetingAreas).where(eq(meetingAreas.id,areaId)).for("update");
  if(!area||area.defaultTopicsRevision!==rev)throw new MeetingError("Die Standard-TOPs wurden zwischenzeitlich geändert. Bitte neu laden.");
  const [template]=templateId==null?[]:await tx.select().from(meetingAreaTemplates).where(eq(meetingAreaTemplates.id,templateId));
  if(templateId!=null&&!template)throw new MeetingError("Die Vorlage existiert nicht mehr.");
  await tx.update(meetingAreas).set({defaultTopics:topics(template?.topics??[]),defaultTopicsTemplateId:templateId,defaultTopicsRevision:rev+1}).where(eq(meetingAreas.id,areaId));
 });
}
