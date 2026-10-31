// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {getCurrentUser,resolveSessionUser} from "@/lib/auth";
import {getSession} from "@/lib/auth/session";
import {appChangeSSE} from "@/lib/sse";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request){
 if(!await getCurrentUser())return new Response("Unauthorized",{status:401,headers:{"Cache-Control":"private, no-store"}});
 const session=await getSession();const response=appChangeSSE(request.signal,async()=>!!await resolveSessionUser(session));
 response.headers.set("Cache-Control","private, no-store, no-transform");return response;
}
