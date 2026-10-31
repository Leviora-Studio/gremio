// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { meetingDocuments } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { parseApiId } from "@/lib/api";
import { absPath, contentDisposition } from "@/lib/attachments";
import { requireTopic } from "@/lib/meetings/access";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const user=await getCurrentUser();if(!user)return new Response("Unauthorized",{status:401,headers});
  const id=parseApiId((await params).id);if(!id)return new Response("Not found",{status:404,headers});
  try {
    const [doc]=await db.select().from(meetingDocuments).where(eq(meetingDocuments.id,id));if(!doc)return new Response("Not found",{status:404,headers});
    await requireTopic(user,doc.topicId);const bytes=await readFile(absPath(doc.path));await requireTopic(user,doc.topicId);
    return new Response(new Uint8Array(bytes),{headers:{...headers,"Content-Type":doc.mime,"Content-Disposition":contentDisposition(doc.filename,"attachment"),"Content-Length":String(bytes.length)}});
  }catch{return new Response("Nicht verfügbar",{status:404,headers});}
}
