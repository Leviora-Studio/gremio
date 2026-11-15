// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardCardFields, boards, locations, feedbackAreas } from "@/lib/db/schema";
import { APPLICATION_REQUIRED_CARD_FIELD_KEYS, FEEDBACK_REQUIRED_CARD_FIELD_KEYS, INVENTORY_REQUIRED_CARD_FIELD_KEYS, CARD_FIELD_LABELS, type CardFieldKey } from "@/lib/constants";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Routing and field settings serialize on the same board, including inactive routes. */
export async function lockLocationBoard(tx: Transaction, boardId: number) {
 await tx.select({id:boards.id}).from(boards).where(trashAnd(activeRows.boards, eq(boards.id,boardId))).for("update");
}
export async function getLocationRequiredFieldKeys(boardId:number,reader:Transaction|typeof db=db):Promise<readonly string[]>{
 const linkedLocations=await reader.select({id:locations.id,module:locations.module}).from(locations).where(trashAnd(activeRows.locations, eq(locations.targetBoardId,boardId)));
 const [feedback]=await reader.select({id:feedbackAreas.id}).from(feedbackAreas).where(trashAnd(activeRows.feedbackAreas, eq(feedbackAreas.targetBoardId,boardId))).limit(1);
 const [board]=await reader.select({inventoryBoardId:boards.inventoryBoardId,attachmentFields:boards.attachmentFields}).from(boards).where(trashAnd(activeRows.boards, eq(boards.id,boardId)));
 return [...new Set([...linkedLocations.flatMap(location=>APPLICATION_REQUIRED_CARD_FIELD_KEYS.filter(key=>location.module!=="finance"||!["finance_request","student_card"].includes(key)||board?.attachmentFields==null||board.attachmentFields.includes(key))),...(feedback?FEEDBACK_REQUIRED_CARD_FIELD_KEYS:[]),...(board?.inventoryBoardId!=null?INVENTORY_REQUIRED_CARD_FIELD_KEYS:[])])];
}
export async function missingBoardFields(boardId:number,required:readonly string[],reader:Transaction|typeof db=db){
 const fields=await reader.select({key:boardCardFields.fieldKey}).from(boardCardFields).where(and(eq(boardCardFields.boardId,boardId),eq(boardCardFields.visible,true)));
 return required.filter(key=>!fields.some(field=>field.key===key));
}
export function missingBoardFieldsMessage(keys:readonly string[]){
 return `Bitte zuerst folgende Pflichtfelder in den Boardeinstellungen aktivieren: ${keys.map(key=>CARD_FIELD_LABELS[key as CardFieldKey]??key).join(", ")}.`;
}
