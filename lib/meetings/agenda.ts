// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
export type AgendaSection = "opening" | "public" | "non_public";
export type AgendaSettings = { publicNumbering?: "arabic" | "roman"; nonPublicNumbering?: "arabic" | "roman"; firstSection?: "public" | "non_public" };
export const agendaSectionLabels = { opening: "Begrüßung und Regularien", public: "Öffentlicher Teil", non_public: "Nicht öffentlicher Teil" };
export function agendaSections(settings: AgendaSettings = {}): AgendaSection[] {
  return settings.firstSection === "non_public" ? ["opening", "non_public", "public"] : ["opening", "public", "non_public"];
}
export function romanNumber(value: number): string {
  let result = "";
  for (const [amount, symbol] of [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]] as const) {
    while (value >= amount) { result += symbol; value -= amount; }
  }
  return result;
}
export type AgendaTopic = { id:number; parentId:number|null; position:number; state:string; section?:AgendaSection; isMiscellaneous?:boolean };
/** Two-level order; opening and public share numbering, non-public restarts. Children inherit their parent's section. */
export function agendaTopics<T extends AgendaTopic>(topics:T[], settings:AgendaSettings = {}): (T & {number:string; section:AgendaSection})[] {
  const active=(t:T)=>["scheduled","treated","deferred","withdrawn"].includes(t.state);
  const sort=(a:T,b:T)=>a.position-b.position||a.id-b.id;
  const included=new Set(topics.filter(active).map(t=>t.id));
  const roots=topics.filter(t=>active(t)&&(t.parentId==null||["deferred","withdrawn"].includes(t.state)&&!included.has(t.parentId))).sort(sort);
  const sectionOf=(topic:T)=>topics.find(t=>t.id===topic.parentId)?.section??topic.section??"public";
  return agendaSections(settings).flatMap(section=>{
    const numbering=section!=="non_public"?settings.publicNumbering??"arabic":settings.nonPublicNumbering??"roman";
    const offset=section==="public"?roots.filter(root=>sectionOf(root)==="opening").length:0;
    return roots.filter(root=>sectionOf(root)===section).sort((a,b)=>Number(!!a.isMiscellaneous)-Number(!!b.isMiscellaneous)||sort(a,b)).flatMap((root,index)=>{
      const number=numbering==="roman"?romanNumber(index+offset+1):String(index+offset+1);
      return [
        {...root,parentId:null,section,number},
        ...topics.filter(t=>t.parentId===root.id&&active(t)).sort(sort).map((child,childIndex)=>({...child,section,number:`${number}.${childIndex+1}`})),
      ];
    });
  });
}
