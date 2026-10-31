// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import { MeetingDialog } from "@/components/meetings/Dialog";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { parseApiId } from "@/lib/api";
import { accessibleMeetings, areaAccessLevel, requireArea } from "@/lib/meetings/access";
import { meetingStates } from "@/lib/meetings/validation";
import { formatDateTime } from "@/lib/dates";
import { MeetingActionForm } from "@/components/meetings/ActionForm";
import { MeetingFields } from "@/components/meetings/Fields";
import { saveMeetingAction } from "../../actions";
export default async function MeetingAreaPage({params}:{params:Promise<{id:string}>}) {
  const user=await requireUser();const id=parseApiId((await params).id);if(!id)notFound();
  const area=await requireArea(user,id).catch(()=>null);if(!area)notFound();
  const writer=await areaAccessLevel(user,area)==="write";const manager=user.role==="admin"||area.ownerId===user.id;
  const meetings=(await accessibleMeetings(user)).filter(m=>m.areaId===id);
  const upcoming=meetings.filter(m=>!["closed","held"].includes(m.state)).sort((a,b)=>(a.startsAt?.getTime()??Infinity)-(b.startsAt?.getTime()??Infinity)||b.id-a.id);
  const past=meetings.filter(m=>["closed","held"].includes(m.state));
  return <div className="mx-auto max-w-6xl space-y-6"><Link className="text-sm text-brand-700" href="/intern/sitzungen">← Sitzungsbereiche</Link>
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h1 className="break-words text-2xl font-bold">{area.name}</h1><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-500">{area.description}</p></div>{manager&&<Link className="btn-secondary max-w-full h-auto min-h-10 py-2 whitespace-normal" href={`/intern/sitzungen/bereich/${id}/einstellungen`}>Bereichseinstellungen</Link>}</div>
    {writer&&<MeetingDialog primary label="+ Neue Sitzung" title="Sitzung anlegen"><MeetingActionForm action={saveMeetingAction.bind(null,null)} submit="Sitzung anlegen"><MeetingFields areaId={id}/></MeetingActionForm></MeetingDialog>}
    {[{title:"Anstehende Sitzungen",items:upcoming},{title:"Vergangene Sitzungen",items:past}].map(group=><section key={group.title} className="space-y-3"><div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{group.title}</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{group.items.length}</span></div>{!group.items.length?<p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">{group.title==="Anstehende Sitzungen"?"Noch keine anstehenden Sitzungen.":"Hier erscheinen durchgeführte und abgeschlossene Sitzungen."}</p>:<div className="space-y-3">{group.items.map(meeting=><Link className="card flex flex-wrap items-center justify-between gap-4 p-5 transition-colors hover:border-brand-400" key={meeting.id} href={`/intern/sitzungen/${meeting.id}`}><div className="min-w-0"><span className="mb-2 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{meetingStates[meeting.state]}</span><h3 className="break-words text-lg font-semibold">{meeting.title}</h3><p className="mt-1 break-words text-sm text-slate-500">{meeting.startsAt?formatDateTime(meeting.startsAt):"Termin noch offen"}{meeting.location?` · ${meeting.location}`:""}</p></div><span className="text-sm font-medium text-brand-700">Sitzung öffnen →</span></Link>)}</div>}</section>)}
    {!meetings.length&&<p className="text-sm text-slate-500">In diesem Bereich gibt es noch keine Sitzungen.</p>}
  </div>;
}
