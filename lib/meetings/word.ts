// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {readFile} from "node:fs/promises";
import {eq,sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {meetingAreas,meetingDocuments,meetings,type User} from "@/lib/db/schema";
import {absPath,deleteStoredFile,displayFileName,saveNamedBuffer} from "@/lib/attachments";
import {MAX_UPLOAD_BYTES} from "@/lib/constants";
import {env} from "@/lib/env";
import {MeetingError,requireArea,requireMeeting,visibleTopics} from "./access";
import {agendaTopics} from "./agenda";
import {topicKinds,topicStates} from "./validation";
import {buildWordFromTemplate,inspectWordTemplate,validateWordConfiguration,type WordExportTopic,type WordExportLine} from "./word-template";
import type {MeetingWordConfiguration} from "./word-template-types";

function checkRevision(value:number){if(!Number.isSafeInteger(value)||value<0)throw new MeetingError("Bitte die Vorlageneinstellungen neu laden.");}
export async function wordTemplateSettings(user:User,areaId:number){
  const area=await requireArea(user,areaId,"manage");
  if(!area.wordTemplatePath)return null;
  try{return inspectWordTemplate(await readFile(absPath(area.wordTemplatePath)));}
  catch{throw new MeetingError("Die Wordvorlage ist nicht lesbar. Bitte erneut hochladen.");}
}
export async function uploadWordTemplate(user:User,areaId:number,file:File,revision:number){
  await requireArea(user,areaId,"manage");checkRevision(revision);
  if(!/\.(docx|dotx)$/i.test(file.name)||!file.size||file.size>MAX_UPLOAD_BYTES)throw new MeetingError("Bitte eine DOCX- oder DOTX-Vorlage bis 25 MB auswählen.");
  const bytes=Buffer.from(await file.arrayBuffer());let configuration:MeetingWordConfiguration;
  try{configuration=inspectWordTemplate(bytes).configuration;}catch(error){throw new MeetingError(error instanceof Error?error.message:"Ungültige Wordvorlage.");}
  const stored=await saveNamedBuffer(`meeting-areas/${areaId}/word-templates`,displayFileName(file.name),bytes,"application/octet-stream");
  let oldPath:string|null=null;
  try{
    await db.transaction(async tx=>{
      const [current]=await tx.select().from(meetingAreas).where(eq(meetingAreas.id,areaId)).for("update");
      if(!current||current.wordTemplateRevision!==revision)throw new MeetingError("Die Vorlage wurde zwischenzeitlich geändert. Bitte neu laden.");
      await requireArea(user,areaId,"manage");oldPath=current.wordTemplatePath;
      await tx.update(meetingAreas).set({wordTemplatePath:stored.relPath,wordTemplateName:stored.filename,wordConfiguration:configuration,wordTemplateRevision:revision+1}).where(eq(meetingAreas.id,areaId));
      await tx.update(meetings).set({revision:sql`${meetings.revision}+1`}).where(eq(meetings.areaId,areaId));
    });
  }catch(error){await deleteStoredFile(stored.relPath);throw error;}
  if(oldPath)await deleteStoredFile(oldPath);
}
export async function saveWordConfiguration(user:User,areaId:number,configuration:MeetingWordConfiguration,revision:number){
  const area=await requireArea(user,areaId,"manage");checkRevision(revision);
  if(!area.wordTemplatePath)throw new MeetingError("Bitte zuerst eine Wordvorlage hochladen.");
  try{validateWordConfiguration(await readFile(absPath(area.wordTemplatePath)),configuration);}catch(error){throw new MeetingError(error instanceof Error?error.message:"Ungültige Vorlageneinstellungen.");}
  await db.transaction(async tx=>{
    const [current]=await tx.select().from(meetingAreas).where(eq(meetingAreas.id,areaId)).for("update");
    if(!current||current.wordTemplateRevision!==revision||current.wordTemplatePath!==area.wordTemplatePath)throw new MeetingError("Die Vorlage wurde zwischenzeitlich geändert. Bitte neu laden.");
    await requireArea(user,areaId,"manage");
    await tx.update(meetingAreas).set({wordConfiguration:configuration,wordTemplateRevision:revision+1}).where(eq(meetingAreas.id,areaId));
    await tx.update(meetings).set({revision:sql`${meetings.revision}+1`}).where(eq(meetings.areaId,areaId));
  });
}
export async function removeWordTemplate(user:User,areaId:number,revision:number){
  await requireArea(user,areaId,"manage");checkRevision(revision);let path:string|null=null;
  await db.transaction(async tx=>{
    const [current]=await tx.select().from(meetingAreas).where(eq(meetingAreas.id,areaId)).for("update");
    if(!current||current.wordTemplateRevision!==revision)throw new MeetingError("Die Vorlage wurde zwischenzeitlich geändert. Bitte neu laden.");
    await requireArea(user,areaId,"manage");path=current.wordTemplatePath;
    await tx.update(meetingAreas).set({wordTemplatePath:null,wordTemplateName:null,wordConfiguration:null,wordTemplateRevision:revision+1}).where(eq(meetingAreas.id,areaId));
    await tx.update(meetings).set({revision:sql`${meetings.revision}+1`}).where(eq(meetings.areaId,areaId));
  });
  if(path)await deleteStoredFile(path);
}
export async function buildMeetingAgendaWord(user:User,id:number):Promise<Buffer>{
  const meeting=await requireMeeting(user,id,"manage"),area=await requireArea(user,meeting.areaId,"manage");
  if(!area.wordTemplatePath||!area.wordConfiguration)throw new MeetingError("Für diesen Sitzungsbereich ist keine Wordvorlage hinterlegt.");
  const template=await readFile(absPath(area.wordTemplatePath));
  const topics=agendaTopics(await visibleTopics(user,id),meeting),items:WordExportTopic[]=[];let elapsed=0;
  for(const topic of topics){
    const time=meeting.startsAt?new Date(meeting.startsAt.getTime()+elapsed*60000).toLocaleTimeString("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit"}):"";
    const lines:WordExportLine[]=[`${topicStates[topic.state]}${topic.transferred?" · Weitergegeben":""}${topic.confidential?" · Vertraulich":""}`,`${time?`${time} Uhr · `:""}${topic.durationMinutes} Minuten · ${topicKinds[topic.kind]}`];elapsed+=topic.durationMinutes;
    if(topic.presenter)lines.push(`Verantwortlich: ${topic.presenter}`);
    if(topic.isFinanceItem&&topic.financeDetails){const d=topic.financeDetails,href=new URL(`/intern/card/${d.cardId}`,env.APP_BASE_URL).href;lines.push({text:`Interne Karte: ${href}`,href},`Antragsteller: ${d.applicant}`,`Konto: ${d.account}`,`Haushaltstitel: ${d.budgetTitle}`,`Beantragter Betrag: ${d.amount||"—"}`);}
    if(topic.description)lines.push(topic.description);
    if(topic.motion?.trim())lines.push(`Beschlussvorschlag: ${topic.motion}`,{text:"Abstimmung: Dafür / Dagegen / Enthaltung",bold:true});
    if(topic.outcome)lines.push(`Ergebnis / Notiz: ${topic.outcome}`);
    const docs=await db.select({filename:meetingDocuments.filename}).from(meetingDocuments).where(eq(meetingDocuments.topicId,topic.id));
    if(docs.length)lines.push("Freigegebene Sitzungsunterlagen",...docs.map(doc=>doc.filename));
    items.push({...topic,lines});
  }
  const date=meeting.startsAt,values={SITZUNGSTITEL:meeting.title,GREMIUM:meeting.committee,ORT:meeting.location,SITZUNGSLEITUNG:meeting.chair,DATUM:date?date.toLocaleDateString("de-DE",{timeZone:"Europe/Berlin"}):"",BEGINN:date?date.toLocaleTimeString("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit"}):"",ISO_DATUM:date?.toISOString()??""};
  let output:Buffer;
  try{output=buildWordFromTemplate(template,area.wordConfiguration,{topics:items,settings:meeting,values});}catch(error){throw new MeetingError(error instanceof Error?error.message:"Der Wordexport konnte nicht erstellt werden.");}
  const current=await requireMeeting(user,id,"manage"),currentArea=await requireArea(user,meeting.areaId,"manage");
  if(current.revision!==meeting.revision||currentArea.wordTemplateRevision!==area.wordTemplateRevision)throw new MeetingError("Die Sitzung oder Vorlage wurde zwischenzeitlich geändert. Bitte den Export erneut starten.");
  return output;
}
