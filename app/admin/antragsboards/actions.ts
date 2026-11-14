// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import {redirect} from "next/navigation";
import {requireAdmin} from "@/lib/auth";
import {createBoardFromTemplate} from "@/lib/boards";
import {sanitizeSingleLine} from "@/lib/text";
export async function createApplicationBoardAction(_previous:{error?:string},form:FormData):Promise<{error?:string}>{
 const user=await requireAdmin(),name=sanitizeSingleLine(form.get("name")),description=String(form.get("description")??"");
 if(!name||name.length>120||description.length>500)return {error:"Bitte einen Namen mit höchstens 120 Zeichen und eine Beschreibung mit höchstens 500 Zeichen eingeben."};
 const template=String(form.get("templateId")??""),templateId=template?Number(template):null;
 if(templateId!=null&&(!Number.isSafeInteger(templateId)||templateId<1))return {error:"Ungültige Spaltenvorlage."};
 let id:number;
 try{id=await createBoardFromTemplate(user.id,name,description||null,templateId,{attachmentFields:form.getAll("attachmentFields").map(String)});}
 catch(error){return {error:error instanceof Error?error.message:"Antragsboard konnte nicht erstellt werden."};}
 redirect(`/intern/board/${id}`);
}
