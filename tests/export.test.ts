// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {test} from "node:test";
import assert from "node:assert/strict";
import {inflateRawSync} from "node:zlib";
import {PDFDocument} from "pdf-lib";
import {tablesToPdf,tablesToXlsx,type Table} from "../lib/export";
import {emptyExportSelection,parseExportSelection,selectExportTable,sortCompleteExportTable} from "../lib/export-selection";
import {exportDownload} from "../lib/export-download";
import {extractPdfText} from "../lib/pdf-text";
function unzip(bytes:Uint8Array){const buffer=Buffer.from(bytes),entries=new Map<string,string>();let offset=0;while(offset+30<=buffer.length&&buffer.readUInt32LE(offset)===0x04034b50){const compressedSize=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extraLength=buffer.readUInt16LE(offset+28),dataStart=offset+30+nameLength+extraLength;entries.set(buffer.subarray(offset+30,offset+30+nameLength).toString(),inflateRawSync(buffer.subarray(dataStart,dataStart+compressedSize)).toString());offset=dataStart+compressedSize;}return entries;}
const table:Table={title:"Kassenbuch",subtitle:"Synthetic ledger",columns:[{key:"number",header:"Buchungsnummer",width:2},{key:"title",header:"Haushaltstitel",width:2},{key:"amount",header:"Betrag (€)",money:true,width:2},{key:"date",header:"Anweisung erteilt",date:"datetime",width:3}],rows:[["KÖT-0001","1200",125.5,"2026-11-13T23:30:00Z"],["KÖT-0002","1300",0,"2026-11-14T12:00:00Z"],["KÖT-0003","1200",99.75,null]]};
test("PDF selection combines typed filters, stable multi-column sorting and complete criteria",()=>{
 const selected=selectExportTable(table,{...emptyExportSelection(),filters:[{column:"title",operator:"equals",value:"1200"},{column:"amount",operator:"gte",value:"90"}],sort:[{column:"amount",direction:"asc"}],columns:["number","amount"]});
 assert.deepEqual(selected.columns.map(c=>c.key),["number","amount"]);assert.deepEqual(selected.rows,[{cells:["KÖT-0003",99.75]},{cells:["KÖT-0001",125.5]}]);
 assert.match(selected.notes!.join(" "),/Haushaltstitel ist „1200“/);assert.match(selected.notes!.join(" "),/Betrag.*aufsteigend/);assert.match(selected.notes!.join(" "),/2 von 3/);
 const date=selectExportTable(table,{...emptyExportSelection(),filters:[{column:"date",operator:"equals",value:"2026-11-14"}]});assert.equal(date.rows.length,2,"datetime date filters use the German calendar day");
 assert.equal(selectExportTable(table,{...emptyExportSelection(),filters:[{column:"amount",operator:"equals",value:"0"}]}).rows.length,1);
 const last=selectExportTable(table,{...emptyExportSelection(),sort:[{column:"date",direction:"desc"}]}).rows.at(-1)!;assert.equal(Array.isArray(last)?last[0]:last.cells[0],"KÖT-0003");
});
test("invalid export criteria are rejected instead of silently broadening the export",()=>{
 for(const raw of ['{',JSON.stringify({unknown:true}),JSON.stringify({columns:[]}),JSON.stringify({filters:Array.from({length:11},()=>({column:"title",operator:"equals",value:"1200"}))})])assert.throws(()=>parseExportSelection(raw));
 for(const selection of [{...emptyExportSelection(),sort:[{column:"private",direction:"asc" as const}]},{...emptyExportSelection(),columns:["amount","amount"]},{...emptyExportSelection(),filters:[{column:"date",operator:"gte" as const,value:"2026-02-30"}]},{...emptyExportSelection(),filters:[{column:"amount",operator:"gte" as const,value:"invalid"}]}])assert.throws(()=>selectExportTable(table,selection));
});
test("complete Excel sorting retains section totals and keeps children with their parents",()=>{
 const grouped:Table={title:"Plan",columns:table.columns.slice(0,3),rows:[{cells:["","Einnahmen",100],style:"section"},{cells:["2","Parent B",70],style:"top"},{cells:["21","Child",70],style:"sub"},{cells:["1","Parent A",30],style:"top"},{cells:["","Summe",100],style:"total"}]};
 const sorted=sortCompleteExportTable(grouped,[{column:"number",direction:"asc"}]);assert.equal(sorted.rows.length,grouped.rows.length);assert.deepEqual(sorted.rows.map(row=>Array.isArray(row)?row[0]:row.cells[0]),["","1","2","21",""]);
 const selected=selectExportTable(grouped,{...emptyExportSelection(),filters:[{column:"title",operator:"contains",value:"Parent"}]});assert.equal(selected.rows.length,2);assert.match(selected.notes!.join(" "),/Gesamtsummen/);
});
test("Excel uses a fresh SHA-512 sheet verifier, readable ZIP, filter permissions and typed dates",async()=>{
 const first=unzip(await tablesToXlsx([table],{protect:true})),second=unzip(await tablesToXlsx([table],{protect:true}));
 const sheet=first.get("xl/worksheets/sheet1.xml")!;
 assert.match(sheet,/<sheetProtection[^>]*sheet="1"/);assert.match(sheet,/algorithmName="SHA-512"/);assert.match(sheet,/spinCount="100000"/);assert.match(sheet,/sort="0" autoFilter="0"/);assert.match(sheet,/<autoFilter ref="A1:D4"/);assert.match(sheet,/state="frozen"/);
 assert.notEqual(sheet.match(/hashValue="([^"]+)"/)![1],second.get("xl/worksheets/sheet1.xml")!.match(/hashValue="([^"]+)"/)![1]);
 assert.match(first.get("xl/workbook.xml")!,/lockStructure="1"/);assert.ok(!first.has("EncryptionInfo"));assert.match(sheet,/<c r="C2" s="2"><v>125.5<\/v>/);assert.match(sheet,/<c r="D2" s="10"><v>[\d.]+<\/v>/);assert.ok(!sheet.includes("2026-11-13T"));
 const malicious=unzip(await tablesToXlsx([{...table,rows:[["=1+1","A&B\u0000",0,null]]}],{protect:true})).get("xl/worksheets/sheet1.xml")!;assert.match(malicious,/t="inlineStr"[^>]*><is><t[^>]*>=1\+1/);assert.match(malicious,/A&amp;B/);assert.ok(!malicious.includes('\u0000'));
});
test("XLSX remains complete and rejects PDF filters; PDF includes exact selected scope",async()=>{
 const selection={...emptyExportSelection(),filters:[{column:"title",operator:"equals" as const,value:"1200"}],sort:[{column:"amount",direction:"desc" as const}]};
 const denied=await exportDownload(new Request('http://localhost/export?format=xlsx&options='+encodeURIComponent(JSON.stringify(selection))),table,"Test");assert.equal(denied.status,400);
 const full=await exportDownload(new Request('http://localhost/export?format=xlsx&options='+encodeURIComponent(JSON.stringify({sort:selection.sort}))),table,"Test");assert.equal(full.status,200);assert.equal(full.headers.get("cache-control"),"private, no-store");assert.match(unzip(new Uint8Array(await full.arrayBuffer())).get("xl/worksheets/sheet1.xml")!,/KÖT-0002/);
 const response=await exportDownload(new Request('http://localhost/export?format=pdf&options='+encodeURIComponent(JSON.stringify(selection))),table,"Test");assert.equal(response.status,200);const text=await extractPdfText(new Uint8Array(await response.arrayBuffer()));assert.match(text.text,/Filter:/);assert.match(text.text,/Sortierung:/);assert.match(text.text,/KÖT-0001/);assert.ok(!text.text.includes("KÖT-0002"));
});
test("PDF wraps long contents and repeats scope and column headers on every page",async()=>{
 const big:Table={title:"Langer Auszug",subtitle:"Synthetic test",columns:[{header:"Nummer",width:2},{header:"Verwendungszweck",width:10}],rows:Array.from({length:80},(_,index)=>[`ENTRY-${index}`,`Vollständiger langer Verwendungszweck ${"Wort ".repeat(80)} Ende-${index}`])};
 const selected=selectExportTable(big,emptyExportSelection());const bytes=await tablesToPdf("Test",[selected]);assert.ok((await PDFDocument.load(bytes)).getPageCount()>1);const extracted=await extractPdfText(bytes,1,10);assert.ok(extracted.totalPages>1);for(const page of extracted.pages){assert.match(page.text,/Filter:/);assert.match(page.text,/Verwendungszweck/);assert.match(page.text,/Seite/);}assert.match(extracted.text,/Ende-0/);
});

