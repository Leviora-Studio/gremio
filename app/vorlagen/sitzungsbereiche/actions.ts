// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import {requireTemplateManager,requireUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {MeetingError} from "@/lib/meetings/access";
import {saveMeetingTemplate,deleteMeetingTemplate,saveAreaDefaults,applyMeetingTemplate} from "@/lib/meetings/templates";
import type {MeetingActionState} from "@/app/intern/sitzungen/actions";
const error=(e:unknown)=>({error:e instanceof MeetingError?e.message:"Die Änderung konnte nicht gespeichert werden. Bitte Angaben und Vorlagennamen prüfen."});
function refresh(){revalidatePath("/vorlagen/sitzungsbereiche","layout");revalidatePath("/intern/sitzungen","layout");}
function formTopics(form:FormData){try{return JSON.parse(String(form.get("topics")??"[]"));}catch{throw new MeetingError("Ungültige Standard-TOPs.");}}
export async function saveMeetingTemplateAction(id:number|null,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
 const user=await requireTemplateManager();let saved:number;
 try{saved=await saveMeetingTemplate(user,id,String(form.get("name")??""),String(form.get("description")??""),formTopics(form),Number(form.get("revision")));refresh();}catch(e){return error(e);}
 if(id==null)redirect(`/vorlagen/sitzungsbereiche/${saved}`);return {success:"Sitzungsbereichsvorlage gespeichert."};
}
export async function deleteMeetingTemplateAction(id:number,revision:number):Promise<MeetingActionState|void>{
 const user=await requireTemplateManager();try{await deleteMeetingTemplate(user,id,revision);refresh();}catch(e){return error(e);}redirect("/vorlagen/sitzungsbereiche");
}
export async function saveAreaDefaultsAction(areaId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
 const user=await requireUser();try{await saveAreaDefaults(user,areaId,formTopics(form),Number(form.get("revision")),form.get("includeMiscellaneous")==="on");refresh();return {success:"Standard-TOPs für neue Sitzungen gespeichert."};}catch(e){return error(e);}
}
export async function applyMeetingTemplateAction(areaId:number,_previous:MeetingActionState,form:FormData):Promise<MeetingActionState>{
 const user=await requireUser();try{const value=String(form.get("templateId")??"");const id=value?Number(value):null;if(id!=null&&(!Number.isSafeInteger(id)||id<1))throw new MeetingError("Bitte eine gültige Vorlage wählen.");await applyMeetingTemplate(user,areaId,id,Number(form.get("revision")));refresh();return {success:"Vorlage übernommen. Die Standard-TOPs können jetzt angepasst werden."};}catch(e){return error(e);}
}
