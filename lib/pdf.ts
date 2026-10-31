// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { receiptCopy } from "@/lib/receipt-copy";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, PDFString } from "pdf-lib";
import { formatDateTime } from "@/lib/dates";

/**
 * Macht freien Nutzertext für die WinAnsi-Standardschrift sicher: häufige
 * Typografie-Zeichen auf ASCII abbilden, alles außerhalb von Latin-1
 * (Emoji, nicht-lateinische Schriften) durch "?" ersetzen — sonst wirft
 * pdf-lib "WinAnsi cannot encode …" und der PDF-Abruf liefert 500.
 */
export function winAnsiSafe(s: string, opts: { keepNewlines?: boolean } = {}): string {
  const mapped = (s ?? "")
    .replace(/[‘’‚′´`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/€/g, "EUR");
  let out = "";
  for (const ch of mapped) {
    const c = ch.codePointAt(0) ?? 0;
    // ACHTUNG: TAB (9), LF (10) und CR (13) sind für den WinAnsi-Encoder von
    // pdf-lib KEINE darstellbaren Zeichen — `drawText` wirft daran. Früher
    // ließ diese Funktion sie ausdrücklich durch und war damit die Ursache
    // dauerhafter 500er auf den Eingangsbestätigungen.
    //   TAB → Leerzeichen, CR → verworfen (Zeilenenden sind vorher auf \n
    //   normalisiert), LF nur, wenn der aufrufende Builder selbst umbricht.
    if (c === 9) {
      out += " ";
      continue;
    }
    if (c === 13) continue;
    if (c === 10) {
      out += opts.keepNewlines ? ch : " ";
      continue;
    }
    // druckbares ASCII (0x20–0x7E) und Latin-1 (0xA0–0xFF: ä ö ü ß …).
    const ok = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff);
    out += ok ? ch : "?";
  }
  return out;
}

/**
 * Bricht Text auf eine gegebene Breite um: primär an Wortgrenzen, überlange
 * „Wörter" (URLs, zusammengeschriebene Ketten) hart auf Zeichenebene. Liefert
 * immer mindestens eine Zeile.
 */
export function wrapText(
  s: string,
  f: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const word of s.split(" ")) {
    let w = word;
    while (f.widthOfTextAtSize(w, size) > maxWidth) {
      let i = 1;
      while (i < w.length && f.widthOfTextAtSize(w.slice(0, i + 1), size) <= maxWidth) i++;
      if (cur) push();
      out.push(w.slice(0, i));
      w = w.slice(i);
    }
    const test = cur ? `${cur} ${w}` : w;
    if (cur && f.widthOfTextAtSize(test, size) > maxWidth) {
      push();
      cur = w;
    } else {
      cur = test;
    }
  }
  push();
  return out.length ? out : [""];
}

export type ReceiptBranding = { organization:string; logoPng?:string|null };
type ReceiptData={kind:"application"|"inventory"|"feedback";title:string;applicant:string;eingang:Date;statusLink:string;number?:string|null;feedbackText?:string;branding?:ReceiptBranding};
/** Shared letter layout for downloaded receipts and system-mail attachments. */
async function buildReceipt(data:ReceiptData):Promise<Uint8Array>{
  const doc=await PDFDocument.create();const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const W=595.28,H=841.89,left=57,right=538,width=right-left,ink=rgb(.12,.15,.19),muted=rgb(.38,.42,.47),rule=rgb(.82,.85,.88);
  const organization=winAnsiSafe(data.branding?.organization?.trim()||"Gremio");
  let logo:PDFImage|undefined;
  if(data.branding?.logoPng)logo=await doc.embedPng(Buffer.from(data.branding.logoPng,"base64"));
  let page=doc.addPage([W,H]),y=0;
  const header=(first:boolean)=>{
    const nameLines=wrapText(organization,bold,12,logo?width-125:width);
    let nameY=H-63;for(const line of nameLines){page.drawText(line,{x:left,y:nameY,size:12,font:bold,color:ink});nameY-=16;}
    if(logo){const size=logo.scaleToFit(105,52);page.drawImage(logo,{x:right-size.width,y:H-54-size.height,width:size.width,height:size.height});}
    const baseline=Math.min(H-119,nameY-17);page.drawLine({start:{x:left,y:baseline},end:{x:right,y:baseline},thickness:.7,color:rule});
    y=baseline-24;
    if(!first){page.drawText("Empfangsbestätigung - Fortsetzung",{x:left,y,size:9,font:regular,color:muted});y-=32;}
  };
  header(true);
  const text=(raw:string,opts:{size?:number;bold?:boolean;color?:ReturnType<typeof rgb>;after?:number;link?:string}={})=>{
    const size=opts.size??10.5,font=opts.bold?bold:regular;
    for(const paragraph of winAnsiSafe(raw,{keepNewlines:true}).split("\n"))for(const line of wrapText(paragraph,font,size,width)){
      if(y<82){page=doc.addPage([W,H]);header(false);}
      page.drawText(line,{x:left,y,size,font,color:opts.color??ink});
      if(opts.link&&line){const annotation=doc.context.obj({Type:"Annot",Subtype:"Link",Rect:[left,y-2,left+font.widthOfTextAtSize(line,size),y+size],Border:[0,0,0],A:{Type:"Action",S:"URI",URI:PDFString.of(opts.link)}});const ref=doc.context.register(annotation);page.node.addAnnot(ref);}
      y-=size*1.45;
    }
    y-=opts.after??9;
  };
  const field=(label:string,value:string)=>{if(y<120){page=doc.addPage([W,H]);header(false);}text(label,{size:8.5,bold:true,color:muted,after:2});text(value,{size:11,after:13});};
  text("EMPFANGSBESTÄTIGUNG",{size:9,bold:true,color:muted,after:22});
  field("Eingereicht von",data.applicant||"Ohne Namensangabe");
  const copy=receiptCopy(data.kind);
  text(copy.headline,{size:17,bold:true,after:13});
  if(data.number)text(`Vorgangsnummer: ${data.number}`,{size:10,bold:true,after:5});
  text(`Eingegangen am ${formatDateTime(data.eingang,"long")}`,{size:9.5,color:muted,after:22});
  text(copy.greeting,{after:12});
  text(copy.introduction,{after:18});
  field(data.kind==="inventory"?"Angefragte Gegenstände":data.kind==="feedback"?"Feedback-Bereich":"Antragsgegenstand",data.title);
  if(data.feedbackText){text("Eingereichtes Feedback",{size:9,bold:true,color:muted,after:6});text(data.feedbackText,{after:18});}
  // Keep the status section and closing together instead of orphaning a private URL.
  if(y<280){page=doc.addPage([W,H]);header(false);}
  text(copy.statusHeading,{size:11,bold:true,after:6});
  text(copy.statusText,{after:6});
  text(data.statusLink,{size:9,color:rgb(.12,.28,.52),after:12,link:data.statusLink});
  text(copy.privacyText,{size:9,color:muted,after:20});
  text(copy.closing,{after:3});text(organization,{bold:true,after:20});
  text(copy.disclaimer,{size:8.5,color:muted,after:0});
  const pages=doc.getPages();for(let i=0;i<pages.length;i++){const p=pages[i];p.drawLine({start:{x:left,y:53},end:{x:right,y:53},thickness:.5,color:rule});p.drawText("Automatisch erstellte Empfangsbestätigung",{x:left,y:36,size:8,font:regular,color:muted});const label=`Seite ${i+1} von ${pages.length}`;p.drawText(label,{x:right-regular.widthOfTextAtSize(label,8),y:36,size:8,font:regular,color:muted});}
  doc.setTitle("Empfangsbestätigung");doc.setAuthor(organization);return doc.save();
}
export async function buildConfirmationPdf(data:{kind?:"application"|"inventory";title:string;applicant:string;eingang:Date;statusLink:string;number?:string|null;branding?:ReceiptBranding}):Promise<Uint8Array>{return buildReceipt({...data,kind:data.kind??"application"});}
export async function buildFeedbackConfirmationPdf(data:{areaName:string;submitterName:string;feedbackText:string;eingang:Date;statusLink:string;number?:string|null;branding?:ReceiptBranding}):Promise<Uint8Array>{return buildReceipt({...data,kind:"feedback",title:data.areaName,applicant:data.submitterName});}
