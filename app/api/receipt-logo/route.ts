// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {getCurrentUser} from "@/lib/auth";
import {getReceiptBranding,getLocalReceiptBranding,isReceiptScope,type ReceiptScope} from "@/lib/receipt-branding";
export async function GET(request:Request){
  const user=await getCurrentUser();if(user?.role!=="admin")return new Response("Not found",{status:404});
  const params=new URL(request.url).searchParams;let branding;
  if(params.has("kind")||params.has("id")){const scope={kind:params.get("kind"),id:Number(params.get("id"))} as ReceiptScope;if(!isReceiptScope(scope))return new Response("Not found",{status:404});branding=await getLocalReceiptBranding(scope);}
  else branding=await getReceiptBranding();
  if(!branding?.logoPng)return new Response("Not found",{status:404});
  return new Response(Buffer.from(branding.logoPng,"base64"),{headers:{"Content-Type":"image/png","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
