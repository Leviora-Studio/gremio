// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { MeetingError } from "@/lib/meetings/access";
import {uploadWordTemplate,saveWordConfiguration,removeWordTemplate} from "@/lib/meetings/word";
import {wordStyleRoles,type WordStyleMapping} from "@/lib/meetings/word-template-types";
import * as service from "@/lib/meetings/service";
import { saveFinanceConfiguration, markFinanceTopic, planFinanceCard } from "@/lib/meetings/finance";
export type MeetingActionState = { error?: string; success?: string };
const id = (value: FormDataEntryValue | null) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 2147483647) throw new MeetingError("Ungültige Auswahl.");
  return n;
};
function revision(form: FormData) {
  const value = Number(form.get("revision"));
  if (!Number.isSafeInteger(value) || value < 0) throw new MeetingError("Bitte neu laden.");
  return value;
}
function refresh() { revalidatePath("/intern/sitzungen", "layout"); }
function errorState(error: unknown): MeetingActionState {
  return { error: error instanceof MeetingError ? error.message : "Die Änderung konnte nicht gespeichert werden. Bitte erneut versuchen." };
}
function topicValues(form: FormData) {
  return { section: form.get("section")??"public", parentId: form.get("parentId"), title: form.get("title"), description: form.get("description") ?? "", motion: form.get("motion") ?? "", presenter: form.get("presenter") ?? "", kind: form.get("kind") ?? "discussion", durationMinutes: form.get("durationMinutes") ?? 10, confidential: form.get("confidential") === "on", state: form.get("state") ?? "proposed", outcome: form.get("outcome") ?? "" };
}
export async function saveFinanceConfigurationAction(areaId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();
  try{await saveFinanceConfiguration(user,areaId,form.get("boardId")?id(form.get("boardId")):null,form.getAll("sourceStatusId").map(value=>id(value)),form.get("targetStatusId")?id(form.get("targetStatusId")):null);refresh();return {success:"Finanzanträge-Einstellungen gespeichert."};}catch(error){return errorState(error);}
}
export async function markFinanceTopicAction(topicId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();
  try{await markFinanceTopic(user,topicId,form.get("enabled")==="on",revision(form));refresh();return {success:"Finanzanträge-TOP aktualisiert."};}catch(error){return errorState(error);}
}
export async function planFinanceCardAction(topicId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();
  try{await planFinanceCard(user,topicId,id(form.get("cardId")),revision(form));refresh();revalidatePath("/intern/board","layout");return {success:"Finanzantrag als Unter-TOP eingeplant."};}catch(error){return errorState(error);}
}
export async function saveMeetingAction(meetingId: number | null, _previous: MeetingActionState, form: FormData): Promise<MeetingActionState> {
  const user = await requireUser(); let saved: number;
  try { saved = await service.saveMeeting(user, meetingId, { title: form.get("title"), areaId: id(form.get("areaId")), startsAt: form.get("startsAt") ?? "", location: form.get("location") ?? "", chair: form.get("chair") ?? "", submissionDeadline: form.get("submissionDeadline") ?? "", state: form.get("state") ?? "planning" }, meetingId == null ? undefined : revision(form)); refresh(); }
  catch (error) { return errorState(error); }
  if (meetingId == null) redirect(`/intern/sitzungen/${saved}`);
  return { success: "Sitzung gespeichert." };
}
export async function createTopicAction(_previous: MeetingActionState, form: FormData): Promise<MeetingActionState> {
  const user = await requireUser(); let saved: number;
  try { saved = await service.createTopic(user, form.get("meetingId") ? id(form.get("meetingId")) : null, topicValues(form), form.get("cardId") ? id(form.get("cardId")) : undefined); refresh(); }
  catch (error) { return errorState(error); }
  redirect(`/intern/sitzungen/top/${saved}`);
}
export async function saveTopicAction(topicId: number, _previous: MeetingActionState, form: FormData): Promise<MeetingActionState> {
  const user = await requireUser();
  try { await service.saveTopic(user, topicId, topicValues(form), revision(form), form.get("confirmDisclosure") === "on"); refresh(); return { success: "TOP gespeichert." }; }
  catch (error) { return errorState(error); }
}
export async function areaGrantAction(areaId: number, _previous: MeetingActionState, form: FormData): Promise<MeetingActionState> {
  const user=await requireUser();
  try {await service.saveAreaGrant(user,areaId,form.get("subject")==="group"?"group":"user",id(form.get("subjectId")),String(form.get("accessLevel")) as "read"|"write"|"remove");refresh();return {success:"Freigabe gespeichert."};}
  catch(error){return errorState(error);}
}
export async function saveAreaAction(areaId: number|null,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();let saved:number;
  try{saved=await service.saveArea(user,areaId,String(form.get("name")??""),String(form.get("description")??""));refresh();}catch(error){return errorState(error);}
  if(areaId==null)redirect(`/intern/sitzungen/bereich/${saved}`);
  return {success:"Sitzungsbereich gespeichert."};
}
export async function bindBoardAction(meetingId: number, _previous: MeetingActionState, form: FormData): Promise<MeetingActionState> {
  const user = await requireUser();
  try { await service.bindMeetingBoard(user, meetingId, id(form.get("boardId")), form.get("remove") === "on"); refresh(); return { success: "Board-Anbindung gespeichert." }; }
  catch (error) { return errorState(error); }
}
export async function linkCardAction(topicId: number, _previous: MeetingActionState, form: FormData): Promise<MeetingActionState> {
  const user = await requireUser();
  try { await service.linkTopicCard(user, topicId, id(form.get("cardId")), form.get("remove") === "on"); refresh(); return { success: "Verknüpfung gespeichert." }; }
  catch (error) { return errorState(error); }
}
export async function transferTopicAction(topicId: number, _previous: MeetingActionState, form: FormData): Promise<MeetingActionState> {
  const user = await requireUser(); let result: number;
  try { result = await service.transferTopic(user, topicId, id(form.get("meetingId")), form.get("confirmDisclosure") === "on"); refresh(); }
  catch (error) { return errorState(error); }
  redirect(`/intern/sitzungen/top/${result}`);
}
export async function documentAction(topicId: number, _previous: MeetingActionState, form: FormData): Promise<MeetingActionState> {
  const user = await requireUser();
  try {
    const disclose = form.get("confirmDisclosure") === "on";
    if (form.get("attachmentId")) await service.copyCardDocument(user, topicId, id(form.get("attachmentId")), disclose);
    else { const file = form.get("file"); if (!(file instanceof File)) throw new MeetingError("Bitte eine Datei auswählen."); await service.addMeetingDocument(user, topicId, file, disclose); }
    refresh(); return { success: "Sitzungsunterlage freigegeben." };
  } catch (error) { return errorState(error); }
}
export async function removeDocumentAction(documentId: number, _previous: MeetingActionState, _form: FormData): Promise<MeetingActionState> {
  const user = await requireUser();
  try { await service.removeMeetingDocument(user, documentId); refresh(); return { success: "Unterlage entfernt." }; }
  catch (error) { return errorState(error); }
}
export async function deleteTopicAction(topicId: number, _previous: MeetingActionState, form: FormData): Promise<MeetingActionState> {
  const user = await requireUser();
  try { if (form.get("confirmDelete") !== "on") throw new MeetingError("Bitte das Löschen bestätigen."); await service.deleteTopic(user, topicId); refresh(); }
  catch (error) { return errorState(error); }
  redirect("/intern/sitzungen");
}
export async function reorderTopicsAction(meetingId: number, ids: number[], rev: number): Promise<MeetingActionState> {
  const user = await requireUser();
  try { await service.reorderTopics(user, meetingId, ids, rev); refresh(); return { success: "Reihenfolge gespeichert." }; }
  catch (error) { return errorState(error); }
}

