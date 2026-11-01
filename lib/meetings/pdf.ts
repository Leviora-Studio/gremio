// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { PDFDocument, StandardFonts, rgb, PDFString } from "pdf-lib";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { meetingDocuments, meetingTopics, type User } from "@/lib/db/schema";
import { requireMeeting, visibleTopics } from "./access";
import { agendaTopics, agendaSections, agendaSectionLabels } from "./agenda";
import { topicKinds,topicStates } from "./validation";
import { formatDateTime } from "@/lib/dates";
import { winAnsiSafe, wrapText } from "@/lib/pdf";
/** Confidential TOPs are excluded. Financial projections use the exporter's live board/field permissions. */
export async function buildMeetingAgendaPdf(user: User, id: number): Promise<Uint8Array> {
  const meeting = await requireMeeting(user,id);
  // visibleTopics detaches sub-TOPs from hidden parents; confidentiality is inherited from the stored parent.
  const stored = await db.select({id:meetingTopics.id,parentId:meetingTopics.parentId,confidential:meetingTopics.confidential}).from(meetingTopics).where(eq(meetingTopics.meetingId,id));
  const confidential = new Set(stored.filter(topic=>topic.confidential).map(topic=>topic.id));
  const storedParent = new Map(stored.map(topic=>[topic.id,topic.parentId]));
  const isConfidential = (topicId:number) => { const parentId = storedParent.get(topicId); return confidential.has(topicId) || parentId != null && confidential.has(parentId); };
  const topics = agendaTopics((await visibleTopics(user,id)).filter(topic=>!topic.confidential&&!isConfidential(topic.id)),meeting);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28,841.89]), y=780;
  function line(text: string, emphasis=false, size=11, link?:string, tone?:ReturnType<typeof rgb>) {
    const font=emphasis?bold:regular;
    for (const paragraph of winAnsiSafe(text,{keepNewlines:true}).split("\n")) {
      for(const part of wrapText(paragraph,font,size,483)) {
        if(y<65+size){page=pdf.addPage([595.28,841.89]);y=780;}
        page.drawText(part,{x:56,y,size,font,color:tone??(link?rgb(.15,.3,.6):rgb(.1,.15,.23))});
        if(link&&part){const ref=pdf.context.register(pdf.context.obj({Type:"Annot",Subtype:"Link",Rect:[56,y-2,56+font.widthOfTextAtSize(part,size),y+size],Border:[0,0,0],A:{Type:"Action",S:"URI",URI:PDFString.of(link)}}));page.node.addAnnot(ref);}
        y-=size+5;
      }
    }
    y-=7;
  }
  line("Tagesordnung",true,22);line(meeting.title,true,15);
  if(meeting.committee)line(meeting.committee);
  line(meeting.startsAt?`Beginn: ${formatDateTime(meeting.startsAt)}`:"Termin noch offen");
  if(meeting.location)line(`Ort / Videokonferenz: ${meeting.location}`);
  if(meeting.chair)line(`Sitzungsleitung: ${meeting.chair}`);
  line("Enthält die Tagesordnung und die für dich zugänglichen Finanzantragsdaten. Vertrauliche TOPs sind ausgenommen. Bei Weitergabe den Empfängerkreis beachten.");
  let elapsed=0;
  for(const section of agendaSections(meeting)) {
    line(agendaSectionLabels[section],true,16);
    const sectionTopics=topics.filter(topic=>topic.section===section);
    if(!sectionTopics.length)line("Keine TOPs in diesem Bereich eingeplant.");
  for(const topic of sectionTopics) {
    if(y<170){page=pdf.addPage([595.28,841.89]);y=780;}
    line(`TOP ${topic.number}: ${topic.title}`,true,topic.parentId==null?14:12);
    line(`${topicStates[topic.state]}${topic.transferred?" · Weitergegeben":""}`,true,10,undefined,["deferred","withdrawn"].includes(topic.state)?rgb(.7,.1,.1):undefined);
    const time=meeting.startsAt?new Date(meeting.startsAt.getTime()+elapsed*60000).toLocaleTimeString("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit"}):"";
    line(`${time?`${time} Uhr | `:""}${topic.durationMinutes} Minuten | ${topicKinds[topic.kind]}`);
    elapsed+=topic.durationMinutes;
    if(topic.presenter)line(`Verantwortlich: ${topic.presenter}`);
    if(topic.isFinanceItem&&topic.financeDetails){
      const details=topic.financeDetails;
      const url=new URL(`/intern/card/${details.cardId}`,env.APP_BASE_URL).href;
      line(`Interne Karte: ${url}`,false,10,url);
      line(`Antragsteller: ${details.applicant}`);
      line(`Konto: ${details.account}`);
      line(`Haushaltstitel: ${details.budgetTitle}`);
      line(`Beantragter Betrag: ${details.amount||"—"}`);
    }
    if(topic.description)line(topic.description);
    if(topic.motion){line("Beschlussvorschlag",true);line(topic.motion);}
    const docs=await db.select({filename:meetingDocuments.filename}).from(meetingDocuments).where(eq(meetingDocuments.topicId,topic.id));
    if(docs.length){line("Freigegebene Sitzungsunterlagen",true);for(const doc of docs)line(doc.filename);}
  }
  }
  if(!topics.length)line("Noch keine freigegebenen TOPs eingeplant.");
  await requireMeeting(user,id);
  return pdf.save();
}
