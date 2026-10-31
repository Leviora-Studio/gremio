// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { getCurrentUser } from "@/lib/auth";
import { parseApiId } from "@/lib/api";
import { buildMeetingAgendaPdf } from "@/lib/meetings/pdf";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const user=await getCurrentUser();if(!user)return new Response("Unauthorized",{status:401,headers});
  const id=parseApiId((await params).id);if(!id)return new Response("Not found",{status:404,headers});
  try {const pdf=await buildMeetingAgendaPdf(user,id);return new Response(new Uint8Array(pdf),{headers:{...headers,"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="Tagesordnung-${id}.pdf"`}});}
  catch{return new Response("Nicht verfügbar",{status:404,headers});}
}
