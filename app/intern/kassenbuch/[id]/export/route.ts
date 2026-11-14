// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {and,asc,eq} from "drizzle-orm";
import {getCurrentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {cashbookEntries} from "@/lib/db/schema";
import {requireCashbook} from "@/lib/cashbook/access";
import {buildCashbookTable} from "@/lib/cashbook/export";
import {exportDownload} from "@/lib/export-download";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!user)return Response.json({error:"Bitte zuerst anmelden."},{status:401});
 let access;try{access=await requireCashbook(user,Number((await params).id));}catch{return Response.json({error:"Sie haben nicht die nötigen Rechte für dieses Kassenbuch."},{status:403});}
 if(access.permission==="office")return Response.json({error:"Der vollständige Kassenbuchexport erfordert mindestens lesenden Zugriff. Die Bürozuweisung allein reicht dafür nicht aus."},{status:403});
 const entries=await db.select().from(cashbookEntries).where(and(eq(cashbookEntries.cashbookId,access.book.id),eq(cashbookEntries.state,"posted"))).orderBy(asc(cashbookEntries.authorizedAt),asc(cashbookEntries.id));
 const table=buildCashbookTable(entries);table.subtitle=access.book.name;
 return exportDownload(request,table,access.book.name);
}
