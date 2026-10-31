// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc,eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { meetingAreaAccess,users,groups,boardStatuses } from "@/lib/db/schema";
import { getAccessibleBoards,canManageBoard } from "@/lib/authz";
import { FinanceConfiguration } from "@/components/meetings/FinanceConfiguration";
import { requireArea } from "@/lib/meetings/access";
import { parseApiId } from "@/lib/api";
import { ACCESS_LEVEL_OPTIONS } from "@/lib/access-level";
import { Avatar } from "@/components/Avatar";
import { Select } from "@/components/Select";
import { CollapsibleSection } from "@/components/board/CollapsibleSection";
import { MeetingActionForm } from "@/components/meetings/ActionForm";
import { areaGrantAction,saveAreaAction } from "../../../actions";
export default async function AreaSettings({params}:{params:Promise<{id:string}>}) {
  const user=await requireUser();const id=parseApiId((await params).id);if(!id)notFound();
  const area=await requireArea(user,id,"manage").catch(()=>null);if(!area)notFound();
  const people=await db.select({id:users.id,name:users.username,avatarPath:users.avatarPath}).from(users).orderBy(asc(users.username));
  const groupRows=await db.select().from(groups).orderBy(asc(groups.name));
  const grants=await db.select().from(meetingAreaAccess).where(eq(meetingAreaAccess.areaId,id));
  const financeBoards=[];
  for(const board of await getAccessibleBoards(user))if(board.inventoryBoardId==null&&await canManageBoard(user,board))financeBoards.push({id:board.id,name:board.name,statuses:await db.select({id:boardStatuses.id,name:boardStatuses.name}).from(boardStatuses).where(eq(boardStatuses.boardId,board.id)).orderBy(asc(boardStatuses.position),asc(boardStatuses.id))});
  return <div className="mx-auto max-w-5xl space-y-6"><Link href={`/intern/sitzungen/bereich/${id}`} className="break-words text-sm text-brand-700">← {area.name}</Link><h1 className="text-2xl font-bold">Bereichseinstellungen</h1>
    <CollapsibleSection title="Allgemein" defaultOpen><MeetingActionForm action={saveAreaAction.bind(null,id)}><label className="label">Bezeichnung<input name="name" className="input" defaultValue={area.name} maxLength={200} required/></label><label className="label">Beschreibung<textarea name="description" className="input" defaultValue={area.description} maxLength={5000}/></label></MeetingActionForm></CollapsibleSection>
    <CollapsibleSection title="Finanzanträge" defaultOpen><FinanceConfiguration areaId={id} boards={financeBoards} boardId={area.financeBoardId} sourceIds={area.financeSourceStatusIds} targetId={area.financeTargetStatusId}/></CollapsibleSection>
    <CollapsibleSection title="Freigaben" defaultOpen><p className="mb-3 text-sm text-slate-500">Freigaben gelten für alle bestehenden und zukünftigen Sitzungen dieses Bereichs. Bei mehreren direkten oder Gruppenfreigaben gelten die höchsten Rechte. Eigentümer und Admins behalten volle Rechte. Board-Rechte bleiben getrennt.</p>
      <div className="grid gap-3 sm:grid-cols-2">{(["user","group"] as const).map(subject=><MeetingActionForm key={subject} action={areaGrantAction.bind(null,id)} compact submit="+"><input type="hidden" name="subject" value={subject}/><div className="min-w-0 w-full"><label className="label">{subject==="user"?"Nutzer freigeben":"Gruppe freigeben"}</label><Select portal name="subjectId" ariaLabel={subject==="user"?"Nutzer freigeben":"Gruppe freigeben"} searchable searchPlaceholder={subject==="user"?"Nutzer suchen…":"Gruppe suchen…"} placeholder={subject==="user"?"Nutzer…":"Gruppe…"} options={(subject==="user"?people:groupRows).map(row=>({value:String(row.id),label:row.name}))}/></div><div className="w-full"><label className="label">Zugriff</label><Select portal name="accessLevel" ariaLabel={`Zugriff für neue ${subject==="user"?"Personenfreigabe":"Gruppenfreigabe"}`} defaultValue="read" options={ACCESS_LEVEL_OPTIONS}/></div></MeetingActionForm>)}</div>
      <div className="mt-4 space-y-2">{!grants.length&&<p className="text-sm text-slate-500">Noch keine Freigaben (nur Eigentümer &amp; Admins haben Zugriff).</p>}{grants.map(grant=>{const person=people.find(p=>p.id===grant.userId);const name=person?.name??groupRows.find(g=>g.id===grant.groupId)?.name??"Freigabe";return <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2"><span className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm"><span className="shrink-0">{person?<Avatar username={name} src={person.avatarPath?`/api/avatar/${person.id}`:null} size={22}/>:"👥"}</span><span className="min-w-0 break-all">{name}{grant.groupId?" (Gruppe)":""}</span></span>
        <MeetingActionForm action={areaGrantAction.bind(null,id)} compact><input type="hidden" name="subject" value={grant.userId?"user":"group"}/><input type="hidden" name="subjectId" value={grant.userId??grant.groupId??""}/><div className="w-full max-w-full sm:w-56"><Select portal name="accessLevel" ariaLabel={`Zugriff für ${name}`} defaultValue={grant.accessLevel} key={`${grant.id}-${grant.accessLevel}`} options={ACCESS_LEVEL_OPTIONS}/></div></MeetingActionForm>
        <MeetingActionForm action={areaGrantAction.bind(null,id)} compact submit="Entfernen"><input type="hidden" name="subject" value={grant.userId?"user":"group"}/><input type="hidden" name="subjectId" value={grant.userId??grant.groupId??""}/><input type="hidden" name="accessLevel" value="remove"/></MeetingActionForm>
      </div>;})}</div>
    </CollapsibleSection>
  </div>;
}
