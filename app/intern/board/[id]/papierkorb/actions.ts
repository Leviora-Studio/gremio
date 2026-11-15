// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { requireBoardAccess, canEditBoard } from "@/lib/authz";
import { restoreBoardCard } from "@/lib/card-trash";
import { restoreBoardAttachment } from "@/lib/attachment-trash";
import { purgeTrashEntry, TrashError } from "@/lib/trash";
import { revalidatePath } from "next/cache";
function refresh(boardId: number) {
  revalidatePath(`/intern/board/${boardId}`);
  revalidatePath(`/intern/board/${boardId}/papierkorb`);
  revalidatePath("/intern/card/[id]", "page");
  revalidatePath("/status/[token]", "page");
}
export async function restoreFileAction(boardId: number, entryId: number, confirmation?: string) {
  const { user, board } = await requireBoardAccess(boardId);
  if(!await canEditBoard(user,board))return {error:"Kein Schreibzugriff auf dieses Board."};
  try { await restoreBoardAttachment(user, boardId, entryId, confirmation); }
  catch (error) { return { error: error instanceof TrashError ? error.message : "Wiederherstellung nicht möglich. Bitte neu laden und den Dateibereich der Karte prüfen." }; }
  refresh(boardId); return {};
}
export async function purgeFileAction(boardId: number, entryId: number, confirmation?: string) {
  const { user, board } = await requireBoardAccess(boardId);
  if(!await canEditBoard(user,board))return {error:"Kein Schreibzugriff auf dieses Board."};
  try { await purgeTrashEntry(user, entryId, confirmation, new Date(), boardId,"attachment"); }
  catch (error) { refresh(boardId); return { error: error instanceof TrashError ? error.message : "Die endgültige Löschung ist noch nicht abgeschlossen. Bitte erneut versuchen." }; }
  refresh(boardId); return {};
}

export async function restoreCardAction(boardId:number,entryId:number,confirmation?:string){
  const {user,board}=await requireBoardAccess(boardId);if(!await canEditBoard(user,board))return {error:"Kein Schreibzugriff auf dieses Board."};
  try{await restoreBoardCard(user,boardId,entryId,confirmation);}catch(error){return {error:error instanceof TrashError?error.message:"Wiederherstellung nicht möglich. Bitte neu laden."};}
  refresh(boardId);return {};
}
export async function purgeCardAction(boardId:number,entryId:number,confirmation?:string){
  const {user,board}=await requireBoardAccess(boardId);if(!await canEditBoard(user,board))return {error:"Kein Schreibzugriff auf dieses Board."};
  try{await purgeTrashEntry(user,entryId,confirmation,new Date(),boardId,"card");}catch(error){refresh(boardId);return {error:error instanceof TrashError?error.message:"Endgültige Löschung derzeit nicht möglich."};}
  refresh(boardId);return {};
}
