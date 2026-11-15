// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

export function documentHasSignatures(doc: PDFDocument): boolean {
  return doc.context.enumerateIndirectObjects().some(([, value]) => value instanceof PDFDict
    && (value.get(PDFName.of("Type")) === PDFName.of("Sig") || value.has(PDFName.of("ByteRange")))
    && value.has(PDFName.of("Contents")));
}

/** Append changed objects without rewriting bytes covered by existing signatures. */
export async function appendPdfRevision(pdf: Buffer, mutate: (doc: PDFDocument) => Promise<void>): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  if (doc.isEncrypted) throw new Error("Verschlüsselte PDFs können nicht inkrementell signiert werden.");
  const before = new Map(doc.context.enumerateIndirectObjects().map(([ref, value]) => [ref.toString(), value.toString()]));
  const signedObjects = new Set(doc.context.enumerateIndirectObjects().filter(([, value]) =>
    value instanceof PDFDict && value.has(PDFName.of("ByteRange")) && value.has(PDFName.of("Contents"))).map(([ref]) => ref.toString()));
  const previous = [...pdf.toString("latin1").matchAll(/startxref\s+(\d+)\s+%%EOF/g)].at(-1);
  if (!previous) throw new Error("Die PDF-Querverweistabelle ist nicht lesbar.");
  await mutate(doc);
  await doc.flush();
  const chunks: Buffer[]=[pdf,Buffer.from("\n")];let offset=pdf.length+1;
  const xref:{number:number;generation:number;offset:number}[]=[];
  for (const [ref,value] of doc.context.enumerateIndirectObjects()) {
    if(before.get(ref.toString())===value.toString())continue;
    if(signedObjects.has(ref.toString()))throw new Error("Vorhandene Signaturen dürfen nicht neu geschrieben werden.");
    const prefix=Buffer.from(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
    const data=Buffer.alloc(value.sizeInBytes());value.copyBytesInto(data,0);
    const suffix=Buffer.from("\nendobj\n");xref.push({number:ref.objectNumber,generation:ref.generationNumber,offset});chunks.push(prefix,data,suffix);offset+=prefix.length+data.length+suffix.length;
  }
  if(!xref.length)return pdf;
  const start=offset;
  let table="xref\n";
  for(const ref of xref.sort((a,b)=>a.number-b.number))table+=`${ref.number} 1\n${String(ref.offset).padStart(10,"0")} ${String(ref.generation).padStart(5,"0")} n \n`;
  const info=doc.context.trailerInfo;
  table+=`trailer\n<< /Size ${doc.context.largestObjectNumber+1} /Root ${info.Root} /Prev ${previous[1]}${info.Info?` /Info ${info.Info}`:""}${info.ID?` /ID ${info.ID}`:""} >>\nstartxref\n${start}\n%%EOF\n`;
  chunks.push(Buffer.from(table));
  return Buffer.concat(chunks);
}
