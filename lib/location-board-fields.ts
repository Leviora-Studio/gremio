// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardCardFields, boards, locations, feedbackAreas } from "@/lib/db/schema";
import { APPLICATION_REQUIRED_CARD_FIELD_KEYS, FEEDBACK_REQUIRED_CARD_FIELD_KEYS, INVENTORY_REQUIRED_CARD_FIELD_KEYS, CARD_FIELD_LABELS, type CardFieldKey } from "@/lib/constants";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Routing and field settings serialize on the same board, including inactive routes. */
export async function lockLocationBoard(tx: Transaction, boardId: number) {
 await tx.select({id:boards.id}).from(boards).where(eq(boards.id,boardId)).for("update");
}
export async function getLocationRequiredFieldKeys(boardId:number,reader:Transaction|typeof db=db):Promise<readonly string[]>{
 const [location]=await reader.select({id:locations.id}).from(locations).where(eq(locations.targetBoardId,boardId)).limit(1);
 const [feedback]=await reader.select({id:feedbackAreas.id}).from(feedbackAreas).where(eq(feedbackAreas.targetBoardId,boardId)).limit(1);
 const [board]=await reader.select({inventoryBoardId:boards.inventoryBoardId}).from(boards).where(eq(boards.id,boardId));
 return [...new Set([...(location?APPLICATION_REQUIRED_CARD_FIELD_KEYS:[]),...(feedback?FEEDBACK_REQUIRED_CARD_FIELD_KEYS:[]),...(board?.inventoryBoardId!=null?INVENTORY_REQUIRED_CARD_FIELD_KEYS:[])])];
}
export async function missingBoardFields(boardId:number,required:readonly string[],reader:Transaction|typeof db=db){
 const fields=await reader.select({key:boardCardFields.fieldKey}).from(boardCardFields).where(and(eq(boardCardFields.boardId,boardId),eq(boardCardFields.visible,true)));
 return required.filter(key=>!fields.some(field=>field.key===key));
}
export function missingBoardFieldsMessage(keys:readonly string[]){
 return `Bitte zuerst folgende Pflichtfelder in den Boardeinstellungen aktivieren: ${keys.map(key=>CARD_FIELD_LABELS[key as CardFieldKey]??key).join(", ")}.`;
}
