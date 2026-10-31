// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { parseApiId } from "@/lib/api";
import { requireMeeting,canManageMeeting } from "@/lib/meetings/access";
import { manageSourceBoard, visibleMeetingBoards } from "@/lib/meetings/service";
import { getAccessibleBoards } from "@/lib/authz";
import { Select } from "@/components/Select";
import { MeetingActionForm } from "@/components/meetings/ActionForm";
import { MeetingFields } from "@/components/meetings/Fields";
import { saveMeetingAction, bindBoardAction, confirmedDeleteMeetingAction } from "../../actions";
export default async function MeetingSettingsPage({params}:{params:Promise<{id:string}>}) {
  const user=await requireUser();const id=parseApiId((await params).id);if(!id)notFound();
  const meeting=await requireMeeting(user,id,"write").catch(()=>null);if(!meeting)notFound();
  const manager=canManageMeeting(user,meeting);
  const linked=await visibleMeetingBoards(user,id);const candidates=[];
  for(const board of await getAccessibleBoards(user)) if(await manageSourceBoard(user,board))candidates.push({value:String(board.id),label:board.name});
  return <div className="mx-auto max-w-5xl space-y-6">
    <Link href={`/intern/sitzungen/${id}`} className="break-words text-sm text-brand-700">← {meeting.title}</Link><h1 className="text-2xl font-bold">Sitzungs-Einstellungen</h1>
    <section className="card space-y-4 p-5"><h2 className="text-lg font-semibold">Termin und Rahmen</h2><MeetingActionForm action={saveMeetingAction.bind(null,id)}><MeetingFields meeting={meeting}/></MeetingActionForm></section>
    <section className="card p-5"><h2 className="text-lg font-semibold">Freigaben des Sitzungsbereichs</h2><p className="mt-2 text-sm text-slate-500">Diese Sitzung übernimmt die Freigaben des Bereichs „{meeting.committee}“.</p>{manager&&<Link className="mt-3 inline-block text-brand-700" href={`/intern/sitzungen/bereich/${meeting.areaId}/einstellungen`}>Bereichsfreigaben verwalten</Link>}</section>
    {manager&&<details className="card space-y-4 p-5"><summary className="cursor-pointer font-semibold">Boards anbinden</summary><p className="text-sm text-slate-500">Eine Anbindung bietet Karten zur Auswahl an. Sie vergibt keinen Zugriff auf Karten, Anhänge oder Board-Inhalte. Einrichten und Entfernen erfordern Verwaltungsrechte auf beiden Seiten. Angezeigt werden nur Boards, auf die du selbst Zugriff hast.</p>
      {linked.map(board=><p key={board.id} className="break-words text-sm">{board.name}</p>)}
      <MeetingActionForm action={bindBoardAction.bind(null,id)} submit="Board-Anbindung speichern"><div><label className="label">Board</label><Select portal name="boardId" ariaLabel="Board" options={candidates} searchable/></div><label className="flex items-center gap-2 text-sm"><input name="remove" type="checkbox"/>Anbindung entfernen (bestehende Kartenverknüpfungen behalten ihren Zugriffsschutz)</label></MeetingActionForm>
    </details>}
    {manager&&<section className="card p-5"><DeleteConfirm action={confirmedDeleteMeetingAction.bind(null,id)} buttonLabel="Sitzung löschen" title="Sitzung löschen" message="Sitzung, TOPs und Sitzungsunterlagen werden endgültig gelöscht. Verknüpfte Karten bleiben erhalten." wordInModal/></section>}

  </div>;
}
