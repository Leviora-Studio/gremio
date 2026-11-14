// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { z } from "zod";
import type { Cell, Row, Table } from "@/lib/export";
import { parseEuroToCents } from "@/lib/money";

export type ExportColumn = { id:string; label:string; type:"text"|"number"|"date" };
export const exportSelectionSchema=z.object({
 search:z.string().trim().max(200).default(""),
 filters:z.array(z.object({column:z.string().max(80),operator:z.enum(["contains","equals","notEquals","gte","lte","empty","notEmpty"]),value:z.string().trim().max(200).default("")}).strict()).max(10).default([]),
 sort:z.array(z.object({column:z.string().max(80),direction:z.enum(["asc","desc"])}).strict()).max(3).default([]),
 columns:z.array(z.string().max(80)).min(1).max(100).optional(),
}).strict();
export type ExportSelection=z.infer<typeof exportSelectionSchema>;
export const emptyExportSelection=():ExportSelection=>({search:"",filters:[],sort:[]});
export const exportColumns=(table:Table):ExportColumn[]=>table.columns.map((column,index)=>({id:column.key??`c${index}`,label:column.header,type:column.money?"number":column.date?"date":"text"}));
const norm=(row:Row)=>Array.isArray(row)?{cells:row}:row;
const text=(value:Cell|undefined)=>value==null?"":String(value);
const canonical=(value:string)=>value.normalize("NFKC").toLocaleLowerCase("de-DE");
const operators:Record<string,string>={contains:"enthält",equals:"ist",notEquals:"ist nicht",gte:"ab / mindestens",lte:"bis / höchstens",empty:"ist leer",notEmpty:"ist ausgefüllt"};
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;}
function dateDay(value:Cell|undefined):string{
 if(value==null||value==="")return "";
 const raw=String(value);if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
 const date=new Date(raw);if(Number.isNaN(date.getTime()))return "";
 return date.toLocaleDateString("en-CA",{timeZone:"Europe/Berlin"});
}
export class ExportSelectionError extends Error {}
export function parseExportSelection(raw:string|null):ExportSelection{
 if(raw==null)return emptyExportSelection();
 if(raw.length>16000)throw new ExportSelectionError("Die Exportauswahl ist zu umfangreich.");
 try{return exportSelectionSchema.parse(JSON.parse(raw));}catch{throw new ExportSelectionError("Bitte Filter und Sortierung prüfen.");}
}
export function selectExportTable(table:Table,selection:ExportSelection):Table{
 const columns=exportColumns(table),indexOf=(id:string)=>columns.findIndex(column=>column.id===id);
 const ids=[...selection.filters.map(filter=>filter.column),...selection.sort.map(sort=>sort.column),...(selection.columns??[])];
 if(ids.some(id=>indexOf(id)<0)||new Set(selection.columns??[]).size!==(selection.columns?.length??0)||new Set(selection.sort.map(sort=>sort.column)).size!==selection.sort.length)throw new ExportSelectionError("Die Exportauswahl enthält ungültige oder doppelte Spalten.");
 const predicates=selection.filters.map(filter=>{
  const index=indexOf(filter.column),column=columns[index];
  if(["empty","notEmpty"].includes(filter.operator))return (cells:Cell[])=>filter.operator==="empty"?text(cells[index]).trim()==="":text(cells[index]).trim()!=="";
  if(!filter.value)throw new ExportSelectionError(`Bitte einen Filterwert für „${column.label}“ eingeben.`);
  if(column.type==="number"){
   if(!["equals","notEquals","gte","lte"].includes(filter.operator))throw new ExportSelectionError("Ungültiger Betragsfilter.");
   const unsigned=parseEuroToCents(filter.value.replace(/^-/,""));const cents=unsigned==null?null:filter.value.startsWith("-")?-unsigned:unsigned;if(cents==null)throw new ExportSelectionError("Bitte einen gültigen Geldbetrag für den Filter eingeben.");
   return (cells:Cell[])=>{const cell=cells[index];if(typeof cell!=="number")return false;const amount=Math.round(cell*100);return filter.operator==="gte"?amount>=cents:filter.operator==="lte"?amount<=cents:filter.operator==="notEquals"?amount!==cents:amount===cents;};
  }
  if(column.type==="date"){
   if(!["equals","notEquals","gte","lte"].includes(filter.operator)||!validDate(filter.value))throw new ExportSelectionError("Bitte ein gültiges Datum für den Filter auswählen.");
   return (cells:Cell[])=>{const value=dateDay(cells[index]);return !!value&&(filter.operator==="gte"?value>=filter.value:filter.operator==="lte"?value<=filter.value:filter.operator==="notEquals"?value!==filter.value:value===filter.value);};
  }
  if(!["contains","equals","notEquals"].includes(filter.operator))throw new ExportSelectionError("Ungültiger Textfilter.");
  return (cells:Cell[])=>{const a=canonical(text(cells[index])),b=canonical(filter.value);return filter.operator==="contains"?a.includes(b):filter.operator==="notEquals"?a!==b:a===b;};
 });
 const searched=canonical(selection.search),changedRows=!!searched||predicates.length>0||selection.sort.length>0;
 const candidates=table.rows.map(norm).filter(row=>row.style!=="section"&&row.style!=="total");
 let rows=changedRows?candidates.filter(row=>(!searched||row.cells.some((cell,index)=>{const raw=canonical(text(cell));const formatted=typeof cell==="number"&&table.columns[index]?.money?cell.toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2}):table.columns[index]?.date&&cell?new Date(String(cell)).toLocaleDateString("de-DE",{timeZone:"Europe/Berlin"}):"";return raw.includes(searched)||canonical(formatted).includes(searched);}))&&predicates.every(predicate=>predicate(row.cells))):table.rows.map(norm);
 if(selection.sort.length)rows=[...rows].sort((a,b)=>{
  for(const sort of selection.sort){const index=indexOf(sort.column),x=a.cells[index],y=b.cells[index];const emptyX=x==null||x==="",emptyY=y==null||y==="";if(emptyX||emptyY){if(emptyX!==emptyY)return emptyX?1:-1;continue;}
   const comparison=typeof x==="number"&&typeof y==="number"?x-y:table.columns[index].date?Date.parse(String(x))-Date.parse(String(y)):String(x).localeCompare(String(y),"de",{numeric:true});if(comparison)return sort.direction==="asc"?comparison:-comparison;
  }return 0;
 });
 const selected=selection.columns?.map(indexOf)??columns.map((_,index)=>index);
 const filters=[...(selection.search?[`Suchtext enthält „${selection.search}“`]:[]),...selection.filters.map(filter=>`${columns[indexOf(filter.column)].label} ${operators[filter.operator]}${["empty","notEmpty"].includes(filter.operator)?"":` „${filter.value}“`}`)];
 const notes=[...(table.notes??[]),`Filter: ${filters.length?filters.join("; "):"Keine – alle Einträge"}`,`Sortierung: ${selection.sort.length?selection.sort.map(sort=>`${columns[indexOf(sort.column)].label} ${sort.direction==="asc"?"aufsteigend":"absteigend"}`).join(", "):"Originalreihenfolge"}`,`Enthaltene Datenzeilen: ${changedRows?rows.length:candidates.length} von ${candidates.length}`,`Spalten: ${selected.map(index=>columns[index].label).join(", ")}`];
 if(changedRows&&candidates.length!==table.rows.length)notes.push("Abschnitts- und Gesamtsummen werden für diese Auswahl nicht mitgeführt.");
 return {...table,notes,columns:selected.map(index=>table.columns[index]),rows:rows.map(row=>({cells:selected.map(index=>row.cells[index]??null),...(changedRows?{}:{style:row.style})}))};
}

