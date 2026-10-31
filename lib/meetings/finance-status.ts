// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {and,eq,isNull,sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {boards,boardStatuses,boardCardFields,cards,cardActivity,meetingAreas,meetingTopics,type User} from "@/lib/db/schema";
import {canAccessBoard} from "@/lib/authz";
import {MeetingError} from "./access";
import {berlinInputDate} from "./validation";
import {doneSinceForStatus} from "@/lib/done-archive";
import {maybeSetTriggerDates} from "@/lib/instruction";
import {applyStatusTriggerAssignments} from "@/lib/trigger-assignments";
import {maybeArchive} from "@/lib/archive";
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export type FinancialMove={cardId:number;targetId:number;moved:boolean};
/** Existing financial occurrences use the same card side effects when planned again. */
export async function scheduleFinancialCard(tx:Tx,user:User,cardId:number,meeting:{areaId:number;startsAt:Date|null},parentId?:number|null):Promise<FinancialMove>{
 if(parentId!=null){const [parent]=await tx.select().from(meetingTopics).where(eq(meetingTopics.id,parentId));if(!parent?.isFinanceTopic||parent.transferred||!["scheduled","treated"].includes(parent.state))throw new MeetingError("Bitte zuerst den Finanzanträge-Haupt-TOP einplanen.");}
 if(!meeting.startsAt)throw new MeetingError("Bitte zuerst das Sitzungsdatum festlegen.");
 const [area]=await tx.select().from(meetingAreas).where(eq(meetingAreas.id,meeting.areaId)).for("share");
 const [board]=area?.financeBoardId==null?[]:await tx.select().from(boards).where(eq(boards.id,area.financeBoardId)).for("share");
 if(!board||board.inventoryBoardId!=null||!await canAccessBoard(user,board,"write"))throw new MeetingError("Zum Einplanen ist Schreibzugriff auf das verknüpfte Antragsboard erforderlich.");
 const [target]=area.financeTargetStatusId==null?[]:await tx.select().from(boardStatuses).where(and(eq(boardStatuses.id,area.financeTargetStatusId),eq(boardStatuses.boardId,board.id))).for("share");
 if(!target)throw new MeetingError("Bitte in den Bereichseinstellungen eine gültige Zielspalte hinterlegen.");
 const [card]=await tx.select().from(cards).where(and(eq(cards.id,cardId),eq(cards.boardId,board.id),isNull(cards.archivedAt))).for("update");
 if(!card)throw new MeetingError("Die Finanzantragskarte ist nicht mehr im verknüpften Board verfügbar.");
 const moved=card.statusId!==target.id;
 const [last]=moved?await tx.select({position:sql<number>`coalesce(max(${cards.position}),-1)+1`}).from(cards).where(and(eq(cards.boardId,board.id),eq(cards.statusId,target.id),isNull(cards.archivedAt))):[];
 const [field]=await tx.select({visible:boardCardFields.visible}).from(boardCardFields).where(and(eq(boardCardFields.boardId,board.id),eq(boardCardFields.fieldKey,"meeting")));
 await tx.update(cards).set({...(moved?{statusId:target.id,position:last.position,resubmittedAt:null,doneSince:doneSinceForStatus(board.doneStatusId,target.id,card.doneSince)}:{}),...(field?.visible?{meeting:berlinInputDate(meeting.startsAt).slice(0,10)}:{}),updatedAt:new Date()}).where(eq(cards.id,card.id));
 if(moved){const [source]=await tx.select({name:boardStatuses.name}).from(boardStatuses).where(eq(boardStatuses.id,card.statusId));await tx.insert(cardActivity).values({cardId:card.id,userId:user.id,type:"status",detail:`${source?.name??"?"} → ${target.name} (Sitzungsplanung)`});}
 return {cardId:card.id,targetId:target.id,moved};
}
export async function finishFinancialMove(move:FinancialMove|undefined){if(move?.moved){await maybeSetTriggerDates(move.cardId,move.targetId);await applyStatusTriggerAssignments(move.cardId,move.targetId);await maybeArchive(move.cardId);}}
