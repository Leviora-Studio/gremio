// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canManageBoard, getBoardById } from "@/lib/authz";
import { canManageInventoryBoard, getInventoryBoardById } from "@/lib/inventory";
import { db } from "@/lib/db";
import { boardEmailRules, boardStatuses } from "@/lib/db/schema";
import { parseEmailRecipients } from "@/lib/email-validation";

export async function saveBoardEmailRuleAction(boardId:number,statusId:number,_previous:{error?:string;success?:string},form:FormData):Promise<{error?:string;success?:string}> {
  const user=await requireUser();const board=await getBoardById(boardId);
  if(!board)notFound();
  if(board.inventoryBoardId!=null){const inventory=await getInventoryBoardById(board.inventoryBoardId);if(!inventory||inventory.loanBoardId!==board.id||!canManageInventoryBoard(user,inventory))notFound();}
  else if(!canManageBoard(user,board))notFound();
  if(!Number.isSafeInteger(statusId)||statusId<1||statusId>2147483647)return {error:"Ungültige Spalte."};
  const [status]=await db.select({id:boardStatuses.id}).from(boardStatuses).where(and(eq(boardStatuses.id,statusId),eq(boardStatuses.boardId,board.id)));
  if(!status)return {error:"Die Spalte gehört nicht zu diesem Board."};
  const enabled=form.get("enabled")==="on";const raw=String(form.get("recipients")??"");
  if(raw.length>15000)return {error:"Zu viele Empfangsadressen."};
  const recipients=raw.trim()?parseEmailRecipients(raw):[];
  if(recipients===null||(enabled&&!recipients.length))return {error:"Bitte 1 bis 50 gültige E-Mail-Adressen angeben."};
  await db.insert(boardEmailRules).values({statusId,enabled,recipients}).onConflictDoUpdate({target:boardEmailRules.statusId,set:{enabled,recipients}});
  revalidatePath(`/intern/board/${boardId}/einstellungen`);
  if(board.inventoryBoardId!=null)revalidatePath(`/intern/inventar/${board.inventoryBoardId}/einstellungen`);
  return {success:"E-Mail-Regel gespeichert."};
}