/** Sort a complete workbook without removing totals or separating child positions. */
export function sortCompleteExportTable(table:Table,sort:ExportSelection["sort"]):Table{
 if(!sort.length)return table;
 // Reuse the same validation as PDF selection before resolving indices.
 selectExportTable({...table,rows:[]},{...emptyExportSelection(),sort});
 const columns=exportColumns(table);
 const compare=(a:Row,b:Row)=>{
  const x=norm(a).cells,y=norm(b).cells;
  for(const rule of sort){const index=columns.findIndex(column=>column.id===rule.column),left=x[index],right=y[index];const emptyLeft=left==null||left==="",emptyRight=right==null||right==="";if(emptyLeft||emptyRight){if(emptyLeft!==emptyRight)return emptyLeft?1:-1;continue;}
   const value=typeof left==="number"&&typeof right==="number"?left-right:table.columns[index].date?Date.parse(String(left))-Date.parse(String(right)):String(left).localeCompare(String(right),"de",{numeric:true});if(value)return rule.direction==="asc"?value:-value;
  }return 0;
 };
 const result:Row[]=[],segment:Row[]=[];
 const flush=()=>{
  const groups:Row[][]=[];
  for(const row of segment){if(norm(row).style==="sub"&&groups.length&&norm(groups.at(-1)![0]).style==="top")groups.at(-1)!.push(row);else groups.push([row]);}
  groups.sort((a,b)=>compare(a[0],b[0]));
  for(const group of groups)result.push(group[0],...group.slice(1).sort(compare));
  segment.length=0;
 };
 for(const row of table.rows){const style=norm(row).style;if(style==="section"||style==="total"){flush();result.push(row);}else segment.push(row);}flush();
 return {...table,rows:result};
}
