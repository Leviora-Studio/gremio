// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {createHash} from "node:crypto";
import sharp from "sharp";
import {eq} from "drizzle-orm";
import {db} from "@/lib/db";
import {receiptBranding,locations,feedbackAreas,feedbackSubmissions,type User} from "@/lib/db/schema";
import type {ReceiptBranding} from "@/lib/pdf";
export type ReceiptScope={kind:"location"|"feedback";id:number};
export type BrandingState={error?:string;success?:string};
export function isReceiptScope(scope:ReceiptScope):boolean{return ["location","feedback"].includes(scope.kind)&&Number.isSafeInteger(scope.id)&&scope.id>0&&scope.id<=2147483647;}
export function logoVersion(logo:string|null|undefined){return logo?createHash("sha256").update(logo).digest("hex").slice(0,16):"";}
export async function getLocalReceiptBranding(scope:ReceiptScope){
  if(!isReceiptScope(scope))return undefined;
  const table=scope.kind==="location"?locations:feedbackAreas;
  const [row]=await db.select({enabled:table.receiptBrandingEnabled,organization:table.receiptOrganization,logoPng:table.receiptLogoPng,name:table.name}).from(table).where(eq(table.id,scope.id));
  return row;
}
export async function getReceiptBranding(scope?:ReceiptScope):Promise<ReceiptBranding>{
  if(scope){const local=await getLocalReceiptBranding(scope);if(local?.enabled)return {organization:local.organization||local.name,logoPng:local.logoPng};}
  const [settings]=await db.select().from(receiptBranding).where(eq(receiptBranding.id,1));return {organization:settings?.organization||"Gremio",logoPng:settings?.logoPng};
}
export async function getFeedbackReceiptBranding(cardId:number){
  const [source]=await db.select({id:feedbackSubmissions.areaId}).from(feedbackSubmissions).where(eq(feedbackSubmissions.cardId,cardId));
  return getReceiptBranding(source?.id==null?undefined:{kind:"feedback",id:source.id});
}
/** Shared validation/image normalization for both global and per-form settings. No file I/O under locks. */
export async function saveReceiptBranding(user:User,scope:ReceiptScope|undefined,form:FormData):Promise<BrandingState>{
  if(!user.isActive||user.role!=="admin")return {error:"Kein Zugriff."};
  if(scope&&!isReceiptScope(scope))return {error:"Ungültige Auswahl."};
  const local=scope?await getLocalReceiptBranding(scope):undefined;
  if(scope&&!local)return {error:"Standort oder Umfrage nicht gefunden."};
  const enabled=form.get("customBranding")==="on";
  // Disabling the override preserves its saved settings for later reuse.
  const organization=scope&&!enabled?local!.organization:String(form.get("organization")??"").trim();
  if(organization.length>160||/[\r\n\x00-\x1f]/.test(organization))return {error:"Bitte einen einzeiligen Gremiennamen mit höchstens 160 Zeichen eingeben."};
  const current=local??await getReceiptBranding();let logoPng=current.logoPng??null;const file=form.get("logo");
  if((!scope||enabled)&&form.get("removeLogo")==="on")logoPng=null;
  if((!scope||enabled)&&form.get("removeLogo")!=="on"&&file instanceof File&&file.size){
    if(file.size>2*1024*1024||!["image/png","image/jpeg"].includes(file.type))return {error:"Bitte ein PNG- oder JPEG-Logo mit höchstens 2 MB auswählen."};
    try{const image=sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:16_000_000});const meta=await image.metadata();if(!["png","jpeg"].includes(meta.format??"")||(meta.pages??1)>1)return {error:"Bitte eine einzelne PNG- oder JPEG-Grafik auswählen."};logoPng=(await image.rotate().resize({width:800,height:400,fit:"inside",withoutEnlargement:true}).png().toBuffer()).toString("base64");}catch{return {error:"Die Bilddatei konnte nicht gelesen werden."};}
  }
  if(scope){const table=scope.kind==="location"?locations:feedbackAreas;const rows=await db.update(table).set({receiptBrandingEnabled:enabled,receiptOrganization:organization,receiptLogoPng:logoPng}).where(eq(table.id,scope.id)).returning({id:table.id});if(!rows.length)return {error:"Standort oder Umfrage nicht mehr vorhanden."};}
  else await db.insert(receiptBranding).values({id:1,organization,logoPng}).onConflictDoUpdate({target:receiptBranding.id,set:{organization,logoPng}});
  return {success:"Gestaltung der Empfangsbestätigungen gespeichert."};
}
