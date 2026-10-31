// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import { MeetingDialog } from "@/components/meetings/Dialog";
import { requireUser } from "@/lib/auth";
import { accessibleAreas, accessibleMeetings, meetingAccessLevel, personalTopics } from "@/lib/meetings/access";
import { readableCard } from "@/lib/meetings/service";
import { MeetingActionForm } from "@/components/meetings/ActionForm";
import { TopicFields } from "@/components/meetings/Fields";
import {TopicTransferControl} from "@/components/meetings/TopicTransferControl";
import {TopicTrail} from "@/components/meetings/TopicTrail";
import {personalTopicHistory} from "@/lib/meetings/history";
import { saveAreaAction, createTopicAction, resolvePersonalTopicAction } from "./actions";
import { parseApiId } from "@/lib/api";
import { notFound } from "next/navigation";
export const metadata = { title: "Sitzungen — Gremio" };
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ card?: string }> }) {
  const user = await requireUser(); const query = await searchParams;
  const areas = await accessibleAreas(user);
  const rows = await accessibleMeetings(user); const backlog = await personalTopics(user); const past = await personalTopics(user,"past");
  let cardId: number | null = null;
  if (query.card != null) { cardId = parseApiId(query.card); if (!cardId) notFound(); try { await readableCard(user,cardId); } catch { notFound(); } }
  const targets:{value:string;label:string}[] = [];
  for(const meeting of rows){const level=await meetingAccessLevel(user,meeting);if(meeting.state!=="closed"&&(level==="write"||!meeting.submissionDeadline||meeting.submissionDeadline.getTime()>=Date.now()))targets.push({value:String(meeting.id),label:meeting.title});}
  const history:Record<number,Awaited<ReturnType<typeof personalTopicHistory>>>={};
  for(const topic of [...backlog,...past])history[topic.id]=await personalTopicHistory(user,topic.id);
  return <div className="mx-auto max-w-6xl space-y-6">
    <div><h1 className="text-2xl font-bold">Sitzungsbereiche</h1><p className="mt-1 text-sm text-slate-500">Sitzungen pro Gremium planen. Freigaben gelten gemeinsam für den gesamten Bereich.</p></div>
    <MeetingDialog primary label="+ Neuer Sitzungsbereich" title="Sitzungsbereich anlegen"><MeetingActionForm action={saveAreaAction.bind(null,null)} submit="Bereich anlegen"><label className="label">Bezeichnung<input name="name" className="input" required maxLength={200}/></label><label className="label">Beschreibung<textarea name="description" className="input" maxLength={5000}/></label></MeetingActionForm></MeetingDialog>
    {!areas.length&&<div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><h2 className="font-semibold">Dein erster Sitzungsbereich</h2><p className="mt-2 text-sm text-slate-500">Lege einen Bereich für dein Gremium an. Darin bündelst du Sitzungen und vergibst die gemeinsamen Freigaben.</p></div>}
    <div className="grid gap-4 md:grid-cols-2">{areas.map(area=><Link key={area.id} href={`/intern/sitzungen/bereich/${area.id}`} className="card block space-y-2 p-5 hover:border-brand-400"><h2 className="break-words text-lg font-semibold">{area.name}</h2><p className="line-clamp-2 break-words text-sm text-slate-500">{area.description||"Sitzungen und Tagesordnungen dieses Gremiums"}</p><div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500"><span>{rows.filter(m=>m.areaId===area.id&&m.state!=="closed").length} offene Sitzungen</span><span className="font-medium text-brand-700">Bereich öffnen →</span></div></Link>)}</div>
    <details className="card space-y-4 p-5" open={cardId!=null}><summary className="cursor-pointer font-semibold">Mein Themenspeicher <span className="ml-2 text-sm font-normal text-slate-500">{backlog.length+past.length} {backlog.length+past.length===1?"Thema":"Themen"}</span></summary><p className="text-sm text-slate-500">Aktuelle Themen findest du hier, behandelte oder erledigte unter „Vergangene Themen“. Vorschläge an Sitzungen sind eigenständige Einträge; ihren Verlauf siehst du direkt bei deinem Thema.</p>
      <details open={cardId!=null}><summary className="cursor-pointer font-semibold">+ Thema anlegen{cardId!=null?" mit Kartenverknüpfung":""}</summary><div className="mt-4"><MeetingActionForm action={createTopicAction} submit="Thema anlegen">
        {cardId!=null&&<><input type="hidden" name="cardId" value={cardId}/><p className="text-sm text-slate-500">Die Karte bleibt durch ihre Board-Rechte geschützt. Titel und Beschreibung des TOPs werden bewusst separat eingegeben.</p></>}
        <TopicFields editableState={false}/>
      </MeetingActionForm></div></details>
      <h3 className="text-sm font-semibold">Aktuelle Themen</h3>
      {!backlog.length&&<p className="text-sm text-slate-500">Keine aktuellen Themen.</p>}
      {backlog.map(topic=><article key={topic.id} data-personal-topic={topic.id} className="rounded-lg border border-slate-200 p-4"><details><summary className="cursor-pointer break-words font-semibold text-slate-900">{topic.title}{history[topic.id].at(-1)?.state==="withdrawn"&&<span className="ml-2 inline-flex rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">Zurückgezogen</span>}</summary><div className="mt-4 space-y-3"><Link href={`/intern/sitzungen/top/${topic.id}`} aria-label={topic.title} className="inline-block text-sm font-medium text-brand-700 hover:underline">Thema öffnen →</Link><TopicTrail entries={history[topic.id]} personal/><div className="flex flex-wrap items-start gap-2"><TopicTransferControl id={topic.id} targets={targets} personal/>{history[topic.id].at(-1)?.state==="withdrawn"&&<MeetingActionForm action={resolvePersonalTopicAction.bind(null,topic.id)} compact submit="Als erledigt markieren">{null}</MeetingActionForm>}</div></div></details></article>)}

      <details className="space-y-4 border-t border-slate-200 pt-4"><summary className="cursor-pointer font-semibold">Vergangene Themen <span className="ml-2 text-sm font-normal text-slate-500">{past.length}</span></summary><p className="text-sm text-slate-500">Hier findest du deine behandelten oder als erledigt markierten Themen mit ihrem vollständigen Aktivitätsverlauf.</p>
        {!past.length&&<p className="text-sm text-slate-500">Noch keine vergangenen Themen.</p>}
        {past.map(topic=><article key={topic.id} data-personal-topic={topic.id} className="rounded-lg border border-slate-200 p-4"><details><summary className="cursor-pointer break-words font-semibold text-slate-900">{topic.title}<span className="ml-2 inline-flex rounded-md bg-green-50 px-2 py-1 text-xs font-semibold text-green-700">{topic.resolvedAt?"Erledigt":"Behandelt"}</span></summary><div className="mt-4 space-y-3"><Link href={`/intern/sitzungen/top/${topic.id}`} aria-label={topic.title} className="inline-block text-sm font-medium text-brand-700 hover:underline">Thema öffnen →</Link><TopicTrail entries={history[topic.id]} personal/></div></details></article>)}
      </details>
    </details>
  </div>;
}
