// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import {useState} from "react";
import {Modal} from "@/components/Modal";
import {Select} from "@/components/Select";
import {DatePicker} from "@/components/DatePicker";
import {emptyExportSelection,type ExportColumn,type ExportSelection} from "@/lib/export-selection";
const textOperators=[{value:"contains",label:"enthält"},{value:"equals",label:"ist gleich"},{value:"notEquals",label:"ist nicht gleich"}];
const valueOperators=[{value:"equals",label:"ist gleich"},{value:"notEquals",label:"ist nicht gleich"},{value:"gte",label:"ab / mindestens"},{value:"lte",label:"bis / höchstens"}];
const emptyOperators=[{value:"empty",label:"ist leer"},{value:"notEmpty",label:"ist ausgefüllt"}];
export function ExportControls({endpoint,columns,label="Export:",className="flex flex-wrap items-center gap-2",grouped=false}:{endpoint:string;columns:ExportColumn[];label?:string;className?:string;grouped?:boolean}){
 const [format,setFormat]=useState<"pdf"|"xlsx"|null>(null),[selection,setSelection]=useState<ExportSelection>(emptyExportSelection),[pending,setPending]=useState(false),[error,setError]=useState("");
 function reset(){setSelection(emptyExportSelection());setError("");}
 async function download(format:"pdf"|"xlsx"){
  if(pending)return;setPending(true);setError("");
  try{
   const url=new URL(endpoint,window.location.origin);url.searchParams.set("format",format);url.searchParams.set("options",JSON.stringify(format==="pdf"?selection:{sort:selection.sort}));
   const response=await fetch(url.toString(),{cache:"no-store"});
   if(!response.ok){const data=await response.json().catch(()=>null);throw new Error(data?.error??"Der Export konnte nicht erstellt werden. Bitte Zugriff und Auswahl prüfen.");}
   const mime=response.headers.get("content-type")??"";if(!mime.includes(format==="pdf"?"application/pdf":"spreadsheetml"))throw new Error("Bitte erneut anmelden und den Export wiederholen.");
   const blob=await response.blob(),href=URL.createObjectURL(blob),anchor=document.createElement("a");
   const disposition=response.headers.get("content-disposition")??"";const filename=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
   anchor.href=href;anchor.download=filename?decodeURIComponent(filename):`Gremio-Export.${format}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(href),1000);setFormat(null);
  }catch(problem){setError(problem instanceof Error?problem.message:"Der Export ist fehlgeschlagen.");}finally{setPending(false);}
 }
 function changeFilter(index:number,patch:Partial<ExportSelection["filters"][number]>){setSelection(current=>({...current,filters:current.filters.map((filter,i)=>i===index?{...filter,...patch}:filter)}));}
 const selectedColumns=selection.columns??columns.map(column=>column.id);
 return <div className={className}>
  <span className="text-xs uppercase text-slate-400">{label}</span><button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={()=>{reset();setFormat("xlsx");}}>Excel</button><button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={()=>{reset();setFormat("pdf");}}>PDF</button>
  {!format&&error&&<p role="alert" className="basis-full text-sm text-red-700">{error}</p>}
  <Modal portal manageFocus open={format!==null} onClose={()=>{if(!pending)setFormat(null);}} title={format==="xlsx"?"Excel exportieren":"PDF exportieren"} maxWidth="max-w-4xl">
   <div className="space-y-6" data-live-refresh-block>
    <p className="text-sm text-slate-600">{format==="xlsx"?"Excel enthält immer alle Einträge und Spalten – unabhängig von deiner App-Ansicht. Die Daten sind mit einem je Export neu erzeugten Zufallspasswort gegen normale Bearbeitung geschützt und ohne Passwort lesbar. Filter bleiben in Excel nutzbar; die Sortierung wählst du hier vor dem Export.":"Wähle den Inhalt dieses PDFs. Filter und Sortierung werden oben im Dokument mitgedruckt."}</p>
    <fieldset disabled={pending} className="space-y-6">
     {format==="pdf"&&<><label className="block text-sm">Textsuche über alle Spalten<input className="input mt-1" maxLength={200} value={selection.search} onChange={event=>setSelection({...selection,search:event.target.value})}/></label>
     <section className="space-y-3"><h3 className="font-semibold">Filter</h3>{selection.filters.length===0&&<p className="text-sm text-slate-500">Keine Einschränkung – alle Einträge werden exportiert.</p>}
      {selection.filters.map((filter,index)=>{const column=columns.find(c=>c.id===filter.column)!;return <div key={index} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2"><div><p className="mb-1 text-sm">Spalte</p><Select portal ariaLabel={`Filter ${index+1}: Spalte`} value={filter.column} options={columns.map(c=>({value:c.id,label:c.label}))} onChange={id=>changeFilter(index,{column:id,operator:columns.find(c=>c.id===id)?.type==="text"?"contains":"equals",value:""})}/></div><div><p className="mb-1 text-sm">Bedingung</p><Select portal ariaLabel={`Filter ${index+1}: Bedingung`} value={filter.operator} options={[...(column.type==="text"?textOperators:valueOperators),...emptyOperators]} onChange={value=>changeFilter(index,{operator:value as typeof filter.operator})}/></div>{!["empty","notEmpty"].includes(filter.operator)&&<div><p className="mb-1 text-sm">{column.type==="date"?"Datum":column.type==="number"?"Betrag (€)":"Wert"}</p>{column.type==="date"?<DatePicker portal ariaLabel={`Filter ${index+1}: Datum`} value={filter.value} onChange={value=>changeFilter(index,{value})}/>:<input aria-label={`Filter ${index+1}: Wert`} className="input" maxLength={200} inputMode={column.type==="number"?"decimal":undefined} value={filter.value} onChange={event=>changeFilter(index,{value:event.target.value})}/>}</div>}<button type="button" className="btn-secondary self-end" onClick={()=>setSelection({...selection,filters:selection.filters.filter((_,i)=>i!==index)})}>Filter entfernen</button></div>;})}
      <button type="button" className="btn-secondary" disabled={selection.filters.length>=10||!columns.length} onClick={()=>setSelection({...selection,filters:[...selection.filters,{column:columns[0].id,operator:columns[0].type==="text"?"contains":"equals",value:""}]})}>Filter hinzufügen</button>
     </section>
     </>}<section className="space-y-3"><h3 className="font-semibold">Sortierung</h3><p className="text-sm text-slate-500">Mehrere Kriterien werden von oben nach unten angewendet. Ohne Auswahl bleibt die ursprüngliche Reihenfolge erhalten.</p>{format==="xlsx"&&grouped&&<p className="text-sm text-slate-500">Abschnitte und Unterpunkte bleiben zugeordnet; die Sortierung gilt innerhalb dieser Bereiche.</p>}{selection.sort.map((sort,index)=><div key={index} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]"><Select portal ariaLabel={`Sortierung ${index+1}: Spalte`} value={sort.column} options={columns.filter(column=>column.id===sort.column||!selection.sort.some(s=>s.column===column.id)).map(column=>({value:column.id,label:column.label}))} onChange={column=>setSelection({...selection,sort:selection.sort.map((s,i)=>i===index?{...s,column}:s)})}/><Select portal ariaLabel={`Sortierung ${index+1}: Richtung`} value={sort.direction} options={[{value:"asc",label:"Aufsteigend"},{value:"desc",label:"Absteigend"}]} onChange={direction=>setSelection({...selection,sort:selection.sort.map((s,i)=>i===index?{...s,direction:direction as "asc"|"desc"}:s)})}/><button type="button" className="btn-secondary" onClick={()=>setSelection({...selection,sort:selection.sort.filter((_,i)=>i!==index)})}>Entfernen</button></div>)}<button type="button" className="btn-secondary" disabled={selection.sort.length>=3||selection.sort.length>=columns.length} onClick={()=>{const column=columns.find(c=>!selection.sort.some(s=>s.column===c.id));if(column)setSelection({...selection,sort:[...selection.sort,{column:column.id,direction:"asc"}]});}}>Sortierung hinzufügen</button></section>
     {format==="pdf"&&<section className="space-y-3"><h3 className="font-semibold">Spalten im PDF</h3><div className="grid gap-2 sm:grid-cols-2">{columns.map(column=><label key={column.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm"><input type="checkbox" className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600" checked={selectedColumns.includes(column.id)} onChange={event=>setSelection({...selection,columns:event.target.checked?columns.filter(c=>c.id===column.id||selectedColumns.includes(c.id)).map(c=>c.id):selectedColumns.filter(id=>id!==column.id)})}/><span>{column.label}</span></label>)}</div></section>}
    </fieldset>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap justify-between gap-3"><button type="button" className="btn-secondary" disabled={pending} onClick={reset}>Zurücksetzen</button><button type="button" className="btn-primary" disabled={pending||format==="pdf"&&selectedColumns.length===0} onClick={()=>{if(format)void download(format);}}>{pending?"Export wird erstellt …":format==="xlsx"?"Excel herunterladen":"PDF herunterladen"}</button></div>
   </div>
  </Modal>
 </div>;
}
