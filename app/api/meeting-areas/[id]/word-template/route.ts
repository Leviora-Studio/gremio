// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {readFile} from "node:fs/promises";
import {getCurrentUser} from "@/lib/auth";
import {parseApiId} from "@/lib/api";
import {absPath,contentDisposition} from "@/lib/attachments";
import {requireArea} from "@/lib/meetings/access";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();if(!user)return new Response("Unauthorized",{status:401,headers});
  const id=parseApiId((await params).id);if(!id)return new Response("Not found",{status:404,headers});
  try{
    const area=await requireArea(user,id,"manage");if(!area.wordTemplatePath||!area.wordTemplateName)return new Response("Nicht verfügbar",{status:404,headers});
    const bytes=await readFile(absPath(area.wordTemplatePath));await requireArea(user,id,"manage");
    const mime=area.wordTemplateName.toLowerCase().endsWith(".dotx")?"application/vnd.openxmlformats-officedocument.wordprocessingml.template":"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return new Response(new Uint8Array(bytes),{headers:{...headers,"Content-Type":mime,"Content-Disposition":contentDisposition(area.wordTemplateName)}});
  }catch{return new Response("Nicht verfügbar",{status:404,headers});}
}
