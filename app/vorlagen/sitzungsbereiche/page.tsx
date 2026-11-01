// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import {requireTemplateManager} from "@/lib/auth";
import {meetingTemplates} from "@/lib/meetings/templates";
import {MeetingActionForm} from "@/components/meetings/ActionForm";
import {saveMeetingTemplateAction} from "./actions";
export default async function MeetingTemplatesPage(){
 const templates=await meetingTemplates(await requireTemplateManager());
 return <div className="space-y-6"><div><h2 className="text-lg font-semibold">Sitzungsbereichsvorlagen</h2><p className="mt-2 text-sm text-slate-500">Wiederverwendbare Haupt- und Unter-TOPs für Sitzungsbereiche. Bereiche übernehmen eine eigene anpassbare Kopie; neue Sitzungen erhalten daraus ihre Standard-TOPs.</p></div><section className="card p-5"><h3 className="mb-4 font-semibold">Vorlage anlegen</h3><MeetingActionForm action={saveMeetingTemplateAction.bind(null,null)} submit="Sitzungsbereichsvorlage anlegen"><input type="hidden" name="revision" value="0"/><input type="hidden" name="topics" value="[]"/><label className="block text-sm">Name<input className="input mt-1" name="name" required maxLength={120}/></label><label className="block text-sm">Beschreibung<textarea className="input mt-1" name="description" maxLength={5000}/></label></MeetingActionForm></section><div className="space-y-3">{templates.map(template=><Link key={template.id} href={`/vorlagen/sitzungsbereiche/${template.id}`} className="card block space-y-2 p-5 hover:border-brand-400"><h3 className="font-semibold">{template.name}</h3><p className="break-words text-sm text-slate-500">{template.description}</p><p className="text-sm">{template.topics.length} Haupt-TOPs · {template.topics.reduce((sum,root)=>sum+root.children.length,0)} Unter-TOPs</p></Link>)}</div></div>;
}
