// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import {useRef,useState} from "react";
import {Select} from "@/components/Select";
import {MeetingActionForm} from "./ActionForm";
import {saveFinanceConfigurationAction} from "@/app/intern/sitzungen/actions";
import {financeMotionFields,renderFinanceMotion} from "@/lib/meetings/finance-motion";
type BoardOption={id:number;name:string;statuses:{id:number;name:string}[];fields:string[]};
export function FinanceConfiguration({areaId,boards,boardId,sourceIds,targetId,motionTemplate}:{areaId:number;boards:BoardOption[];boardId:number|null;sourceIds:number[];targetId:number|null;motionTemplate:string}) {
  const [selected,setSelected]=useState(boardId==null?"":String(boardId));
  const [drafts,setDrafts]=useState<Record<string,{source:number[];target:string;motion:string}>>({[String(boardId)]:{source:sourceIds,target:targetId==null?"":String(targetId),motion:motionTemplate}});
  const textarea=useRef<HTMLTextAreaElement>(null);
  const draft=drafts[selected]??{source:[],target:"",motion:""};
  const update=(values:Partial<typeof draft>)=>setDrafts(previous=>({...previous,[selected]:{...draft,...values}}));
  const insert=(key:string)=>{const field=textarea.current;if(!field)return;const start=field.selectionStart,end=field.selectionEnd,token=`{{${key}}}`;update({motion:draft.motion.slice(0,start)+token+draft.motion.slice(end)});requestAnimationFrame(()=>{field.focus();field.setSelectionRange(start+token.length,start+token.length);});};
  const board=boards.find(b=>String(b.id)===selected);
  return <MeetingActionForm preserveValues action={saveFinanceConfigurationAction.bind(null,areaId)}>
    <p className="text-sm text-slate-500">Verknüpfe das Board, auf dem eure Finanzanträge als Karten eingehen. In jeder Sitzung kann ein Haupt-TOP als Finanzanträge markiert werden. Kartenrechte bleiben getrennt; zum Einplanen braucht die Person auch Schreibzugriff auf das Board.</p>
    <div><label className="label">Antragsboard</label><Select portal name="boardId" ariaLabel="Antragsboard" value={selected} onChange={setSelected} searchable options={[{value:"",label:"Keine Anbindung"},...boards.map(b=>({value:String(b.id),label:b.name}))]}/>{selected&&!board&&<p className="mt-2 text-sm text-amber-700">Die bestehende Anbindung ist für dich nicht verwaltbar. Bitte Board-Rechte prüfen oder eine andere Anbindung wählen.</p>}</div>
    {board&&<div key={board.id} className="space-y-5 rounded-lg border border-slate-200 bg-slate-50 p-4"><fieldset><legend className="text-sm font-semibold">Karten aus diesen Spalten anbieten</legend><p className="mt-1 text-xs text-slate-500">Ohne Haken werden alle Spalten angeboten. Bereits eingeplante und archivierte Karten erscheinen nicht erneut.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{board.statuses.map(s=><label key={s.id} className="flex min-w-0 items-start gap-2 rounded-lg bg-white px-3 py-2 text-sm"><input type="checkbox" name="sourceStatusId" value={s.id} className="mt-0.5 shrink-0" checked={draft.source.includes(s.id)} onChange={e=>update({source:e.target.checked?[...draft.source,s.id]:draft.source.filter(id=>id!==s.id)})}/><span className="min-w-0 break-words">{s.name}</span></label>)}</div></fieldset>
    <div><label className="label">Zielspalte beim Einplanen</label><Select portal name="targetStatusId" ariaLabel="Zielspalte beim Einplanen" value={draft.target} onChange={target=>update({target})} options={[{value:"",label:"Bitte Zielspalte auswählen"},...board.statuses.map(s=>({value:String(s.id),label:s.name}))]}/><p className="mt-2 text-xs text-slate-500">Die Karte wird dorthin verschoben. Ist sie bereits dort, bleibt ihre Reihenfolge erhalten. Das aktive Kartenfeld „Geplant für Sitzung“ erhält das Sitzungsdatum.</p></div>
    <section className="space-y-3 border-t border-slate-200 pt-4"><h3 className="font-semibold">Beschlussvorschlag für Finanzanträge</h3><p className="text-sm text-slate-600">Dieser Text wird beim Einplanen als Beschlussvorschlag des Finanzantrags übernommen. Schreibe deinen Text und füge Kartenfelder an der Cursorposition ein. Leer lassen, wenn kein Vorschlag vorbelegt werden soll.</p>
    <label className="block text-sm">Vorlage für den Beschlussvorschlag<textarea ref={textarea} aria-label="Vorlage für den Beschlussvorschlag" name="motionTemplate" className="input mt-1" rows={4} maxLength={10000} value={draft.motion} onChange={e=>update({motion:e.target.value})} placeholder="Bis zu einem Betrag von {{requested_amount}} wird der Antrag {{title}} bewilligt."/></label>
    <div><p className="mb-2 text-xs font-semibold text-slate-600">Kartenfeld einfügen</p><div className="flex flex-wrap gap-2">{financeMotionFields.filter(f=>!f.field||board.fields.includes(f.field)).map(f=><button key={f.key} type="button" className="btn-secondary h-auto py-1 text-sm" aria-label={`${f.label} einfügen`} onClick={()=>insert(f.key)}>{f.label}</button>)}</div></div>
    {draft.motion.trim()&&<div className="rounded-lg bg-white p-3"><p className="mb-2 text-xs font-semibold text-slate-500">Vorschau mit Beispieldaten</p><p className="whitespace-pre-wrap break-words text-sm">{renderFinanceMotion(draft.motion,Object.fromEntries(financeMotionFields.filter(f=>!f.field||board.fields.includes(f.field)).map(f=>[f.key,f.example])))}</p></div>}
    <p className="text-xs text-slate-500">Platzhalter werden mit den aktuellen Kartenwerten angezeigt – auch im PDF und Wordexport. Nur freigegebene Kartenfelder werden angeboten; Kartenrechte gelten weiterhin. Bereits eingeplante Vorschläge werden durch Änderungen dieser Vorlage nicht ersetzt und können im TOP bearbeitet werden.</p></section></div>}
    {!board&&<input type="hidden" name="motionTemplate" value={motionTemplate}/>}
  </MeetingActionForm>;
}
