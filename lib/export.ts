// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildXlsx } from "@/lib/xlsx";

export type Cell = string | number | null;
// section/total = Trenn-/Summenzeilen; top = Oberpunkt (Block-Kopf),
// sub = Unterpunkt (im Block). top+sub bilden im PDF eine Box.
export type RowStyle = "section" | "total" | "top" | "sub";
/** Eine Zeile: entweder nur Zellen oder Zellen + Stil. */
export type Row = Cell[] | { cells: Cell[]; style?: RowStyle };

export type Column = {
  key?: string;
  date?: "date" | "datetime";
  header: string;
  /** Relatives Breitengewicht (PDF) bzw. abgeleitete Spaltenbreite (Excel). */
  width?: number;
  money?: boolean;
};

export type Table = {
  title: string;
  subtitle?: string;
  notes?: string[];
  exportedAt?: string;
  columns: Column[];
  /** Zellen: string | number | null. Money-Spalten als Zahl (in EURO). */
  rows: Row[];
};

function normRow(r: Row): { cells: Cell[]; style?: RowStyle } {
  return Array.isArray(r) ? { cells: r } : r;
}

// --- Excel (.xlsx) ----------------------------------------------------------
function excelDate(value:Cell,dateType:"date"|"datetime"):Cell{
  if(value==null||value==="")return null;
  const date=new Date(String(value));if(Number.isNaN(date.getTime()))return value;
  if(dateType==="date")return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())/86400000+25569;
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date).map(part=>[part.type,part.value]));
  return Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second))/86400000+25569;
}
export async function tablesToXlsx(tables: Table[], options:{protect?:boolean}={}): Promise<Uint8Array> {
  return buildXlsx(
    tables.map((t) => ({
      name: t.title,
      protected:options.protect,
      columns: t.columns.map((c) => ({
        header: c.header,
        money: c.money,
        date:c.date,
        // Relatives Gewicht → Excel-Zeichenbreite.
        width: Math.min(72, Math.max(c.money ? 18 : c.date ? 22 : 12, c.header.length + 2, Math.round((c.width ?? 1.7) * 9))),
      })),
      rows: t.rows.map((r) => {const row=normRow(r);return {...row,cells:row.cells.map((value,index)=>t.columns[index]?.date?excelDate(value,t.columns[index].date!):value)};}),
    })),
  );
}

// --- PDF --------------------------------------------------------------------
function pdfSafe(s: string): string {
  return (
    s
      .replace(/[\r\n\t]/g, " ")
      .replace(/[\u2018\u2019\u201A]/g, "'")
      .replace(/[\u201C\u201D\u201E]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\u00A0/g, " ")
      // Helvetica/WinAnsi: druckbares Latin-1 + Euro behalten, Rest -> "?".
      .replace(/[^\x20-\x7E\u00A0-\u00FF\u20AC]/g, "?")
  );
}

function money(v: number): string {
  return v.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function wrap(text: string, font: import("pdf-lib").PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean), lines:string[]=[];
  let line="";
  for (const word of words) {
    if (line && font.widthOfTextAtSize(`${line} ${word}`,size)<=width) {line+=` ${word}`;continue;}
    if (line) {lines.push(line);line="";}
    let piece="";
    for (const char of word) {if(piece&&font.widthOfTextAtSize(piece+char,size)>width){lines.push(piece);piece="";}piece+=char;}
    line=piece;
  }
  if(line)lines.push(line);
  return lines.length?lines:[""];
}

