// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import {createHash,randomUUID} from "node:crypto";
import {mkdir,open,link,unlink,readFile} from "node:fs/promises";
import {dirname} from "node:path";
import {and,eq,sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {attachments,boards,cards,cashbookEntries,type User} from "@/lib/db/schema";
import {absPath} from "@/lib/attachments";
import {canAccessBoard} from "@/lib/authz";
import {getVisibleFieldKeys} from "@/lib/board-fields";
import {isCardAttachmentVisible} from "@/lib/card-attachment-visibility";
import type {CashbookFile,CashbookPayment} from "@/lib/cashbook-types";
import type {Cashbook} from "./access";
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");

/** Publish freshly written bytes atomically; never link to or overwrite a board file. */
async function publishCopy(path:string,bytes:Buffer,sha256:string){
 const target=absPath(path);await mkdir(dirname(target),{recursive:true});
 const temporary=`${target}.${randomUUID()}.tmp`;
 try{
  const file=await open(temporary,"wx",0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  try{await link(temporary,target);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
  if(digest(await readFile(target))!==sha256)throw new Error("Die vorhandene Kassenbuchkopie hat eine abweichende Prüfsumme. Sie wurde nicht überschrieben.");
 }finally{await unlink(temporary).catch(()=>{});}
}

async function copyAttachment(bookId:number,cardId:number,source:typeof attachments.$inferSelect,kind:"application"|"receipt"):Promise<CashbookFile>{
 // Existing snapshots remain usable even if the board's original is subsequently unavailable.
 const matches=await db.select({files:cashbookEntries.files}).from(cashbookEntries).where(trashAnd(activeRows.cashbookEntries, and(eq(cashbookEntries.cashbookId,bookId),sql`exists(select 1 from jsonb_array_elements(${cashbookEntries.files}) f where f->>'sourceAttachmentId'=${String(source.id)} and f->>'sourceCardId'=${String(cardId)})`))).limit(1);
 const existing=matches[0]?.files.find(f=>f.sourceAttachmentId===source.id&&f.sourceCardId===cardId&&f.kind===kind);
 if(existing){
  if(!existing.path.startsWith(`cashbooks/${bookId}/`))throw new Error("Die gespeicherte Datei liegt nicht im Kassenbuchbereich.");
  await verifyCashbookFiles([{...existing,obsolete:false}]);
  return {...existing,obsolete:false};
 }
 const bytes=await readFile(absPath(source.path)),sha256=digest(bytes);
 const path=`cashbooks/${bookId}/${kind==="application"?"applications":"receipts"}/${cardId}/${source.id}/${sha256}.pdf`;
 await publishCopy(path,bytes,sha256);
 return {id:`source-${source.id}-${sha256}`,filename:source.filename,path,mime:source.mime,sha256,kind,sourceCardId:cardId,sourceAttachmentId:source.id};
}

/** Called before acquiring database locks. All files are physical copies in the book's own storage. */
export async function snapshotCashbookSources(user:User,book:Cashbook,data:CashbookPayment):Promise<CashbookFile[]>{
 if(data.business)return [];
 const [card]=data.cardId==null?[]:await db.select().from(cards).where(trashAnd(activeRows.cards, eq(cards.id,data.cardId)));
 const [board]=card?await db.select().from(boards).where(trashAnd(activeRows.boards, eq(boards.id,card.boardId))):[];
 if(!card?.lockedAt||!board?.isApplicationBoard||!book.config.sourceBoardIds.includes(board.id)||!await canAccessBoard(user,board))throw new Error("Der ausgewählte Antrag ist nicht zum Kopieren freigegeben.");
 const visible=await getVisibleFieldKeys(board.id);
 const sourceFiles=(await db.select().from(attachments).where(trashAnd(activeRows.attachments, eq(attachments.cardId,card.id)))).filter(file=>isCardAttachmentVisible(file,visible));
 const application=sourceFiles.find(file=>file.kind==="finance_request"&&file.mime==="application/pdf");
 if(!application)throw new Error("Für diesen Antrag ist kein freigegebenes Antrags-PDF vorhanden. Für die Buchung wird das PDF aus dem Feld Finanzantrag benötigt.");
 const receipts=data.receiptIds.map(id=>sourceFiles.find(file=>file.id===id&&file.uploadPurpose==="receipt"&&file.mime==="application/pdf"));
 if(!receipts.length||receipts.some(file=>!file))throw new Error("Bitte freigegebene Quittungen dieses Antrags auswählen.");
 const snapshots=[await copyAttachment(book.id,card.id,application,"application")];
 for(const receipt of receipts)snapshots.push(await copyAttachment(book.id,card.id,receipt!,"receipt"));
 return snapshots;
}

/** Retain earlier versions without duplicating the same shared snapshot in one entry. */
export function mergeSourceSnapshots(existing:CashbookFile[],snapshots:CashbookFile[],preserveBusinessReceipts:boolean):CashbookFile[]{
 const selected=new Map(snapshots.map(file=>[file.id,file]));
 const result=existing.map(file=>{const active=selected.get(file.id);if(active){selected.delete(file.id);return {...active,obsolete:false};}return preserveBusinessReceipts&&file.kind==="receipt"&&!file.sourceAttachmentId?file:{...file,obsolete:true};});
 return [...result,...selected.values()];
}

export async function verifyCashbookFiles(files:CashbookFile[]){
 for(const file of files.filter(f=>!f.obsolete)){
  let bytes:Buffer;
  try{bytes=await readFile(absPath(file.path));}catch{throw new Error(`Die Kassenbuchdatei „${file.filename}“ ist nicht verfügbar.`);}
  if(digest(bytes)!==file.sha256)throw new Error(`Die Kassenbuchdatei „${file.filename}“ stimmt nicht mit der gespeicherten Prüfsumme überein.`);
 }
}
