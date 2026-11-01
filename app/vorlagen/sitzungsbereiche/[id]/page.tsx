// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import Link from "next/link";
import {notFound} from "next/navigation";
import {eq} from "drizzle-orm";
import {db} from "@/lib/db";
import {meetingAreaTemplates} from "@/lib/db/schema";
import {requireTemplateManager} from "@/lib/auth";
import {parseApiId} from "@/lib/api";
import {MeetingActionForm} from "@/components/meetings/ActionForm";
import {DefaultTopicEditor} from "@/components/meetings/DefaultTopicEditor";
import {DeleteConfirm} from "@/components/DeleteConfirm";
import {saveMeetingTemplateAction,deleteMeetingTemplateAction} from "../actions";
export default async function MeetingTemplatePage({params}:{params:Promise<{id:string}>}){
 await requireTemplateManager();const id=parseApiId((await params).id);if(!id)notFound();const [template]=await db.select().from(meetingAreaTemplates).where(eq(meetingAreaTemplates.id,id));if(!template)notFound();
 return <div className="mx-auto max-w-5xl space-y-6"><Link href="/vorlagen/sitzungsbereiche" className="text-sm text-brand-700">← Sitzungsbereichsvorlagen</Link><h2 className="text-xl font-semibold">{template.name}</h2><MeetingActionForm action={saveMeetingTemplateAction.bind(null,id)}><input type="hidden" name="revision" value={template.revision}/><label className="block text-sm">Name<input name="name" className="input mt-1" defaultValue={template.name} required maxLength={120}/></label><label className="block text-sm">Beschreibung<textarea name="description" className="input mt-1" defaultValue={template.description} maxLength={5000}/></label><DefaultTopicEditor key={template.revision} initial={template.topics}/></MeetingActionForm><DeleteConfirm action={deleteMeetingTemplateAction.bind(null,id,template.revision)} title="Sitzungsbereichsvorlage löschen" message="Bereits übernommene Standard-TOPs in Sitzungsbereichen und bestehenden Sitzungen bleiben erhalten." buttonLabel="Vorlage löschen"/></div>;
}
