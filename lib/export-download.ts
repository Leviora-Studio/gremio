// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import type {Table} from "@/lib/export";
import {tablesToPdf,tablesToXlsx} from "@/lib/export";
import {ExportSelectionError,parseExportSelection,selectExportTable,sortCompleteExportTable} from "@/lib/export-selection";
import {formatDateTime} from "@/lib/dates";
export async function exportDownload(request:Request,table:Table,name:string):Promise<Response>{
 try{
  const url=new URL(request.url),format=url.searchParams.get("format")??"xlsx";
  if(!["pdf","xlsx"].includes(format))return Response.json({error:"Bitte Excel oder PDF als Exportformat auswählen."},{status:400});
  const selection=parseExportSelection(url.searchParams.get("options"));
  if(format==="xlsx"&&(selection.search||selection.filters.length||selection.columns))return Response.json({error:"Der Excel-Export enthält immer das vollständige Kassenbuch beziehungsweise die vollständige Finanzansicht."},{status:400});
  const snapshot={...table,exportedAt:formatDateTime(new Date())};
  const bytes=format==="pdf"?await tablesToPdf(`${name} - ${table.title}`,[selectExportTable(snapshot,selection)]):await tablesToXlsx([sortCompleteExportTable(snapshot,selection.sort)],{protect:true});
  const filename=`${name.normalize("NFKD").replace(/[^\w\s-]/g,"").trim().replace(/\s+/g,"-").slice(0,80)||"Gremio-Export"}_${new Date().toISOString().slice(0,10)}.${format}`;
  return new Response(Buffer.from(bytes),{headers:{"Content-Type":format==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,"Cache-Control":"private, no-store","Vary":"Cookie","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
 }catch(error){return Response.json({error:error instanceof ExportSelectionError?error.message:"Der Export konnte nicht erstellt werden. Bitte die Auswahl prüfen."},{status:error instanceof ExportSelectionError?400:500});}
}