/** Fixed paper formats, readable type and a repeated document/table header. */
export async function tablesToPdf(docTitle: string, tables: Table[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(docTitle));doc.setProducer("Gremio");doc.setCreator("Gremio");doc.setLanguage("de-DE");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.12,.17,.25), muted = rgb(.38,.43,.5), brand = rgb(.2,.3,.66);
  const rule = rgb(.86,.89,.92), soft = rgb(.96,.97,.985), stripe = rgb(.982,.986,.993);
  const margin = 36, bottom = 48, padding = 9;
  const footerTitles: string[] = [];

  for (const table of tables) {
    if (!table.columns.length) throw new Error("Mindestens eine Exportspalte ist erforderlich.");
    // Wide accounting tables use A3 landscape instead of an arbitrary oversized page.
    const [width,height] = table.columns.length > 6 ? [1190.55,841.89] : table.columns.length > 4 ? [841.89,595.28] : [595.28,841.89];
    const inner = width - 2 * margin, size = table.columns.length > 6 ? 9 : 10;
    const leading = size + 4, headerSize = 8.5;
    const rowLabel = (value: Cell | undefined, column: Column) => {
      if (value == null) return "";
      if (column.money && typeof value === "number") return money(value);
      if (value && column.date) {
        const date = new Date(String(value));
        if (!Number.isNaN(date.getTime())) return column.date === "datetime"
          ? date.toLocaleString("de-DE",{dateStyle:"medium",timeStyle:"short",timeZone:"Europe/Berlin"})
          : date.toLocaleDateString("de-DE",{timeZone:"Europe/Berlin"});
      }
      const text = String(value);
      if ((column.key === "iban" || column.header === "IBAN") && /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(text.replace(/\s/g,""))) return text.replace(/\s/g,"").match(/.{1,4}/g)!.join(" ");
      return text;
    };
    const displayRows = table.rows.map(raw=>table.columns.map((column,index)=>rowLabel(normRow(raw).cells[index],column)));
    const minimums = table.columns.map((column,index) => Math.max(
      42,
      ...pdfSafe(column.header).split(/\s+/).map(word=>bold.widthOfTextAtSize(word,headerSize)+2*padding),
      column.date ? column.date === "datetime" ? 96 : 74 : 0,
      column.key === "iban" || column.header === "IBAN" ? 110 : 0,
      // Avoid splitting ordinary names into an almost complete word plus one letter.
      Math.min(140,displayRows.reduce((widest,cells)=>cells[index].split(/\s+/).reduce((max,word)=>Math.max(max,font.widthOfTextAtSize(pdfSafe(word),size)+2*padding),widest),0)),
      column.money ? displayRows.reduce((widest,cells)=>Math.max(widest,bold.widthOfTextAtSize(pdfSafe(cells[index]),size)+2*padding),64) : 0,
    ));
    const minimumTotal = minimums.reduce((sum,value)=>sum+value,0);
    const weights = table.columns.map(column=>column.width??1.7), weightTotal = weights.reduce((sum,value)=>sum+value,0);
    const widths = minimums.map((minimum,index)=>minimumTotal<=inner ? minimum+(inner-minimumTotal)*weights[index]/weightTotal : minimum/minimumTotal*inner);
    const positions: number[] = [];let left=margin;
    for (const cellWidth of widths) {positions.push(left);left+=cellWidth;}
    const headers = table.columns.map((column,index)=>wrap(column.header,bold,headerSize,widths[index]-2*padding));
    const headerHeight = Math.max(...headers.map(lines=>lines.length))*11.5+18;
    const notes = table.notes??[];
    const noteRows = notes.map(note=>{
      const colon=note.indexOf(":"), label=colon>0&&colon<32?note.slice(0,colon+1):"Hinweis:";
      const value=label==="Hinweis:"?note:note.slice(colon+1).trim();
      return {label,lines:wrap(value,font,8.5,inner-158)};
    });
    const infoHeight = noteRows.length ? 29+noteRows.reduce((sum,note)=>sum+Math.max(1,note.lines.length)*11.5+5,0) : 0;
    let page: import("pdf-lib").PDFPage, y=0, bodyTop=0, rowIndex=0;
    function newPage() {
      page=doc.addPage([width,height]);footerTitles.push(table.title);
      let top=height-margin;
      page.drawText("GREMIO  /  FINANZEN",{x:margin,y:top-7,size:8,font:bold,color:brand});
      if (table.exportedAt) {
        const stamp=`Erstellt am ${table.exportedAt}`;
        page.drawText(stamp,{x:width-margin-font.widthOfTextAtSize(pdfSafe(stamp),8),y:top-7,size:8,font,color:muted});
      }
      top-=36;
      for(const line of wrap(table.title,bold,20,inner)) {page.drawText(line,{x:margin,y:top,size:20,font:bold,color:ink});top-=25;}
      if(table.subtitle) for(const line of wrap(table.subtitle,font,10,inner)) {page.drawText(line,{x:margin,y:top-1,size:10,font,color:muted});top-=14;}
      top-=13;
      if(noteRows.length) {
        page.drawRectangle({x:margin,y:top-infoHeight,width:inner,height:infoHeight,color:soft});
        page.drawText("EXPORTAUSWAHL",{x:margin+12,y:top-16,size:7.5,font:bold,color:brand});
        let noteY=top-33;
        for(const note of noteRows) {
          page.drawText(pdfSafe(note.label),{x:margin+12,y:noteY,size:8.5,font:bold,color:muted});
          for(const line of note.lines) {page.drawText(line,{x:margin+140,y:noteY,size:8.5,font,color:muted});noteY-=11.5;}
          noteY-=5;
        }
        top-=infoHeight+20;
      }
      page.drawRectangle({x:margin,y:top-headerHeight,width:inner,height:headerHeight,color:soft});
      page.drawLine({start:{x:margin,y:top},end:{x:width-margin,y:top},thickness:1.4,color:brand});
      headers.forEach((lines,index)=>lines.forEach((line,lineIndex)=>{
        const x=table.columns[index].money?positions[index]+widths[index]-padding-bold.widthOfTextAtSize(line,headerSize):positions[index]+padding;
        page.drawText(line,{x,y:top-17-lineIndex*11.5,size:headerSize,font:bold,color:ink});
      }));
      y=top-headerHeight;bodyTop=y;
      if(y<bottom+64) throw new Error("Die Exportauswahl enthält zu viele Hinweise. Bitte weniger Filter verwenden.");
    }
    newPage();
    type Prepared = {cells:Cell[];style?:RowStyle;lines:string[][];details:{label:string;lines:string[]}[];height:number;font:import("pdf-lib").PDFFont};
    const prepared: Prepared[] = table.rows.map((raw,rowIndex)=>{
      const row=normRow(raw),bodyFont=row.style&&row.style!=="sub"?bold:font;
      const details: Prepared["details"] = [];
      const lines=table.columns.map((column,index)=>{
        const value=displayRows[rowIndex][index];
        let wrapped=wrap(value,column.money?bold:bodyFont,size,widths[index]-2*padding-(row.style==="sub"&&index===1?12:0));
        if((column.key==="iban"||column.header==="IBAN")&&wrapped.length>1) {
          const groups=value.split(" "),perLine=Math.ceil(groups.length/wrapped.length),balanced:string[]=[];
          for(let i=0;i<groups.length;i+=perLine) balanced.push(groups.slice(i,i+perLine).join(" "));
          if(balanced.every(line=>bodyFont.widthOfTextAtSize(pdfSafe(line),size)<=widths[index]-2*padding)) wrapped=balanced;
        }
        if(!row.style&&!column.money&&!column.date&&wrapped.length>5&&widths[index]<inner*.5) {
          details.push({label:column.header,lines:wrap(value,font,size,inner-2*padding)});
          return wrap("Volltext unten",font,size,widths[index]-2*padding);
        }
        return wrapped;
      });
      return {...row,lines,details,font:bodyFont,height:Math.max(1,...lines.map(cell=>cell.length))*leading+18+details.reduce((sum,detail)=>sum+detail.lines.length*leading+29,0)};
    });
    if(!prepared.length) {
      page!.drawRectangle({x:margin,y:y-48,width:inner,height:48,color:stripe});
      page!.drawText("Keine passenden Einträge vorhanden.",{x:margin+padding,y:y-28,size,font,color:muted});
    }
    for(const [index,row] of prepared.entries()) {
      const freshCapacity=bodyTop-bottom;
      // Keep ordinary rows and section headings with their following position together.
      const following=prepared[index+1];
      const keepHeight=row.height+(row.style==="section"&&following?Math.min(following.height,freshCapacity-row.height):0);
      if(keepHeight<=freshCapacity&&y-keepHeight<bottom&&y<bodyTop) newPage();
      let offset=0;
      const count=Math.max(1,...row.lines.map(lines=>lines.length));
      while(offset<count) {
        if(y-bottom<leading+18) newPage();
        if(offset>0) {
          page!.drawRectangle({x:margin,y:y-19,width:inner,height:19,color:soft});
          page!.drawText("Fortsetzung der vorherigen Tabellenzeile",{x:margin+padding,y:y-12,size:7.5,font,color:muted});
          y-=19;
        }
        const take=Math.min(count-offset,Math.floor((y-bottom-18)/leading));
        if(take<1) throw new Error("Für diese Exportauswahl bleibt kein Platz für Datenzeilen.");
        const blockHeight=take*leading+18;
        const fill=row.style==="total"?rgb(.91,.94,.98):row.style==="section"?rgb(.9,.93,.97):row.style==="top"?soft:rowIndex%2?stripe:undefined;
        if(fill) page!.drawRectangle({x:margin,y:y-blockHeight,width:inner,height:blockHeight,color:fill});
        if(row.style==="total") page!.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:1.2,color:brand});
        row.lines.forEach((lines,columnIndex)=>lines.slice(offset,offset+take).forEach((line,lineIndex)=>{
          const column=table.columns[columnIndex],cellFont=column.money?bold:row.font;
          const indent=row.style==="sub"&&columnIndex===1?12:0;
          const x=column.money?positions[columnIndex]+widths[columnIndex]-padding-cellFont.widthOfTextAtSize(line,size):positions[columnIndex]+padding+indent;
          const color=column.money&&typeof row.cells[columnIndex]==="number"&&Number(row.cells[columnIndex])<0?rgb(.65,.18,.22):row.style==="sub"?muted:ink;
          page!.drawText(line,{x,y:y-padding-size-lineIndex*leading,size,font:cellFont,color});
        }));
        y-=blockHeight;offset+=take;
        page!.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:.45,color:rule});
        if(offset<count) newPage();
      }
      // Long prose gets full line width immediately below its own entry.
      // This retains the complete value without an excessively tall narrow cell.
      for(const detail of row.details) {
        let offset=0;
        while(offset<detail.lines.length) {
          if(y-bottom<leading+29) newPage();
          const take=Math.min(detail.lines.length-offset,Math.floor((y-bottom-29)/leading));
          const blockHeight=take*leading+29;
          page!.drawRectangle({x:margin,y:y-blockHeight,width:inner,height:blockHeight,color:rowIndex%2?stripe:rgb(1,1,1)});
          page!.drawLine({start:{x:margin+1,y:y-7},end:{x:margin+1,y:y-blockHeight+7},thickness:1.5,color:rule});
          page!.drawText(pdfSafe(`${detail.label}${offset?" (Fortsetzung)":""}`),{x:margin+padding,y:y-13,size:8,font:bold,color:muted});
          detail.lines.slice(offset,offset+take).forEach((line,index)=>page!.drawText(line,{x:margin+padding,y:y-28-index*leading,size,font,color:ink}));
          y-=blockHeight;offset+=take;
          page!.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:.45,color:rule});
          if(offset<detail.lines.length) newPage();
        }
      }
      rowIndex++;
    }
  }
  const pages=doc.getPages();
  pages.forEach((page,index)=>{
    const width=page.getWidth(),label=`Seite ${index+1} von ${pages.length}`;
    page.drawLine({start:{x:margin,y:32},end:{x:width-margin,y:32},thickness:.5,color:rule});
    page.drawText(pdfSafe(`Gremio | ${footerTitles[index]}`),{x:margin,y:19,size:8,font,color:muted});
    page.drawText(label,{x:width-margin-font.widthOfTextAtSize(label,8),y:19,size:8,font,color:muted});
  });
  return doc.save();
}
