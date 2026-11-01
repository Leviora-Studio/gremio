// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {getCurrentUser} from "@/lib/auth";
import {parseApiId} from "@/lib/api";
import {MeetingError,requireMeeting} from "@/lib/meetings/access";
import {buildMeetingAgendaWord} from "@/lib/meetings/word";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();if(!user)return new Response("Unauthorized",{status:401,headers});
  const id=parseApiId((await params).id);if(!id)return new Response("Not found",{status:404,headers});
  try{await requireMeeting(user,id,"manage");}catch{return new Response("Nicht verfügbar",{status:404,headers});}
  try{const output=await buildMeetingAgendaWord(user,id);return new Response(new Uint8Array(output),{headers:{...headers,"Content-Type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","Content-Disposition":`attachment; filename="Tagesordnung-${id}.docx"`}});}
  catch(error){return new Response(error instanceof MeetingError?error.message:"Der Wordexport konnte nicht erstellt werden.",{status:422,headers});}
}
