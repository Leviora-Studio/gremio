// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
export type AgendaTopic = {id:number;parentId:number|null;position:number;state:string};
/** Stable two-level order, retaining deferred and withdrawn TOPs as part of the session record. */
export function agendaTopics<T extends AgendaTopic>(topics:T[]): (T & {number:string})[] {
  const active=(t:T)=>t.state==="scheduled"||t.state==="treated"||t.state==="deferred"||t.state==="withdrawn";
  const sort=(a:T,b:T)=>a.position-b.position||a.id-b.id;
  const included=new Set(topics.filter(active).map(t=>t.id));
  const roots=topics.filter(t=>active(t)&&(t.parentId==null||["deferred","withdrawn"].includes(t.state)&&!included.has(t.parentId))).sort(sort);
  return roots.flatMap((root,index)=>[
    {...root,parentId:null,number:String(index+1)},
    ...topics.filter(t=>t.parentId===root.id&&active(t)).sort(sort).map((child,childIndex)=>({...child,number:`${index+1}.${childIndex+1}`})),
  ]);
}
