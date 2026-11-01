// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { parseApiId } from "@/lib/api";
import { requireMeeting, visibleTopics, meetingAccessLevel, canManageMeeting, accessibleMeetings, requireArea } from "@/lib/meetings/access";
import { agendaTopics } from "@/lib/meetings/agenda";
import { meetingStates } from "@/lib/meetings/validation";
import { formatDateTime } from "@/lib/dates";
import { Agenda } from "@/components/meetings/Agenda";
import { MeetingActionForm } from "@/components/meetings/ActionForm";
import { TopicFields } from "@/components/meetings/Fields";
import { MeetingDialog } from "@/components/meetings/Dialog";
import { MeetingWorkspace } from "@/components/meetings/Workspace";
import {TopicStatusControl} from "@/components/meetings/TopicStatusControl";
import {TopicTransferControl} from "@/components/meetings/TopicTransferControl";
import {TopicTrail} from "@/components/meetings/TopicTrail";
import {topicDestinations} from "@/lib/meetings/history";
import { createTopicAction,applyAreaDefaultsToMeetingAction } from "../actions";
import { db } from "@/lib/db";
import { meetingDocuments } from "@/lib/db/schema";
import { inArray, count } from "drizzle-orm";
export default async function MeetingPage({params}:{params:Promise<{id:string}>}) {
  const user=await requireUser();const id=parseApiId((await params).id);if(!id)notFound();
  const meeting=await requireMeeting(user,id).catch(()=>null);if(!meeting)notFound();
  const topics=await visibleTopics(user,id);const writer=await meetingAccessLevel(user,meeting)==="write";const manager=canManageMeeting(user,meeting);
  const exportArea=manager?await requireArea(user,meeting.areaId,"manage"):null;
  const defaultsArea=exportArea??(writer?await requireArea(user,meeting.areaId):null);
  const editable=writer&&meeting.state!=="closed";
  const canPropose=meeting.state!=="closed"&&(writer||!meeting.submissionDeadline||meeting.submissionDeadline.getTime()>=Date.now());
  const agenda=agendaTopics(topics,meeting);const agendaIds=new Set(agenda.map(topic=>topic.id));const others=topics.filter(topic=>["deferred","withdrawn"].includes(topic.state)||!agendaIds.has(topic.id));
  const documentCounts=topics.length?await db.select({topicId:meetingDocuments.topicId,total:count()}).from(meetingDocuments).where(inArray(meetingDocuments.topicId,topics.map(t=>t.id))).groupBy(meetingDocuments.topicId):[];
  const parentOptions=topics.filter(topic=>!topic.transferred&&topic.parentId==null&&["scheduled","treated"].includes(topic.state)).map(topic=>({value:String(topic.id),label:`Unter-TOP von: ${topic.title}`}));
  const duration=agenda.reduce((sum,t)=>sum+t.durationMinutes,0);
  const destinations=await topicDestinations(user,topics.map(t=>t.id));
  const targetMeetings=[];
  if(writer)for(const target of await accessibleMeetings(user))if(target.id!==id&&target.state!=="closed"&&await meetingAccessLevel(user,target)==="write")targetMeetings.push(target);
  const actions:Record<number,React.ReactNode>={};
  for(const topic of topics)actions[topic.id]=<>{writer&&!topic.transferred&&<>{editable&&<TopicStatusControl id={topic.id} title={topic.title} state={topic.state} section={topic.section} isMiscellaneous={topic.isMiscellaneous} revision={meeting.revision}/>}{topic.state!=="withdrawn"&&!topic.isMiscellaneous&&<TopicTransferControl id={topic.id} scheduled={topic.state==="scheduled"} targets={targetMeetings.filter(m=>!topic.confidential||canManageMeeting(user,m)).map(m=>({value:String(m.id),label:m.title}))}/>}</>}<div className="w-full"><TopicTrail entries={destinations[topic.id]??[]}/></div></>;
  return <div className="mx-auto max-w-7xl space-y-6">
    <nav aria-label="Sitzungsnavigation" className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-500"><Link href="/intern/sitzungen" className="hover:text-brand-700">Sitzungsbereiche</Link><span>/</span><Link className="break-words hover:text-brand-700" href={`/intern/sitzungen/bereich/${meeting.areaId}`}>{meeting.committee}</Link></nav>
    <header className="flex flex-col items-start justify-between gap-4 sm:flex-row"><div className="min-w-0 w-full flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">{meetingStates[meeting.state]}</span><span className="text-xs text-slate-500">{writer?"Sitzungsplanung":"Teilnahme"}</span></div><h1 className="break-words text-2xl font-bold sm:text-3xl">{meeting.title}</h1></div><div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">
      {canPropose&&<MeetingDialog primary label={writer?"+ TOP anlegen":"+ TOP vorschlagen"} title={writer?"Tagesordnungspunkt anlegen":"Tagesordnungspunkt vorschlagen"}><p className="text-sm text-slate-500">{writer?"Lege einen TOP an und wähle, ob er direkt auf die Tagesordnung kommt.":"Beschreibe dein Anliegen. Die Sitzungsplanung prüft deinen Vorschlag und plant ihn ein."}</p><MeetingActionForm action={createTopicAction} submit={writer?"TOP anlegen":"Vorschlag einreichen"}><input type="hidden" name="meetingId" value={id}/><TopicFields planning={writer} manage={manager} editableState={writer} parentOptions={writer?parentOptions:undefined}/></MeetingActionForm></MeetingDialog>}
      {editable&&!meeting.defaultsApplied&&!!(defaultsArea?.defaultTopics.length||defaultsArea?.includeMiscellaneous)&&<MeetingActionForm action={applyAreaDefaultsToMeetingAction.bind(null,id)} compact submit="Standard-TOPs übernehmen"><input type="hidden" name="revision" value={meeting.revision}/></MeetingActionForm>}
      {writer&&<Link href={`/intern/sitzungen/${id}/einstellungen`} className="btn-secondary max-w-full h-auto min-h-10 py-2 whitespace-normal">Einstellungen</Link>}
    </div></header>
    <div className="grid gap-3 sm:grid-cols-3">{[{label:"Termin",value:meeting.startsAt?formatDateTime(meeting.startsAt):"Termin noch offen"},{label:"Ort / Videokonferenz",value:meeting.location||"Ort noch offen"},{label:"Geplanter Umfang",value:`${agenda.length} TOP${agenda.length===1?"":"s"} · ${duration} Minuten`}].map(info=><div key={info.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3"><p className="text-xs font-medium text-slate-500">{info.label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-900">{info.value}</p></div>)}</div>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <MeetingWorkspace writer={editable} scheduledCount={agenda.length} topics={others.map(t=>({parentState:topics.find(p=>p.id===t.parentId)?.state,id:t.id,title:t.title,description:t.description,presenter:t.presenter,durationMinutes:t.durationMinutes,kind:t.kind,state:t.state,confidential:t.confidential,own:t.createdBy===user.id}))} actions={actions} agenda={<><div className="mb-5"><h2 className="text-lg font-semibold">Tagesordnung</h2><p className="mt-1 text-sm text-slate-500">{editable?"Ziehe TOPs am Griff in die gewünschte Reihenfolge. Haupt-TOPs nehmen ihre Unter-TOPs mit.":"Der geplante Ablauf deiner Sitzung. Öffne einen TOP für Details und Unterlagen."}</p></div><Agenda settings={meeting} actions={actions} meetingId={id} revision={meeting.revision} editable={editable} startsAt={meeting.startsAt?.toISOString()??null} items={agenda.map(({id,title,isFinanceItem,motion,durationMinutes,kind,confidential,presenter,parentId,position,state,section,isMiscellaneous,isFinanceTopic,transferred})=>({id,title,isFinanceItem,motion,isFinanceTopic,transferred,durationMinutes,kind,confidential,presenter,parentId,position,state,section,isMiscellaneous,documentCount:documentCounts.find(d=>d.topicId===id)?.total??0}))}/></>}/>
      <aside className="space-y-4"><section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Rund um die Sitzung</h2><dl className="mt-4 space-y-4 text-sm"><div><dt className="text-xs text-slate-500">Sitzungsleitung</dt><dd className="mt-1 break-words">{meeting.chair||"Noch nicht festgelegt"}</dd></div><div><dt className="text-xs text-slate-500">Einreichungsfrist</dt><dd className="mt-1">{meeting.submissionDeadline?formatDateTime(meeting.submissionDeadline):"Keine Frist festgelegt"}</dd></div></dl>{manager&&<><a href={`/api/meetings/${id}/pdf`} className="btn-secondary mt-5 w-full justify-center max-w-full h-auto min-h-10 py-2 whitespace-normal">Tagesordnung als PDF</a>{exportArea?.wordTemplatePath&&exportArea.wordConfiguration&&<><a href={`/api/meetings/${id}/word`} className="btn-secondary mt-3 w-full justify-center max-w-full h-auto min-h-10 py-2 whitespace-normal">Tagesordnung als Word</a><p className="mt-2 text-xs leading-relaxed text-slate-500">Das Inhaltsverzeichnis muss einmal aktualisiert werden.</p></>}<p className="mt-3 text-xs leading-relaxed text-slate-500">Exporte enthalten auch vertrauliche TOPs und die für dich zugänglichen Finanzantragsdaten. Prüfe vor einer Weitergabe den Empfängerkreis.</p></>}</section>
      <section className="rounded-xl bg-brand-50 p-5"><h2 className="text-sm font-semibold text-brand-900">{meeting.state==="closed"?"Sitzung abgeschlossen":writer?"Vorschläge einplanen":canPropose?"Du möchtest etwas einbringen?":"Einreichung geschlossen"}</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">{meeting.state==="closed"?"Die Tagesordnung und Unterlagen bleiben zum Nachlesen verfügbar.":writer?"Im Reiter Vorschläge findest du eingereichte Themen. Übernimm sie direkt oder öffne einen TOP für die Feinplanung.":canPropose?"Über TOP vorschlagen reichst du dein Thema ein. Den Stand findest du anschließend unter Vorschläge oder in der Tagesordnung.":"Die Frist für neue Vorschläge ist abgelaufen. Die Tagesordnung und Unterlagen kannst du weiterhin ansehen."}</p></section></aside>
    </div>
  </div>;
}