export async function deleteMeetingAction(meetingId: number, _previous: MeetingActionState, form: FormData): Promise<MeetingActionState> {
  const user = await requireUser();
  try { if (form.get("confirmDelete") !== "on") throw new MeetingError("Bitte das Löschen bestätigen."); await service.deleteMeeting(user, meetingId); refresh(); }
  catch (error) { return errorState(error); }
  redirect("/intern/sitzungen");
}

export async function confirmedDeleteMeetingAction(meetingId:number):Promise<MeetingActionState|void>{
  const user=await requireUser();try{await service.deleteMeeting(user,meetingId);refresh();}catch(error){return errorState(error);}redirect("/intern/sitzungen");
}
export async function confirmedDeleteTopicAction(topicId:number):Promise<MeetingActionState|void>{
  const user=await requireUser();try{await service.deleteTopic(user,topicId);refresh();}catch(error){return errorState(error);}redirect("/intern/sitzungen");
}
export async function confirmedRemoveDocumentAction(documentId:number):Promise<MeetingActionState|void>{
  const user=await requireUser();try{await service.removeMeetingDocument(user,documentId);refresh();}catch(error){return errorState(error);}
}

/** Plan an existing proposal without replacing its content or disclosure settings. */
export async function scheduleTopicAction(topicId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();
  try {
    await service.scheduleTopic(user,topicId,revision(form),form.has("section")?String(form.get("section")) as "public"|"non_public":undefined);refresh();
    return {success:"In die Tagesordnung übernommen."};
  }catch(error){return errorState(error);}
}

