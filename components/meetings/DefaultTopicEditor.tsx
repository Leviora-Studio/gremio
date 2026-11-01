// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import {useEffect,useState} from "react";
import {Select} from "@/components/Select";
import {newDefaultTopic,type DefaultTopic,type DefaultTopicChild} from "@/lib/meetings/presets";
import {topicKinds} from "@/lib/meetings/validation";
import {agendaSectionLabels} from "@/lib/meetings/agenda";
export function DefaultTopicEditor({initial,revision}:{initial:DefaultTopic[];revision?:number}){
 const [rows,setRows]=useState(initial),[dirty,setDirty]=useState(false);
 const saved=JSON.stringify(initial);
 useEffect(()=>{setRows(JSON.parse(saved));setDirty(false);},[saved,revision]);
 const change=(next:DefaultTopic[])=>{setRows(next);setDirty(true);};
 const update=(root:number,child:number|null,values:Partial<DefaultTopic>)=>change(rows.map((row,index)=>index!==root?row:child==null?{...row,...values}:{...row,children:row.children.map((item,i)=>i===child?{...item,...values}:item)}));
 const remove=(root:number,child:number|null)=>change(child==null?rows.filter((_,i)=>i!==root):rows.map((row,i)=>i===root?{...row,children:row.children.filter((_,c)=>c!==child)}:row));
 const move=(root:number,child:number|null,delta:number)=>{
  const next=structuredClone(rows),items=child==null?next:next[root].children,index=child??root,target=index+delta;
  if(target<0||target>=items.length)return;[items[index],items[target]]=[items[target],items[index]];change(next);
 };
 function item(row:DefaultTopic|DefaultTopicChild,root:number,child:number|null){
  const label=child==null?`Haupt-TOP ${root+1}`:`Unter-TOP ${root+1}.${child+1}`,count=child==null?rows.length:rows[root].children.length,index=child??root;
  return <details key={label} open className="min-w-0 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer break-words font-medium">{label}: {row.title||"Ohne Titel"}</summary><div className="mt-4 space-y-4">
   <label className="block text-sm">Titel {label}<input className="input mt-1" required maxLength={200} value={row.title} onChange={e=>update(root,child,{title:e.target.value})}/></label>
   {child==null&&<div><label className="label">Bereich {label}</label><Select portal ariaLabel={`Bereich ${label}`} value={rows[root].section} onChange={section=>update(root,null,{section:section as DefaultTopic["section"]})} options={Object.entries(agendaSectionLabels).map(([value,label])=>({value,label}))}/></div>}
   <label className="block text-sm">Beschreibung {label}<textarea aria-label={`Beschreibung ${label}`} className="input mt-1" rows={3} maxLength={10000} value={row.description} onChange={e=>update(root,child,{description:e.target.value})}/></label>
   <div className="grid gap-4 sm:grid-cols-2"><div><label className="label">Art {label}</label><Select portal ariaLabel={`Art ${label}`} value={row.kind} onChange={kind=>update(root,child,{kind:kind as DefaultTopic["kind"]})} options={Object.entries(topicKinds).map(([value,label])=>({value,label}))}/></div><label className="block text-sm">Dauer {label} (Minuten)<input className="input mt-1" type="number" min={1} max={480} required value={row.durationMinutes} onChange={e=>update(root,child,{durationMinutes:Number(e.target.value)})}/></label></div>
   <details><summary className="cursor-pointer text-sm">Weitere Inhalte</summary><div className="mt-3 space-y-3"><label className="block text-sm">Vortragende Person {label}<input className="input" value={row.presenter} maxLength={200} onChange={e=>update(root,child,{presenter:e.target.value})}/></label><label className="block text-sm">Beschlussvorschlag {label}<textarea aria-label={`Beschlussvorschlag ${label}`} className="input" rows={3} value={row.motion} maxLength={10000} onChange={e=>update(root,child,{motion:e.target.value})}/></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={row.confidential} onChange={e=>update(root,child,{confidential:e.target.checked})}/>Vertraulich (in der Sitzung nur für Eigentümer/Admins sichtbar)</label></div></details>
   <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={index===0} onClick={()=>move(root,child,-1)}>Nach oben</button><button type="button" className="btn-secondary" disabled={index===count-1} onClick={()=>move(root,child,1)}>Nach unten</button><button type="button" className="btn-secondary" onClick={()=>remove(root,child)}>{child==null?"Haupt-TOP samt Unter-TOPs entfernen":"Unter-TOP entfernen"}</button></div>
   {child==null&&<div className="space-y-3">{rows[root].children.map((entry,i)=>item(entry,root,i))}<button type="button" className="btn-secondary" onClick={()=>{const {section:_section,children:_children,...entry}=newDefaultTopic("Neuer Unter-TOP");update(root,null,{children:[...rows[root].children,entry]});}}>+ Unter-TOP hinzufügen</button></div>}
  </div></details>;
 }
 return <div data-live-refresh-block={dirty} className="min-w-0 space-y-4"><input type="hidden" name="topics" value={JSON.stringify(rows)}/>{!rows.length&&<p className="text-sm text-slate-500">Keine Standard-TOPs hinterlegt.</p>}{rows.map((row,i)=>item(row,i,null))}<button type="button" className="btn-secondary" onClick={()=>change([...rows,newDefaultTopic()])}>+ Haupt-TOP hinzufügen</button></div>;
}
