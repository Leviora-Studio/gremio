// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {getCurrentUser} from "@/lib/auth";
import {canAccessFinanceBoard,getFinanceBoardById} from "@/lib/finance";
import {loadFinanceData} from "@/lib/finance-data";
import {buildFinanceTable,VIEW_TITLES} from "@/lib/finance-export";
import {exportDownload} from "@/lib/export-download";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!user)return Response.json({error:"Bitte zuerst anmelden."},{status:401});
 const id=Number((await params).id);if(!Number.isSafeInteger(id)||id<1||id>2147483647)return Response.json({error:"Finanzübersicht nicht verfügbar."},{status:404});
 const board=await getFinanceBoardById(id);if(!board||!await canAccessFinanceBoard(user,board))return Response.json({error:"Finanzübersicht nicht verfügbar."},{status:404});
 const view=new URL(request.url).searchParams.get("view")??"plan";if(!Object.hasOwn(VIEW_TITLES,view))return Response.json({error:"Ungültige Finanzansicht."},{status:400});
 const data=await loadFinanceData(board),table=buildFinanceTable(view,data);
 const accounts=view==="live"||view==="actual"?data.expenseAccountNames:data.accountNames;
 table.subtitle=`${board.name} · ${accounts.length>1?"Konten":"Konto"}: ${accounts.length?accounts.join(", "):"nicht festgelegt"}`;
 if(data.inaccessible.length)table.notes=[`Datenumfang: ${data.inaccessible.length} Quellboards wegen fehlender Rechte nicht berücksichtigt.`];
 return exportDownload(request,table,`${board.name}_${VIEW_TITLES[view]}`);
}
