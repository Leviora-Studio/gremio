// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { MeetingDateTimeField } from "./DateTimeField";
import { Select } from "@/components/Select";
import { meetingStates, topicKinds, topicStates, berlinInputDate } from "@/lib/meetings/validation";
import type { meetings, meetingTopics } from "@/lib/db/schema";
export function MeetingFields({ meeting, areaId }: { meeting?: typeof meetings.$inferSelect; areaId?: number }) {
  return <>
    <input type="hidden" name="areaId" value={meeting?.areaId??areaId}/ >
    {meeting && <input type="hidden" name="revision" value={meeting.revision} />}
    <label className="block text-sm">Titel<input name="title" className="input mt-1" required maxLength={200} defaultValue={meeting?.title} /></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">Sitzungsleitung<input name="chair" className="input mt-1" maxLength={200} defaultValue={meeting?.chair} /></label>
      <MeetingDateTimeField name="startsAt" label="Beginn (Europe/Berlin)" initial={berlinInputDate(meeting?.startsAt??null)}/>
      <MeetingDateTimeField name="submissionDeadline" label="Einreichungsfrist (Europe/Berlin)" initial={berlinInputDate(meeting?.submissionDeadline??null)}/>
    </div>
    <label className="block text-sm">Ort oder Videokonferenz-Link<input name="location" className="input mt-1" maxLength={500} defaultValue={meeting?.location} /></label>
    <div><label className="label">Sitzungsstatus</label><Select portal name="state" ariaLabel="Sitzungsstatus" defaultValue={meeting?.state ?? "planning"} options={Object.entries(meetingStates).map(([value,label]) => ({ value,label }))} /></div>
  </>;
}
export function TopicFields({ topic, manage = false, editableState = true, parentOptions, inheritedConfidential=false }: { topic?: typeof meetingTopics.$inferSelect; manage?: boolean; editableState?: boolean; parentOptions?: {value:string;label:string}[]; inheritedConfidential?:boolean }) {
  return <>
    {(topic?.isFinanceItem||topic?.isFinanceTopic)&&<input type="hidden" name="parentId" value={topic.parentId??""}/>}
    {parentOptions&&!topic?.isFinanceItem&&!topic?.isFinanceTopic&&<div><label className="label">Einplanen als</label><Select portal name="parentId" ariaLabel="Einplanen als" defaultValue={topic?.parentId?String(topic.parentId):""} options={[{value:"",label:"Eigenständiger Haupt-TOP"},...parentOptions]}/><p className="mt-1 text-xs text-slate-500">Eine Zuordnung plant den TOP unter dem ausgewählten Haupt-TOP ein.</p></div>}
    <div><label className="block text-sm">TOP-Titel<input name="title" className="input mt-1" required maxLength={200} defaultValue={topic?.title} readOnly={topic?.isFinanceItem} /></label><p className="mt-1 text-xs text-slate-500">{topic?.isFinanceItem?"Antragsnummer und Titel werden beim Anzeigen direkt aus der Karte übernommen. Kartenrechte bleiben dabei wirksam.":"Eigenständig formulieren: Diesen Inhalt sehen alle für den TOP berechtigten Sitzungsteilnehmer."}</p></div>
    <label className="block text-sm">Beschreibung<textarea name="description" className="input mt-1" rows={3} maxLength={10000} defaultValue={topic?.description} /></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <div><label className="label">Art</label><Select portal name="kind" ariaLabel="Art" defaultValue={topic?.kind ?? "discussion"} options={Object.entries(topicKinds).map(([value,label]) => ({ value,label }))} /></div>
      <label className="block text-sm">Geplante Dauer (Minuten)<input name="durationMinutes" type="number" min={1} max={480} className="input mt-1" defaultValue={topic?.durationMinutes ?? 10} required /></label>
    </div>
    <details className="rounded-lg border border-slate-200 p-3" open={!!topic?.presenter||!!topic?.motion}><summary className="cursor-pointer text-sm font-medium">Vortragende Person & Beschlussvorschlag (optional)</summary><div className="mt-4 space-y-4"><label className="block text-sm">Verantwortliche / Vortragende Person<input name="presenter" className="input mt-1" maxLength={200} defaultValue={topic?.presenter} /></label>
    <label className="block text-sm">Beschlussvorschlag<textarea name="motion" className="input mt-1" rows={3} maxLength={10000} defaultValue={topic?.motion} /></label></div></details>
    {editableState && <><div><label className="label">TOP-Status</label><Select portal name="state" ariaLabel="TOP-Status" defaultValue={topic?.state ?? "proposed"} options={Object.entries(topicStates).map(([value,label]) => ({ value,label }))} /></div>
    {topic&&<label className="block text-sm">Ergebnis / kurze Notiz<textarea name="outcome" className="input mt-1" rows={3} maxLength={10000} defaultValue={topic?.outcome} /></label>}</>}
    {manage && <label className="flex items-start gap-2 text-sm"><input name="confidential" type="checkbox" defaultChecked={topic?.confidential} className="mt-1" />Vertraulich: nur Eigentümer und Admins dürfen diesen TOP und seine Unterlagen sehen.</label>}
    {(topic?.confidential||inheritedConfidential) && <label className="flex items-start gap-2 text-sm"><input name="confirmDisclosure" type="checkbox" className="mt-1" />Wenn ich den Vertraulichkeitsschutz aufhebe oder einen geschützten Unter-TOP herauslöse, gebe ich die betroffenen Inhalte einschließlich Unter-TOPs und Unterlagen für sämtliche Sitzungsteilnehmer frei.</label>}
  </>;
}
