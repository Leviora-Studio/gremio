// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {PDFDocument,StandardFonts,rgb} from "pdf-lib";
import {winAnsiSafe,wrapText} from "@/lib/pdf";

/** Intentionally accepts only the numbered titles needed by the agenda list. */
export async function renderAgendaListPdf(topics:ReadonlyArray<{number:string;title:string;parentId:number|null}>):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  let page=pdf.addPage([595.28,841.89]),y=780;
  page.drawText("Tagesordnungspunkte",{x:56,y,size:22,font:bold,color:rgb(.1,.15,.23)});y-=38;
  for(const topic of topics){
    const x=topic.parentId===null?56:76;
    for(const paragraph of winAnsiSafe(`TOP ${topic.number}: ${topic.title}`,{keepNewlines:true}).split("\n")){
      for(const part of wrapText(paragraph,regular,11,539-x)){
        if(y<76){page=pdf.addPage([595.28,841.89]);y=780;}
        page.drawText(part,{x,y,size:11,font:regular,color:rgb(.1,.15,.23)});y-=16;
      }
    }
    y-=5;
  }
  return pdf.save();
}
