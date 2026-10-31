// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { boards, boardStatuses, cards, meetingAreas, meetingTopics, meetingTopicCards, type User } from "@/lib/db/schema";
import { canAccessBoard, canManageBoard, getBoardById } from "@/lib/authz";
import { requireArea, requireTopic, MeetingError } from "./access";
import { touchMeeting } from "./service";
import { scheduleFinancialCard,finishFinancialMove } from "./finance-status";

export async function saveFinanceConfiguration(user:User,areaId:number,boardId:number|null,sourceIds:number[],targetId:number|null) {
  await requireArea(user,areaId,"manage");
  if(sourceIds.length>200||sourceIds.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(sourceIds).size!==sourceIds.length)throw new MeetingError("Ungültige Spaltenauswahl.");
  if(boardId!=null) {
    const board=await getBoardById(boardId);
    if(!board||board.inventoryBoardId!=null||!await canManageBoard(user,board))throw new MeetingError("Die Anbindung erfordert Verwaltungsrechte auf dem Antragsboard.");
    const statuses=await db.select({id:boardStatuses.id}).from(boardStatuses).where(eq(boardStatuses.boardId,boardId));
    if(targetId==null||![...sourceIds,targetId].every(id=>statuses.some(s=>s.id===id)))throw new MeetingError("Bitte gültige Quellspalten und eine Zielspalte des Antragsboards wählen.");
  }
  await db.update(meetingAreas).set({financeBoardId:boardId,financeSourceStatusIds:boardId==null?[]:sourceIds,financeTargetStatusId:boardId==null?null:targetId}).where(eq(meetingAreas.id,areaId));
}
export async function markFinanceTopic(user:User,topicId:number,enabled:boolean,revision:number) {
  const {topic,meeting}=await requireTopic(user,topicId,true);
  if(!meeting||topic.parentId!=null||topic.isFinanceItem)throw new MeetingError("Bitte einen Haupt-TOP dieser Sitzung auswählen.");
  if(enabled&&!["scheduled","treated"].includes(topic.state))throw new MeetingError("Bitte den Haupt-TOP zuerst einplanen.");
  await db.transaction(async tx=>{
    await touchMeeting(tx,meeting.id,revision);
    const rows=await tx.select().from(meetingTopics).where(eq(meetingTopics.meetingId,meeting.id));
    if(enabled&&rows.some(t=>t.isFinanceTopic&&!t.transferred&&t.id!==topicId))throw new MeetingError("Diese Sitzung hat bereits einen Finanzanträge-TOP. Bitte dort die Markierung zuerst entfernen.");
    if(!enabled&&rows.some(t=>t.parentId===topicId&&t.isFinanceItem))throw new MeetingError("Bitte zuerst die eingeplanten Finanzanträge aus diesem TOP entfernen.");
    await tx.update(meetingTopics).set({isFinanceTopic:enabled}).where(eq(meetingTopics.id,topicId));
  });
}
export async function financeCandidates(user:User,topicId:number) {
  const {topic,meeting}=await requireTopic(user,topicId,true);
  if(!meeting||!topic.isFinanceTopic)return [];
  const area=await requireArea(user,meeting.areaId);
  const board=area.financeBoardId==null?null:await getBoardById(area.financeBoardId);
  if(!board||!await canAccessBoard(user,board,"write"))return [];
  const existing=await db.select({id:meetingTopics.financeCardId}).from(meetingTopics).where(and(eq(meetingTopics.meetingId,meeting.id),eq(meetingTopics.transferred,false)));
  const excluded=existing.flatMap(t=>t.id==null?[]:[t.id]);
  return db.select({id:cards.id,title:cards.title,number:sql<string|null>`case when exists(select 1 from board_card_fields f where f.board_id=${board.id} and f.field_key='number' and f.visible) then ${cards.number} else null end`}).from(cards).where(and(eq(cards.boardId,board.id),isNull(cards.archivedAt),area.financeSourceStatusIds.length?inArray(cards.statusId,area.financeSourceStatusIds):undefined,excluded.length?notInArray(cards.id,excluded):undefined)).orderBy(asc(cards.position),asc(cards.id));
}
/** Meeting revision, duplicate check, TOP and card status/date are committed together. */
export async function planFinanceCard(user:User,topicId:number,cardId:number,revision:number) {
  const {topic,meeting}=await requireTopic(user,topicId,true);
  if(!meeting||!topic.isFinanceTopic||!["scheduled","treated"].includes(topic.state))throw new MeetingError("Bitte einen eingeplanten Finanzanträge-TOP wählen.");
  if(!meeting.startsAt)throw new MeetingError("Bitte zuerst das Sitzungsdatum festlegen.");
  const result=await db.transaction(async tx=>{
    await touchMeeting(tx,meeting.id,revision);
    const [parent]=await tx.select().from(meetingTopics).where(eq(meetingTopics.id,topicId));
    if(!parent?.isFinanceTopic||parent.parentId!=null||!["scheduled","treated"].includes(parent.state))throw new MeetingError("Der Finanzanträge-TOP wurde geändert. Bitte neu laden.");
    const [area]=await tx.select().from(meetingAreas).where(eq(meetingAreas.id,meeting.areaId)).for("share");
    const [board]=area?.financeBoardId==null?[]:await tx.select().from(boards).where(eq(boards.id,area.financeBoardId)).for("share");
    if(!board||board.inventoryBoardId!=null||!await canAccessBoard(user,board,"write"))throw new MeetingError("Zum Einplanen ist Schreibzugriff auf das Antragsboard erforderlich.");
    const [target]=area.financeTargetStatusId==null?[]:await tx.select().from(boardStatuses).where(and(eq(boardStatuses.id,area.financeTargetStatusId),eq(boardStatuses.boardId,board.id))).for("share");
    if(!target)throw new MeetingError("Bitte in den Bereichseinstellungen eine gültige Zielspalte hinterlegen.");
    const [card]=await tx.select().from(cards).where(and(eq(cards.id,cardId),eq(cards.boardId,board.id),isNull(cards.archivedAt))).for("update");
    if(!card||(area.financeSourceStatusIds.length&&!area.financeSourceStatusIds.includes(card.statusId)))throw new MeetingError("Diese Karte ist nicht aus einer freigegebenen Quellspalte verfügbar.");
    const [existing]=await tx.select().from(meetingTopics).where(and(eq(meetingTopics.meetingId,meeting.id),eq(meetingTopics.financeCardId,card.id),eq(meetingTopics.transferred,false)));
    if(existing)throw new MeetingError("Diese Karte ist in der Sitzung bereits eingeplant.");
    const [max]=await tx.select({position:sql<number>`coalesce(max(${meetingTopics.position}),-1)+1`}).from(meetingTopics).where(eq(meetingTopics.meetingId,meeting.id));
    const [created]=await tx.insert(meetingTopics).values({meetingId:meeting.id,parentId:topicId,title:"Finanzantrag",isFinanceItem:true,financeCardId:card.id,state:"scheduled",kind:"decision",createdBy:user.id,position:max.position}).returning({id:meetingTopics.id});
    await tx.insert(meetingTopicCards).values({topicId:created.id,cardId:card.id});
    const move=await scheduleFinancialCard(tx,user,card.id,meeting,topicId);
    return {id:created.id,...move};
  });
  await finishFinancialMove(result);
  return result.id;
}
