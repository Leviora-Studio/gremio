// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderTopicsAction } from "@/app/intern/sitzungen/actions";
import { agendaTopics, agendaSections, agendaSectionLabels, type AgendaSettings, type AgendaSection } from "@/lib/meetings/agenda";
import { topicKinds,topicStates } from "@/lib/meetings/validation";
type AgendaItem = { isFinanceItem?:boolean;motion?:string; isMiscellaneous?:boolean; section?:AgendaSection; transferred?:boolean; isFinanceTopic?:boolean; documentCount?:number; parentId: number|null; position:number;state:string;id: number; title: string; durationMinutes: number; kind: keyof typeof topicKinds; confidential: boolean; presenter: string };
function AgendaRow({ item, number, time, editable, actions }: { item: AgendaItem; number: string; time: string; editable: boolean; actions?:React.ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !editable||item.transferred||item.isMiscellaneous });
  return <li data-live-refresh-block={isDragging} ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex flex-col items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row ${item.parentId!=null?"ml-4 border-l-4 sm:ml-8":""}`}>
    <div className="flex shrink-0 items-start gap-2">{editable&&!item.transferred&&!item.isMiscellaneous && <button type="button" {...attributes} {...listeners} aria-label={`TOP ${number} verschieben`} className="cursor-grab touch-none rounded px-2 py-1 text-slate-500">⠿</button>}
    <span className="mt-0.5 min-w-8 rounded-md bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600" aria-hidden="true">{number}</span></div><div className="w-full min-w-0 flex-1"><Link href={`/intern/sitzungen/top/${item.id}`} className="block break-words font-semibold text-slate-900 hover:text-brand-700">TOP {number}: {item.title}</Link>
      <p className="mt-1 text-sm text-slate-500">{time && `${time} · `}{item.durationMinutes} Min. · {topicKinds[item.kind]}{item.confidential && " · Vertraulich"}{item.isMiscellaneous&&" · Immer letzter TOP"}</p>
      {item.isFinanceTopic&&<Link href={`/intern/sitzungen/top/${item.id}`} className="mt-3 inline-flex rounded-md bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700">{editable?"Finanzanträge einplanen →":"Finanzanträge ansehen →"}</Link>}
      <p className={`mt-2 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${["deferred","withdrawn"].includes(item.state)?"bg-red-50 text-red-700":"bg-slate-100 text-slate-600"}`}>{topicStates[item.state as keyof typeof topicStates]}{item.transferred?" · Weitergegeben":""}</p>
      {item.isFinanceItem&&item.motion&&<div className="mt-3 rounded-lg bg-brand-50 p-3 text-sm"><p className="font-semibold">Beschlussvorschlag</p><p className="mt-1 whitespace-pre-wrap break-words">{item.motion}</p></div>}
      {item.presenter && <p className="mt-1 break-words text-sm">{item.presenter}</p>}
      {!!item.documentCount&&<Link href={`/intern/sitzungen/top/${item.id}#unterlagen`} className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline">{item.documentCount} Unterlage{item.documentCount===1?"":"n"} ansehen →</Link>}
      {actions&&<div className="mt-4 flex flex-wrap items-start gap-3">{actions}</div>}
    </div>
  </li>;
}
export function Agenda({ items, meetingId, revision, editable, startsAt, actions={}, settings={} }: { items: AgendaItem[]; meetingId: number; revision: number; editable: boolean; startsAt: string | null; actions?:Record<number,React.ReactNode>; settings?:AgendaSettings }) {
  const [rows,setRows] = useState(items), [error,setError] = useState(""), [saving,setSaving] = useState(false);
  const router = useRouter();
  useEffect(() => setRows(items), [items]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  async function end(event: DragEndEvent) {
    if (!event.over || event.over.id === event.active.id || saving) return;
    const source=rows.find(row=>row.id===event.active.id),target=rows.find(row=>row.id===event.over!.id);
    if(!source||!target||source.isMiscellaneous)return;
    if(source.section!==target.section){setError("TOPs werden innerhalb ihres Bereichs sortiert. Den Bereich kannst du im TOP ändern.");return;}
    let next:AgendaItem[];
    if(source.parentId==null){
      const roots=rows.filter(row=>row.parentId==null&&row.section===source.section);let targetRoot=target.parentId??target.id;
      const sourceIndex=roots.findIndex(row=>row.id===source.id);
      if(targetRoot===source.id&&event.activatorEvent.type==="keydown")targetRoot=roots[Math.max(0,Math.min(roots.length-1,sourceIndex+(event.delta.y>=0?1:-1)))].id;
      if(targetRoot===source.id)return;
      const moved=arrayMove(roots,sourceIndex,roots.findIndex(row=>row.id===targetRoot)).flatMap(root=>[root,...rows.filter(row=>row.parentId===root.id)]);
      let index=0;next=rows.map(row=>row.section===source.section?moved[index++]:row);
    }else{
      if(source.parentId!==target.parentId){setError("Unter-TOPs werden innerhalb ihres Haupt-TOPs sortiert. Die Zuordnung kannst du im TOP ändern.");return;}
      const siblings=rows.filter(row=>row.parentId===source.parentId);
      const ordered=arrayMove(siblings,siblings.findIndex(row=>row.id===source.id),siblings.findIndex(row=>row.id===target.id));
      let index=0;next=rows.map(row=>row.parentId===source.parentId?ordered[index++]:row);
    }
    next=agendaTopics(next.map((row,index)=>({...row,position:index})),settings).map((row,index)=>({...row,position:index}));
    setRows(next);setSaving(true);setError("");
    try { const result = await reorderTopicsAction(meetingId,next.map(row=>row.id),revision); if (result.error) {setRows(items);setError(result.error);} router.refresh(); }
    catch {setRows(items);setError("Die Reihenfolge konnte nicht gespeichert werden.");}
    finally {setSaving(false);}
  }
  let elapsed = 0;
  const total = rows.reduce((sum,row)=>sum+row.durationMinutes,0);
  return <div data-live-refresh-block={saving} className="space-y-3">
    <p className="text-sm text-slate-500">{total} Minuten geplant. Zeiten beziehen sich auf die sichtbaren TOPs einschließlich Unter-TOPs.{editable && " Am Griff ziehen oder mit Leertaste und Pfeiltasten sortieren."}</p>
    {!rows.length && <p className="rounded border border-dashed p-6 text-sm text-slate-500">Noch keine Tagesordnungspunkte eingeplant.</p>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}><SortableContext items={agendaTopics(rows,settings).map(row=>row.id)} strategy={verticalListSortingStrategy}>
      {agendaSections(settings).map(section=><section key={section} aria-label={agendaSectionLabels[section]} className="space-y-3"><h3 className="border-b border-slate-200 pb-2 pt-3 font-semibold">{agendaSectionLabels[section]}</h3><ol className="space-y-3">
        {agendaTopics(rows,settings).filter(item=>item.section===section).map(item=>{ const time=startsAt?new Date(new Date(startsAt).getTime()+elapsed*60000).toLocaleTimeString("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit"}):"";elapsed+=item.durationMinutes;return <AgendaRow key={item.id} item={item} number={item.number} time={time} editable={editable&&!saving} actions={actions[item.id]}/>;})}
      </ol>{!agendaTopics(rows,settings).some(item=>item.section===section)&&<p className="text-sm text-slate-500">Keine TOPs in diesem Bereich eingeplant.</p>}</section>)}
    </SortableContext></DndContext>
    {startsAt && <p className="text-sm">Voraussichtliches Ende: {new Date(new Date(startsAt).getTime()+total*60000).toLocaleTimeString("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit"})} Uhr</p>}
    {saving && <p role="status" className="text-sm text-slate-500">Reihenfolge wird gespeichert …</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