test("PDF uses standard paper sizes and keeps normal multi-line entries on one page",async()=>{
 for(const [count,expected] of [[3,[595.28,841.89]],[5,[841.89,595.28]],[11,[1190.55,841.89]]] as const){
  const bytes=await tablesToPdf("Paper",[{title:"Paper",columns:Array.from({length:count},(_,i)=>({header:`Spalte ${i}`})),rows:[]}]);
  const page=(await PDFDocument.load(bytes)).getPage(0);assert.deepEqual([page.getWidth(),page.getHeight()],expected);
 }
 const rows=Array.from({length:35},(_,index)=>[`ROW-${index}`,`Text ${"Vollständig ".repeat(16)} END-${index}`]);
 const bytes=await tablesToPdf("Rows",[selectExportTable({title:"Rows",exportedAt:"14.11.2026, 18:00",columns:[{header:"Nummer",width:2},{header:"Text",width:6}],rows},emptyExportSelection())]);
 const extracted=await extractPdfText(bytes,1,10);
 for(let i=0;i<rows.length;i++)assert.ok(extracted.pages.some(page=>page.text.includes(`ROW-${i}`)&&page.text.includes(`END-${i}`)),`row ${i} stays together`);
 for(const page of extracted.pages){assert.match(page.text,/EXPORTAUSWAHL/);assert.match(page.text,/Erstellt am/);assert.match(page.text,/Filter:/);}
});

test("long prose in narrow PDF columns is fully retained below its own entry",async()=>{
 const value=`START ${"Ausführlicher Verwendungszweck ".repeat(30)} COMPLETE-END`;
 const columns=[{header:"Buchungsnummer",width:2},{header:"IBAN",key:"iban",width:2},{header:"Kontoinhaber",width:2},{header:"Verwendungszweck",width:2},{header:"Haushaltstitel",width:2},{header:"Betrag (€)",money:true,width:2},{header:"Bank",width:2}];
 const bytes=await tablesToPdf("Details",[{title:"Details",columns,rows:[["B-0001","DE89370400440532013000","Alex Beispiel",value,"1200",125.5,"Bank"]]}]);
 const text=(await extractPdfText(bytes,1,10)).text;assert.match(text,/Volltext unten/);assert.match(text,/COMPLETE-END/);assert.match(text,/DE89 3704/);
 assert.equal((text.replace(/\s+/g," ").match(/Ausführlicher Verwendungszweck/g)||[]).length,30);
});
