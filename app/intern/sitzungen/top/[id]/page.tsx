// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import { DeleteConfirm } from "@/components/DeleteConfirm";
import { MeetingDocumentLink } from "@/components/meetings/DocumentLink";
import { FileInput } from "@/components/FileInput";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { attachments, cards } from "@/lib/db/schema";
import { parseApiId } from "@/lib/api";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { isCardAttachmentVisible } from "@/lib/card-attachment-visibility";
import { accessibleMeetings, canManageMeeting, meetingAccessLevel, requireTopic, visibleTopics } from "@/lib/meetings/access";
import { visibleTopicLinks, topicDocuments, visibleMeetingBoards } from "@/lib/meetings/service";
import { financeCandidates } from "@/lib/meetings/finance";
import { projectFinanceTopics } from "@/lib/meetings/finance-projection";
import { agendaTopics } from "@/lib/meetings/agenda";
import { FinanceDetails } from "@/components/meetings/FinanceDetails";
import { topicKinds, topicStates } from "@/lib/meetings/validation";
import { MeetingActionForm } from "@/components/meetings/ActionForm";
import { MeetingDialog } from "@/components/meetings/Dialog";
import {TopicTransferControl} from "@/components/meetings/TopicTransferControl";
import {TopicTrail} from "@/components/meetings/TopicTrail";
import {personalTopicHistory,topicDestinations} from "@/lib/meetings/history";
import { TopicFields } from "@/components/meetings/Fields";
import { Select } from "@/components/Select";
import { createTopicAction, saveTopicAction, linkCardAction, documentAction, confirmedDeleteTopicAction, confirmedRemoveDocumentAction, markFinanceTopicAction, planFinanceCardAction } from "../../actions";
export default async function TopicPage({params}:{params:Promise<{id:string}>}) {
  const user=await requireUser();const id=parseApiId((await params).id);if(!id)notFound();
  const context=await requireTopic(user,id).catch(()=>null);if(!context)notFound();const {meeting}=context;const [topic]=await projectFinanceTopics(user,[context.topic]);
  const manager=meeting?canManageMeeting(user,meeting):true;
  const canTransfer=!meeting || await meetingAccessLevel(user,meeting)==="write";
  const editable=canTransfer && !topic.transferred && (!meeting || meeting.state!=="closed");
  const sessionTopics=meeting?await visibleTopics(user,meeting.id):[];
  const financialRoot=sessionTopics.find(t=>t.isFinanceTopic);
  const numbered=agendaTopics(sessionTopics);
  const number=numbered.find(t=>t.id===id)?.number;
  const candidates=editable&&topic.isFinanceTopic&&["scheduled","treated"].includes(topic.state)?await financeCandidates(user,id):[];
  const children=numbered.filter(t=>t.parentId===id);
  const parent=topic.parentId==null?null:sessionTopics.find(row=>row.id===topic.parentId);
  const parentOptions=meeting?sessionTopics.filter(row=>row.id!==id&&!row.transferred&&row.parentId==null&&(["scheduled","treated"].includes(row.state)||row.id===topic.parentId)).map(row=>({value:String(row.id),label:`Unter-TOP von: ${row.title}`})):undefined;
  const links=await visibleTopicLinks(user,id);const docs=await topicDocuments(user,id);
  const copyOptions=[];const cardOptions=[];const targets=[];
  if(canTransfer&&!topic.transferred) {
    for(const m of await accessibleMeetings(user))if(m.id!==meeting?.id&&m.state!=="closed"&&(!meeting||await meetingAccessLevel(user,m)==="write")&&(!topic.confidential||canManageMeeting(user,m)))targets.push({value:String(m.id),label:m.title});
  }
  const trail=meeting?(await topicDestinations(user,[id]))[id]??[]:await personalTopicHistory(user,id);
  if(editable) {
    for(const link of links) {
      const [source]=await db.select({boardId:cards.boardId}).from(cards).where(eq(cards.id,link.id));
      if(!source)continue;
      const board=await getBoardById(source.boardId);
      if(!board||!(await canAccessBoard(user,board,"write")))continue;
      const visible=await getVisibleFieldKeys(board.id);
      const files=await db.select().from(attachments).where(eq(attachments.cardId,link.id));
      for(const file of files)if(file.kind!=="student_card"&&["application/pdf","image/png","image/jpeg"].includes(file.mime)&&isCardAttachmentVisible(file,visible))copyOptions.push({value:String(file.id),label:`${link.title}: ${file.filename}`});
    }
    if(meeting)for(const board of await visibleMeetingBoards(user,meeting.id)) {
      const rows=await db.select({id:cards.id,title:cards.title}).from(cards).where(eq(cards.boardId,board.id)).limit(200);
      for(const row of rows)cardOptions.push({value:String(row.id),label:`${board.name}: ${row.title}`});
    }
  }
  return <div className="mx-auto max-w-5xl space-y-6">
    <Link className="break-words text-sm text-brand-700" href={meeting?`/intern/sitzungen/${meeting.id}`:"/intern/sitzungen"}>← {meeting?.title??"Themenspeicher"}</Link>
    <div>{parent&&<Link className="mb-2 block break-words text-sm text-brand-700" href={`/intern/sitzungen/top/${parent.id}`}>Unter-TOP von: {parent.title}</Link>}<h1 className="break-words text-2xl font-bold">{number?`TOP ${number}: `:""}{topic.title}</h1><p className="mt-2 text-sm text-slate-500">{topicKinds[topic.kind]} · {topic.durationMinutes} Min. · {topicStates[topic.state]}{topic.confidential?" · Vertraulich":""}</p></div>
    {topic.isFinanceItem&&<section className="card space-y-4 p-5 sm:p-6"><h2 className="text-lg font-semibold">Finanzantrag</h2><FinanceDetails details={topic.financeDetails}/></section>}
    {editable&&meeting&&topic.parentId==null&&!topic.isFinanceItem&&<section className="card space-y-4 p-5"><div><h2 className="font-semibold">{topic.isFinanceTopic?"Finanzanträge-TOP":"Finanzanträge einplanen"}</h2><p className="mt-1 text-sm text-slate-500">{topic.isFinanceTopic?"Plane Karten des im Sitzungsbereich hinterlegten Antragsboards direkt als Unter-TOPs ein.":"Ein Haupt-TOP pro Sitzung kann Karten des verknüpften Antragsboards als Unter-TOPs aufnehmen."}</p></div>
    {(!financialRoot||topic.isFinanceTopic)?<MeetingActionForm action={markFinanceTopicAction.bind(null,id)} compact submit={topic.isFinanceTopic?"Markierung entfernen":"Als Finanzanträge-TOP festlegen"}><input type="hidden" name="revision" value={meeting.revision}/><input type="hidden" name="enabled" value={topic.isFinanceTopic?"":"on"}/></MeetingActionForm>:<Link href={`/intern/sitzungen/top/${financialRoot.id}`} className="break-words text-sm text-brand-700">Zum Finanzanträge-TOP: {financialRoot.title} →</Link>}
    {topic.isFinanceTopic&&<div className="space-y-4 border-t border-slate-200 pt-4">
    {candidates.length?<MeetingActionForm action={planFinanceCardAction.bind(null,id)} submit="Als Unter-TOP einplanen"><input type="hidden" name="revision" value={meeting.revision}/><div><label className="label">Finanzantrag auswählen</label><Select portal name="cardId" ariaLabel="Finanzantrag auswählen" placeholder="Karte auswählen …" options={candidates.map(c=>({value:String(c.id),label:[c.number,c.title].filter(Boolean).join(" ")}))}/></div><p className="text-xs text-slate-500">Die Karte wird in die konfigurierte Zielspalte verschoben; das aktive Feld „Geplant für Sitzung“ erhält das Sitzungsdatum.</p></MeetingActionForm>:<p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Keine verfügbaren Karten. Prüfe Quellspalten und deine Schreibrechte auf dem Antragsboard. Die Anbindung wird in den Bereichseinstellungen festgelegt.</p>}</div>}
    </section>}
    {!!children.length&&<section className="card space-y-3 p-5"><h2 className="font-semibold">Eingeplante Unter-TOPs</h2><ol className="space-y-2">{children.map(child=><li key={child.id}><Link className="block break-words rounded-lg border border-slate-200 px-3 py-3 text-sm font-medium hover:bg-slate-50" href={`/intern/sitzungen/top/${child.id}`}>TOP {child.number}: {child.title}</Link></li>)}</ol></section>}
    <section className="card space-y-5 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">TOP-Inhalt</h2>{editable&&<MeetingDialog label="TOP bearbeiten" title="Tagesordnungspunkt bearbeiten"><MeetingActionForm action={saveTopicAction.bind(null,id)}><input type="hidden" name="revision" value={meeting?.revision??0}/><TopicFields topic={context.topic} manage={manager} parentOptions={parentOptions} inheritedConfidential={parent?.confidential}/></MeetingActionForm></MeetingDialog>}</div><div className="space-y-5 break-words text-sm leading-relaxed"><div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Beschreibung</h3><p className="whitespace-pre-wrap">{topic.description||"Keine Beschreibung hinterlegt."}</p></div>{topic.presenter&&<p><span className="text-slate-500">Vortrag:</span> {topic.presenter}</p>}{topic.motion&&<div className="rounded-lg bg-brand-50 p-4"><h3 className="mb-2 font-semibold">Beschlussvorschlag</h3><p className="whitespace-pre-wrap">{topic.motion}</p></div>}{topic.outcome&&<div className="rounded-lg border border-slate-200 p-4"><h3 className="mb-2 font-semibold">Ergebnis</h3><p className="whitespace-pre-wrap">{topic.outcome}</p></div>}</div></section>
    {editable&&meeting&&topic.parentId==null&&["scheduled","treated"].includes(topic.state)&&<details className="card p-5"><summary className="cursor-pointer font-semibold">+ Unter-TOP anlegen</summary><div className="mt-4"><MeetingActionForm action={createTopicAction} submit="Unter-TOP anlegen"><input type="hidden" name="meetingId" value={meeting.id}/><input type="hidden" name="parentId" value={id}/><TopicFields manage={manager} editableState={false}/></MeetingActionForm></div></details>}
    <section id="unterlagen" className="card scroll-mt-6 space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Sitzungsunterlagen</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{docs.length} Dateien</span></div>{!docs.length&&<p className="text-sm text-slate-500">Noch keine Unterlagen hinterlegt.</p>}<p className="text-sm text-slate-500">PDFs öffnen direkt in der Vorschau. Andere Dateien werden heruntergeladen.</p>
      {docs.map(doc=><div key={doc.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"><MeetingDocumentLink document={doc}/>{editable&&<DeleteConfirm action={confirmedRemoveDocumentAction.bind(null,doc.id)} buttonLabel="Unterlage entfernen" buttonClassName="btn-secondary text-red-600" title="Sitzungsunterlage entfernen" message="Die eigenständige Kopie wird gelöscht; Quelldateien bleiben erhalten." requireWord={false} compact/>}</div>)}
      {editable&&<><details><summary className="cursor-pointer font-medium">+ Eigene Unterlage hochladen</summary><div className="mt-3"><MeetingActionForm action={documentAction.bind(null,id)} submit="Unterlage freigeben"><FileInput name="file" accept="application/pdf,image/png,image/jpeg" required className="flex-wrap"/><label className="flex items-start gap-2 text-sm"><input name="confirmDisclosure" type="checkbox" required className="mt-1"/>Ich gebe diese Datei für alle zum TOP berechtigten Sitzungsteilnehmer frei.</label></MeetingActionForm></div></details>
      {copyOptions.length>0&&<details><summary className="cursor-pointer font-medium">Dateikopie aus einer verknüpften Karte freigeben</summary><div className="mt-3"><MeetingActionForm action={documentAction.bind(null,id)} submit="Eigenständige Kopie freigeben"><div><label className="label">Quelldatei</label><Select portal name="attachmentId" ariaLabel="Quelldatei" options={copyOptions} searchable/></div><label className="flex items-start gap-2 text-sm"><input name="confirmDisclosure" type="checkbox" required className="mt-1"/>Diese Kopie dürfen alle zum TOP berechtigten Sitzungsteilnehmer lesen. Der Board-Zugriff begrenzt die Kopie anschließend nicht mehr.</label></MeetingActionForm></div></details>}</>}
    </section>
    {!topic.isFinanceItem&&!topic.isFinanceTopic&&(editable||links.length>0)&&<details className="card space-y-4 p-5" open={links.length>0}><summary className="cursor-pointer font-semibold">Kartenverknüpfungen <span className="ml-2 text-sm font-normal text-slate-500">{links.length} verknüpft</span></summary><p className="text-sm text-slate-500">Karten erscheinen hier nur mit deinem aktuellen Board-Zugriff. Die Sitzung vergibt keine Board-Rechte. Verknüpfte Inhalte werden nicht in Tagesordnungs-PDFs übernommen.</p>
      {links.map(link=><div key={link.id} className="space-y-2 rounded border p-3"><Link href={`/intern/card/${link.id}`} className="break-words text-brand-700">{link.title}</Link><p className="text-xs text-slate-500">{link.boardName}</p>{editable&&<MeetingActionForm action={linkCardAction.bind(null,id)} submit="Verknüpfung entfernen"><input type="hidden" name="cardId" value={link.id}/><input type="hidden" name="remove" value="on"/></MeetingActionForm>}</div>)}
      {editable&&<><MeetingActionForm action={linkCardAction.bind(null,id)} submit="Karte verknüpfen">{cardOptions.length>0?<div><label className="label">Karte aus angebundenen Boards</label><Select portal name="cardId" ariaLabel="Karte aus angebundenen Boards" options={cardOptions} searchable/></div>:<label className="block text-sm">Karten-ID<input name="cardId" type="number" className="input mt-1" min={1} required/><span className="text-xs text-slate-500">Die Zahl aus /intern/card/123. Nur mit bestehendem Board-Zugriff möglich.</span></label>}</MeetingActionForm>{cardOptions.length>0&&<details><summary className="cursor-pointer text-sm">Andere Karte über ihre ID verknüpfen</summary><MeetingActionForm action={linkCardAction.bind(null,id)} submit="Karte verknüpfen"><label className="block text-sm">Karten-ID<input name="cardId" type="number" min={1} className="input" required/></label></MeetingActionForm></details>}</>}
    </details>}
    {!!trail.length&&<section className="card space-y-3 p-5"><h2 className="font-semibold">Verlauf</h2><TopicTrail entries={trail} personal={!meeting}/></section>}
    {canTransfer&&!topic.transferred&&topic.state!=="withdrawn"&&!topic.resolvedAt&&<TopicTransferControl id={id} targets={targets} personal={!meeting} scheduled={topic.state==="scheduled"}/>}

    {editable&&<section className="card p-5"><DeleteConfirm action={confirmedDeleteTopicAction.bind(null,id)} buttonLabel={meeting?"TOP löschen":"Thema löschen"} title={meeting?"TOP löschen":"Thema löschen"} message={meeting?"Der TOP und seine Sitzungsunterlagen werden endgültig gelöscht. Eventuelle Unter-TOPs bleiben mit ihren Unterlagen als eigenständige TOPs erhalten.":"Dein Thema, seine Unterlagen und der persönliche Verlauf werden endgültig aus deinem Themenspeicher gelöscht. Bereits vorgeschlagene oder eingeplante TOPs in Sitzungen bleiben mit ihren Unterlagen erhalten."} wordInModal/></section>}

  </div>;
}
