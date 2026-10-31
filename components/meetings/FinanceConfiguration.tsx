// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import {useEffect,useState} from "react";
import {Select} from "@/components/Select";
import {MeetingActionForm} from "./ActionForm";
import {saveFinanceConfigurationAction} from "@/app/intern/sitzungen/actions";
type BoardOption={id:number;name:string;statuses:{id:number;name:string}[]};
export function FinanceConfiguration({areaId,boards,boardId,sourceIds,targetId}:{areaId:number;boards:BoardOption[];boardId:number|null;sourceIds:number[];targetId:number|null}) {
  const [selected,setSelected]=useState(boardId==null?"":String(boardId));
  useEffect(()=>setSelected(boardId==null?"":String(boardId)),[boardId]);
  const board=boards.find(b=>String(b.id)===selected);
  return <MeetingActionForm action={saveFinanceConfigurationAction.bind(null,areaId)}>
    <p className="text-sm text-slate-500">Verknüpfe das Board, auf dem eure Finanzanträge als Karten eingehen. In jeder Sitzung kann ein Haupt-TOP als Finanzanträge markiert werden. Kartenrechte bleiben getrennt; zum Einplanen braucht die Person auch Schreibzugriff auf das Board.</p>
    <div><label className="label">Antragsboard</label><Select portal name="boardId" ariaLabel="Antragsboard" value={selected} onChange={setSelected} searchable options={[{value:"",label:"Keine Anbindung"},...boards.map(b=>({value:String(b.id),label:b.name}))]}/>{selected&&!board&&<p className="mt-2 text-sm text-amber-700">Die bestehende Anbindung ist für dich nicht verwaltbar. Bitte Board-Rechte prüfen oder eine andere Anbindung wählen.</p>}</div>
    {board&&<div key={`${board.id}-${sourceIds.join(",")}-${targetId}`} className="space-y-5 rounded-lg border border-slate-200 bg-slate-50 p-4"><fieldset><legend className="text-sm font-semibold">Karten aus diesen Spalten anbieten</legend><p className="mt-1 text-xs text-slate-500">Ohne Haken werden alle Spalten angeboten. Bereits eingeplante und archivierte Karten erscheinen nicht erneut.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{board.statuses.map(s=><label key={s.id} className="flex min-w-0 items-start gap-2 rounded-lg bg-white px-3 py-2 text-sm"><input type="checkbox" name="sourceStatusId" value={s.id} className="mt-0.5 shrink-0" defaultChecked={board.id===boardId&&sourceIds.includes(s.id)}/><span className="min-w-0 break-words">{s.name}</span></label>)}</div></fieldset>
    <div><label className="label">Zielspalte beim Einplanen</label><Select portal name="targetStatusId" ariaLabel="Zielspalte beim Einplanen" defaultValue={board.id===boardId&&targetId!=null?String(targetId):""} options={[{value:"",label:"Bitte Zielspalte auswählen"},...board.statuses.map(s=>({value:String(s.id),label:s.name}))]}/><p className="mt-2 text-xs text-slate-500">Die Karte wird dorthin verschoben. Ist sie bereits dort, bleibt ihre Reihenfolge erhalten. Das aktive Kartenfeld „Geplant für Sitzung“ erhält das Sitzungsdatum.</p></div></div>}
  </MeetingActionForm>;
}