export async function setTopicStatusAction(topicId:number,state:string,rev:number,section?:"public"|"non_public"):Promise<MeetingActionState>{
  const user=await requireUser();try{await service.setTopicStatus(user,topicId,state,rev,section);refresh();return {success:"TOP-Status gespeichert."};}catch(error){return errorState(error);}
}
export async function transferTopicInlineAction(topicId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();try{await service.transferTopic(user,topicId,id(form.get("meetingId")),form.get("confirmDisclosure")==="on");refresh();return {success:"Für die neue Sitzung vorgeschlagen."};}catch(error){return errorState(error);}
}

export async function resolvePersonalTopicAction(topicId:number,_previous:MeetingActionState,_form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();try{await service.resolvePersonalTopic(user,topicId);refresh();return {success:"Thema als erledigt markiert."};}catch(error){return errorState(error);}
}

export async function proposePersonalTopicAction(topicId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();try{const personalId=await service.personalTopicForAction(user,topicId);await service.transferTopic(user,personalId,id(form.get("meetingId")),form.get("confirmDisclosure")==="on");refresh();return {success:"Für die neue Sitzung vorgeschlagen."};}catch(error){return errorState(error);}
}

export async function saveAgendaSettingsAction(areaId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();
  try{await service.saveAgendaSettings(user,areaId,{publicNumbering:form.get("publicNumbering"),nonPublicNumbering:form.get("nonPublicNumbering"),firstSection:form.get("firstSection")});refresh();return {success:"Tagesordnungseinstellungen gespeichert."};}catch(error){return errorState(error);}
}

export async function uploadWordTemplateAction(areaId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();
  try{const file=form.get("template");if(!(file instanceof File))throw new MeetingError("Bitte eine Wordvorlage auswählen.");await uploadWordTemplate(user,areaId,file,revision(form));refresh();return {success:"Wordvorlage gespeichert. Bitte Formatvorlagen und Musterbereich prüfen."};}catch(error){return errorState(error);}
}
export async function saveWordConfigurationAction(areaId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();
  try{const styles=Object.fromEntries(Object.keys(wordStyleRoles).map(role=>[role,String(form.get(`style_${role}`)??"")])) as WordStyleMapping;const insertion=String(form.get("insertion")) as "replace"|"placeholder"|"append";await saveWordConfiguration(user,areaId,{styles,insertion,start:Number(form.get("start")),end:Number(form.get("end"))},revision(form));refresh();return {success:"Wordexport-Einstellungen gespeichert."};}catch(error){return errorState(error);}
}
export async function removeWordTemplateAction(areaId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
  const user=await requireUser();
  try{await removeWordTemplate(user,areaId,revision(form));refresh();return {success:"Wordvorlage entfernt."};}catch(error){return errorState(error);}
}
