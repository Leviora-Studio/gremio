// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { readFile } from "node:fs/promises";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, boards, cards, groups, meetingAreas, meetingAreaAccess, meetingBoards, meetingDocuments, meetings, meetingTopicCards, meetingTopicActivity, meetingTopics, users, type User } from "@/lib/db/schema";
import { canAccessBoard, canManageBoard, getBoardById } from "@/lib/authz";
import { getInventoryBoardById, canManageInventoryBoard } from "@/lib/inventory";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { isCardAttachmentVisible } from "@/lib/card-attachment-visibility";
import { absPath, deleteStoredFile, saveNamedBuffer, saveNamedFile, validateUpload } from "@/lib/attachments";
import { canManageMeeting, meetingAccessLevel, MeetingError, requireArea, requireMeeting, requireTopic, visibleTopics } from "./access";
import {scheduleFinancialCard,finishFinancialMove,type FinancialMove} from "./finance-status";
import { agendaTopics } from "./agenda";
import { meetingInput, parseBerlinDate, topicInput, topicStates } from "./validation";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function touchMeeting(tx: Tx, id: number, revision?: number, openOnly = true) {
  const rows = await tx.update(meetings).set({ revision: sql`${meetings.revision} + 1` }).where(and(eq(meetings.id, id), revision == null ? undefined : eq(meetings.revision, revision), openOnly ? ne(meetings.state, "closed") : undefined)).returning({ id: meetings.id });
  if (!rows.length) throw new MeetingError("Die Sitzung wurde zwischenzeitlich geändert. Bitte neu laden.");
}
export async function manageSourceBoard(user: User, board: typeof boards.$inferSelect) {
  if (board.inventoryBoardId == null) return (await canManageBoard(user, board));
  const inventory = await getInventoryBoardById(board.inventoryBoardId);
  return !!inventory && inventory.loanBoardId === board.id && (await canManageInventoryBoard(user, inventory));
}
export async function saveMeeting(user: User, id: number | null, raw: unknown, revision?: number) {
  const parsed = meetingInput.safeParse(raw);
  if (!parsed.success) throw new MeetingError("Bitte Titel und gültige Sitzungsangaben ergänzen.");
  let startsAt: Date | null, submissionDeadline: Date | null;
  try { startsAt = parseBerlinDate(parsed.data.startsAt); submissionDeadline = parseBerlinDate(parsed.data.submissionDeadline); }
  catch { throw new MeetingError("Bitte gültige Termine in Europe/Berlin angeben."); }
  if (startsAt && submissionDeadline && submissionDeadline > startsAt) throw new MeetingError("Die Einreichungsfrist muss vor dem Sitzungsbeginn liegen.");
  const area = await requireArea(user, parsed.data.areaId, "write");
  const values = { ...parsed.data, committee: area.name, ownerId: area.ownerId, startsAt, submissionDeadline };
  if (id == null) {
    if (!user.isActive) throw new MeetingError("Kein Zugriff.");
    const [meeting] = await db.insert(meetings).values(values).returning();
    return meeting.id;
  }
  const previous = await requireMeeting(user, id, "write");
  if (previous.areaId !== area.id) throw new MeetingError("Die Bereichszuordnung kann nicht über Sitzungseinstellungen geändert werden.");
  await db.transaction(async tx => {
    const [current] = await tx.select().from(meetings).where(eq(meetings.id, id)).for("update");
    if (current?.state === "closed" && values.state !== "closed" && !canManageMeeting(user, previous)) {
      throw new MeetingError("Nur die Sitzungsverwaltung darf eine abgeschlossene Sitzung wieder öffnen.");
    }
    await touchMeeting(tx, id, revision, false);
    await tx.update(meetings).set(values).where(eq(meetings.id, id));
  });
  return id;
}
export async function saveAreaGrant(user: User, areaId: number, subject: "user" | "group", subjectId: number, level: "read" | "write" | "remove") {
  await requireArea(user, areaId, "manage");
  if (!["user", "group"].includes(subject) || !["read", "write", "remove"].includes(level) || !Number.isSafeInteger(subjectId) || subjectId < 1) throw new MeetingError("Ungültige Freigabe.");
  const table = subject === "user" ? users : groups;
  const [target] = await db.select({ id: table.id }).from(table).where(eq(table.id, subjectId));
  if (!target) throw new MeetingError("Person oder Gruppe nicht vorhanden.");
  const field = subject === "user" ? meetingAreaAccess.userId : meetingAreaAccess.groupId;
  if (level === "remove") { await db.delete(meetingAreaAccess).where(and(eq(meetingAreaAccess.areaId, areaId), eq(field, subjectId))); return; }
  await db.insert(meetingAreaAccess).values({ areaId, userId: subject === "user" ? subjectId : null, groupId: subject === "group" ? subjectId : null, accessLevel: level }).onConflictDoUpdate({ target: [meetingAreaAccess.areaId, field], set: { accessLevel: level } });
}
export async function bindMeetingBoard(user: User, meetingId: number, boardId: number, remove = false) {
  await requireMeeting(user, meetingId, "manage");
  const board = await getBoardById(boardId);
  if (!board || !(await manageSourceBoard(user, board))) throw new MeetingError("Die Anbindung erfordert Verwaltungsrechte für Sitzung und Board.");
  if (remove) await db.delete(meetingBoards).where(and(eq(meetingBoards.meetingId, meetingId), eq(meetingBoards.boardId, boardId)));
  else await db.insert(meetingBoards).values({ meetingId, boardId }).onConflictDoNothing();
}
async function validateParent(user: User, meetingId: number | null, parentId: number | null, topicId?: number, previousParent?: number | null) {
  if(parentId==null)return null;
  if(meetingId==null||parentId===topicId)throw new MeetingError("Ein Unter-TOP braucht einen anderen Haupt-TOP derselben Sitzung.");
  const {topic:parent}=await requireTopic(user,parentId);
  if(parent.transferred)throw new MeetingError("Der Haupt-TOP wurde bereits weitergegeben.");
  if(parent.meetingId!==meetingId||parent.parentId!=null)throw new MeetingError("Unter-TOPs können nur einem Haupt-TOP derselben Sitzung zugeordnet werden.");
  if(parentId!==previousParent&&!["scheduled","treated"].includes(parent.state))throw new MeetingError("Bitte zuerst den Haupt-TOP einplanen.");
  if(topicId!=null){const [child]=await db.select({id:meetingTopics.id}).from(meetingTopics).where(eq(meetingTopics.parentId,topicId)).limit(1);if(child)throw new MeetingError("Ein Haupt-TOP mit Unter-TOPs kann nicht selbst untergeordnet werden.");}
  return parent;
}
export async function createTopic(user: User, meetingId: number | null, raw: unknown, cardId?: number) {
  const parsed = topicInput.safeParse(raw);
  if (!parsed.success) throw new MeetingError("Bitte Titel, Art und Dauer (1–480 Minuten) prüfen.");
  let values = parsed.data;
  if (!user.isActive) throw new MeetingError("Kein Zugriff.");
  if (meetingId != null) {
    const meeting = await requireMeeting(user, meetingId);
    if (meeting.state === "closed") throw new MeetingError("Die Sitzung ist abgeschlossen.");
    const level = await meetingAccessLevel(user, meeting);
    if (!level) throw new MeetingError("Kein Zugriff.");
    const writer = level === "write";
    if (!writer) {
      if (values.parentId!=null) throw new MeetingError("Vorschläge können nur als eigenständige TOPs eingereicht werden.");
      if (values.confidential) throw new MeetingError("Vertrauliche TOPs darf nur die Sitzungsverwaltung anlegen.");
      if (meeting.submissionDeadline && meeting.submissionDeadline < new Date()) throw new MeetingError("Die Einreichungsfrist ist abgelaufen.");
      values = { ...values, state: "proposed", confidential: false, outcome: "" };
    } else if (values.confidential && !canManageMeeting(user, meeting)) throw new MeetingError("Vertrauliche TOPs verwaltet nur die Sitzungsverwaltung.");
    if (cardId != null && !writer) throw new MeetingError("Kartenverknüpfungen erfordern Schreibzugriff auf die Tagesordnung.");
  }
  await validateParent(user,meetingId,values.parentId);
  if(values.parentId!=null&&values.state==="proposed")values={...values,state:"scheduled"};
  if (cardId != null) await readableCard(user, cardId);
  const [topic] = await db.transaction(async tx => {
    if (meetingId != null) await touchMeeting(tx, meetingId);
    const [max] = await tx.select({ n: sql<number>`coalesce(max(${meetingTopics.position}), -1) + 1` }).from(meetingTopics).where(meetingId == null ? eq(meetingTopics.createdBy, user.id) : eq(meetingTopics.meetingId, meetingId));
    const result = await tx.insert(meetingTopics).values({ ...values, meetingId, createdBy: user.id, position: max.n }).returning();
    if (cardId != null) await tx.insert(meetingTopicCards).values({ topicId: result[0].id, cardId });
    return result;
  });
  return topic.id;
}
export async function saveTopic(user: User, id: number, raw: unknown, revision: number, disclose: boolean) {
  const { topic, meeting } = await requireTopic(user, id, true);
  const parsed = topicInput.safeParse(raw);
  if (!parsed.success) throw new MeetingError("Bitte Titel, Art und Dauer prüfen.");
  if(topic.isFinanceTopic&&parsed.data.parentId!=null)throw new MeetingError("Der Finanzanträge-TOP muss ein Haupt-TOP bleiben.");
  if(topic.isFinanceItem&&parsed.data.parentId!==topic.parentId)throw new MeetingError("Eingeplante Finanzanträge bleiben ihrem Finanzanträge-TOP zugeordnet. Zum Neuplanen bitte den Unter-TOP entfernen und erneut einplanen.");
  if (meeting && parsed.data.confidential && !canManageMeeting(user, meeting)) throw new MeetingError("Vertrauliche TOPs verwaltet nur die Sitzungsverwaltung.");
  const parent=await validateParent(user,topic.meetingId,parsed.data.parentId,id,topic.parentId);
  const oldParent=topic.parentId==null?null:(await requireTopic(user,topic.parentId)).topic;
  if((topic.confidential||oldParent?.confidential)&&!parsed.data.confidential&&!parent?.confidential&&!disclose)throw new MeetingError("Bitte die Freigabe der Inhalte und Unterlagen bestätigen.");
  if(parsed.data.parentId!=null&&parsed.data.state==="proposed")parsed.data.state="scheduled";
  let move:FinancialMove|undefined;
  await db.transaction(async tx => { if (meeting) await touchMeeting(tx, meeting.id, revision); if(meeting&&topic.isFinanceItem&&parsed.data.state==="scheduled"&&topic.state!=="scheduled"){if(topic.financeCardId==null)throw new MeetingError("Die Finanzantragskarte wurde gelöscht.");move=await scheduleFinancialCard(tx,user,topic.financeCardId,meeting,topic.parentId);} await tx.update(meetingTopics).set(parsed.data).where(eq(meetingTopics.id, id)); await syncPersonalCompletion(tx,topic.originTopicId); });
  await finishFinancialMove(move);
}
/** Preserve content, parent, confidentiality and documents when accepting a proposal. */
export async function scheduleTopic(user:User,id:number,revision:number) {
  const {topic,meeting}=await requireTopic(user,id,true);
  if(!meeting||!["proposed","deferred"].includes(topic.state))throw new MeetingError("Dieser TOP kann nicht direkt eingeplant werden. Bitte neu laden.");
  await saveTopic(user,id,{...topic,state:"scheduled"},revision,false);
}
export async function transferTopic(user: User, id: number, targetMeetingId: number, disclose: boolean): Promise<number> {
  const {topic,meeting}=await requireTopic(user,id);
  if(meeting&&topic.state==="withdrawn")throw new MeetingError("Zurückgezogene TOPs werden nicht übernommen. Die einreichende Person kann das Thema aus ihrem Themenspeicher neu vorschlagen.");
  if(topic.resolvedAt)throw new MeetingError("Dieses Thema ist bereits erledigt.");
  if(topic.transferred)throw new MeetingError("Dieser TOP wurde bereits weitergegeben. Bitte den aktuellen TOP öffnen.");
  if(meeting)await requireMeeting(user,meeting.id,"write");
  const target=await requireMeeting(user,targetMeetingId,meeting?"write":"read");
  const targetWriter=await meetingAccessLevel(user,target)==="write";
  if(!disclose)throw new MeetingError("Bitte die Freigabe an den neuen Teilnehmerkreis bestätigen.");
  if(target.id===topic.meetingId||target.state==="closed")throw new MeetingError("Bitte eine andere, offene Sitzung auswählen.");
  if(!targetWriter&&target.submissionDeadline&&target.submissionDeadline<new Date())throw new MeetingError("Die Einreichungsfrist ist abgelaufen.");
  const inheritedPrivate=topic.parentId!=null&&(await requireTopic(user,topic.parentId)).topic.confidential;
  const childIds=meeting&&topic.parentId==null?(await visibleTopics(user,meeting.id)).filter(row=>row.parentId===id&&!row.transferred&&row.state!=="withdrawn").map(row=>row.id):[];
  const sources=[{...topic,confidential:topic.confidential||!!inheritedPrivate}];
  for(const childId of childIds)sources.push((await requireTopic(user,childId)).topic);
  if(sources.some(row=>row.confidential)&&!canManageMeeting(user,target))throw new MeetingError("Vertrauliche TOPs darf nur die Ziel-Sitzungsverwaltung übernehmen.");
  const prepared:{topic:typeof topic;files:Awaited<ReturnType<typeof saveNamedBuffer>>[];links:Awaited<ReturnType<typeof visibleTopicLinks>>}[]=[];
  try {
    for(const source of sources){
      const item={topic:source,files:[] as Awaited<ReturnType<typeof saveNamedBuffer>>[],links:await visibleTopicLinks(user,source.id)};prepared.push(item);
      const docs=await db.select().from(meetingDocuments).where(eq(meetingDocuments.topicId,source.id));
      for(const doc of docs)item.files.push(await saveNamedBuffer("meeting-topics/copies",doc.filename,await readFile(absPath(doc.path)),doc.mime));
    }
    for(const source of sources)await requireTopic(user,source.id);
    if(meeting)await requireMeeting(user,meeting.id,"write");
    const latestTarget=await requireMeeting(user,target.id,meeting?"write":"read");
    if(!meeting&&await meetingAccessLevel(user,latestTarget)!=="write"&&latestTarget.submissionDeadline&&latestTarget.submissionDeadline<new Date())throw new MeetingError("Die Einreichungsfrist ist abgelaufen.");
    return await db.transaction(async tx=>{
      for(const mid of [meeting?.id,target.id].filter((v):v is number=>v!=null).sort((a,b)=>a-b))await touchMeeting(tx,mid,mid===target.id?target.revision:meeting!.revision,mid===target.id);
      // Serialize repeated proposals even when they target different meetings.
      const origin=topic.originTopicId??(meeting==null?topic.id:null);
      let predecessor=topic.id;
      if(origin!=null){
        const [root]=await tx.select().from(meetingTopics).where(eq(meetingTopics.id,origin)).for("update");
        if(!root||!meeting&&(root.state==="treated"||root.resolvedAt!=null))throw new MeetingError("Dieses Thema wurde bereits behandelt.");
        if(!meeting){const [last]=await tx.select({id:meetingTopics.id}).from(meetingTopics).where(eq(meetingTopics.originTopicId,origin)).orderBy(sql`${meetingTopics.id} desc`).limit(1);predecessor=last?.id??topic.id;}
        const active=await tx.select({id:meetingTopics.id}).from(meetingTopics).where(and(eq(meetingTopics.originTopicId,origin),eq(meetingTopics.transferred,false),inArray(meetingTopics.state,["proposed","scheduled"])));
        if(active.some(row=>row.id!==topic.id))throw new MeetingError("Das Thema ist bereits für eine Sitzung vorgeschlagen oder eingeplant. Bitte zuerst dort vertagen oder zurückziehen.");
      }
      const [fresh]=await tx.select().from(meetingTopics).where(eq(meetingTopics.id,id)).for("update");
      if(!fresh||fresh.transferred)throw new MeetingError("Das Thema wurde bereits weitergegeben. Bitte neu laden.");
      const targetTopics=await tx.select().from(meetingTopics).where(eq(meetingTopics.meetingId,target.id));
      if(topic.isFinanceTopic&&targetTopics.some(t=>t.isFinanceTopic&&!t.transferred))throw new MeetingError("Die Zielsitzung hat bereits einen Finanzanträge-TOP. Bitte die Anträge dort einzeln einplanen.");
      const financeParent=topic.isFinanceItem?targetTopics.find(t=>t.isFinanceTopic&&!t.transferred):null;
      if(topic.isFinanceItem&&!financeParent)throw new MeetingError("Bitte in der Zielsitzung zuerst einen Finanzanträge-TOP festlegen.");
      if(financeParent)await requireTopic(user,financeParent.id);
      if(sources.some(source=>source.financeCardId!=null&&targetTopics.some(t=>!t.transferred&&t.financeCardId===source.financeCardId)))throw new MeetingError("Ein Finanzantrag ist in der Zielsitzung bereits vorhanden.");
      const [max]=await tx.select({n:sql<number>`coalesce(max(${meetingTopics.position}),-1)+1`}).from(meetingTopics).where(eq(meetingTopics.meetingId,target.id));
      let newRoot=0;
      for(const [index,item] of prepared.entries()){
        const {id:_id,createdAt:_createdAt,...content}=item.topic;
        const [created]=await tx.insert(meetingTopics).values({...content,meetingId:target.id,parentId:index===0?financeParent?.id??null:newRoot,state:"proposed",outcome:targetWriter?content.outcome:"",position:max.n+index,createdBy:item.topic.createdBy??user.id,originTopicId:item.topic.originTopicId??(meeting==null?item.topic.id:null),previousTopicId:index===0?predecessor:item.topic.id,transferred:false,hiddenAfterTransfer:false}).returning();
        if(index===0)newRoot=created.id;
        for(const file of item.files)await tx.insert(meetingDocuments).values({topicId:created.id,filename:file.filename,path:file.relPath,mime:file.mime,size:file.size,uploadedBy:user.id});
        for(const link of item.links)await tx.insert(meetingTopicCards).values({topicId:created.id,cardId:link.id});
        if(meeting)await tx.update(meetingTopics).set({transferred:true,hiddenAfterTransfer:item.topic.state==="scheduled"}).where(eq(meetingTopics.id,item.topic.id));
      }
      return newRoot;
    });
  }catch(error){for(const item of prepared)for(const file of item.files)await deleteStoredFile(file.relPath);throw error;}
}
/** Keep a private master until one of its submitted occurrences is treated. */
async function syncPersonalCompletion(tx:Tx,origin:number|null){
  if(origin==null)return;
  const [root]=await tx.select().from(meetingTopics).where(eq(meetingTopics.id,origin)).for("update");if(!root||root.meetingId!=null)return;
  const active=await tx.select({id:meetingTopics.id}).from(meetingTopics).where(and(eq(meetingTopics.originTopicId,origin),eq(meetingTopics.transferred,false),inArray(meetingTopics.state,["proposed","scheduled"])));
  if(active.length>1)throw new MeetingError("Das Thema ist bereits für eine andere Sitzung vorgeschlagen oder eingeplant.");
  const [treated]=await tx.select({id:meetingTopics.id}).from(meetingTopics).where(and(eq(meetingTopics.originTopicId,origin),eq(meetingTopics.state,"treated"))).limit(1);
  await tx.update(meetingTopics).set({state:treated?"treated":"proposed",...(active.length?{resolvedAt:null}:{})}).where(eq(meetingTopics.id,origin));
}
export async function setTopicStatus(user:User,id:number,state:string,revision:number){
  if(!Object.prototype.hasOwnProperty.call(topicStates,state))throw new MeetingError("Ungültiger TOP-Status.");
  const {topic,meeting}=await requireTopic(user,id,true);
  if(!meeting)throw new MeetingError("Dieses Thema ist noch keiner Sitzung zugeordnet.");
  let move:FinancialMove|undefined;
  await db.transaction(async tx=>{
    await touchMeeting(tx,meeting.id,revision);
    if(topic.isFinanceItem&&state==="scheduled"&&topic.state!=="scheduled"){if(topic.financeCardId==null)throw new MeetingError("Die Finanzantragskarte wurde gelöscht.");move=await scheduleFinancialCard(tx,user,topic.financeCardId,meeting,topic.parentId);}
    await tx.update(meetingTopics).set({state:state as typeof topic.state}).where(eq(meetingTopics.id,id));
    await syncPersonalCompletion(tx,topic.originTopicId);
  });
  await finishFinancialMove(move);
}
export async function reorderTopics(user: User, meetingId: number, ids: number[], revision: number) {
  const meeting = await requireMeeting(user, meetingId, "write");
  if (meeting.state === "closed") throw new MeetingError("Die Sitzung ist abgeschlossen.");
  if (ids.length > 1000 || ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) throw new MeetingError("Ungültige Reihenfolge.");
  await db.transaction(async tx => {
    await touchMeeting(tx, meetingId, revision);
    const rows = await tx.select().from(meetingTopics).where(eq(meetingTopics.meetingId, meetingId)).orderBy(asc(meetingTopics.position), asc(meetingTopics.id));
    const allowed=rows.filter(row=>!row.confidential||canManageMeeting(user,meeting));
    const allowedIds=new Set(allowed.map(t=>t.id));
    const filtered=allowed.filter(row=>(row.parentId==null||allowedIds.has(row.parentId))&&!row.hiddenAfterTransfer);
    const shownIds=new Set(filtered.map(t=>t.id));
    const editable = agendaTopics(filtered.map(row=>row.parentId!=null&&!shownIds.has(row.parentId)?{...row,parentId:null}:row));
    if (editable.length !== ids.length || ids.some(id => !editable.some(row => row.id === id))) throw new MeetingError("Die Tagesordnung wurde geändert. Bitte neu laden.");
    const ordered=ids.map((id,index)=>({...editable.find(row=>row.id===id)!,position:index}));
    if(agendaTopics(ordered).map(row=>row.id).join(",")!==ids.join(","))throw new MeetingError("Haupt-TOPs werden zusammen mit ihren Unter-TOPs sortiert. Unter-TOPs bleiben in ihrer Gruppe.");
    const slots=editable.map(row=>row.position).sort((a,b)=>a-b);
    for (const [index, id] of ids.entries()) await tx.update(meetingTopics).set({ position: slots[index] }).where(eq(meetingTopics.id, id));
  });
}
export async function readableCard(user: User, cardId: number, write = false) {
  if (!Number.isSafeInteger(cardId) || cardId < 1 || cardId > 2147483647) throw new MeetingError("Karte nicht verfügbar.");
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
  const board = card && await getBoardById(card.boardId);
  if (!card || !board || !(await canAccessBoard(user, board, write ? "write" : "read"))) throw new MeetingError("Karte nicht verfügbar.");
  return { card, board };
}
export async function linkTopicCard(user: User, topicId: number, cardId: number, remove = false) {
  await requireTopic(user, topicId, true);
  await readableCard(user, cardId);
  if (remove) await db.delete(meetingTopicCards).where(and(eq(meetingTopicCards.topicId, topicId), eq(meetingTopicCards.cardId, cardId)));
  else await db.insert(meetingTopicCards).values({ topicId, cardId }).onConflictDoNothing();
}
/** Only this filtered projection may reach a page or client. No locked-card metadata. */
export async function visibleTopicLinks(user: User, topicId: number) {
  await requireTopic(user, topicId);
  const rows = await db.select({ card: cards, board: boards }).from(meetingTopicCards).innerJoin(cards, eq(cards.id, meetingTopicCards.cardId)).innerJoin(boards, eq(boards.id, cards.boardId)).where(eq(meetingTopicCards.topicId, topicId));
  const result: { id: number; title: string; boardName: string }[] = [];
  for (const row of rows) if (await canAccessBoard(user, row.board)) result.push({ id: row.card.id, title: row.card.title, boardName: row.board.name });
  return result;
}
export async function visibleMeetingBoards(user: User, meetingId: number) {
  await requireMeeting(user, meetingId);
  const rows = await db.select({ board: boards }).from(meetingBoards).innerJoin(boards, eq(boards.id, meetingBoards.boardId)).where(eq(meetingBoards.meetingId, meetingId));
  const result = [];
  for (const { board } of rows) if (await canAccessBoard(user, board)) result.push(board);
  return result;
}
const DOCUMENT_MIME = ["application/pdf", "image/png", "image/jpeg"];
export async function addMeetingDocument(user: User, topicId: number, file: File, disclose: boolean) {
  await requireTopic(user, topicId, true);
  if (!disclose) throw new MeetingError("Bitte die Freigabe als Sitzungsunterlage bestätigen.");
  const invalid = validateUpload(file, DOCUMENT_MIME);
  if (invalid || !file.size) throw new MeetingError(invalid || "Bitte eine Datei auswählen.");
  const saved = await saveNamedFile(`meeting-topics/${topicId}`, file);
  try {
    await requireTopic(user, topicId, true);
    await db.insert(meetingDocuments).values({ topicId, filename: saved.filename, path: saved.relPath, mime: saved.mime, size: saved.size, uploadedBy: user.id });
  } catch (error) { await deleteStoredFile(saved.relPath); throw error; }
}
export async function copyCardDocument(user: User, topicId: number, attachmentId: number, disclose: boolean) {
  await requireTopic(user, topicId, true);
  if (!disclose) throw new MeetingError("Bitte die eigenständige Freigabe der Dateikopie bestätigen.");
  const [attachment] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
  if (!attachment || attachment.kind === "student_card" || !DOCUMENT_MIME.includes(attachment.mime)) throw new MeetingError("Diese Datei kann nicht übernommen werden.");
  const { board } = await readableCard(user, attachment.cardId, true);
  const [link] = await db.select().from(meetingTopicCards).where(and(eq(meetingTopicCards.topicId, topicId), eq(meetingTopicCards.cardId, attachment.cardId)));
  if (!link || !isCardAttachmentVisible(attachment, await getVisibleFieldKeys(board.id))) throw new MeetingError("Diese Datei kann nicht übernommen werden.");
  const bytes = await readFile(absPath(attachment.path));
  if (bytes.length > 25 * 1024 * 1024) throw new MeetingError("Datei zu groß.");
  const saved = await saveNamedBuffer(`meeting-topics/${topicId}`, attachment.filename, bytes, attachment.mime);
  try {
    await requireTopic(user, topicId, true);
    const { board: currentBoard } = await readableCard(user, attachment.cardId, true);
    const [currentAttachment] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
    const [currentLink] = await db.select().from(meetingTopicCards).where(and(eq(meetingTopicCards.topicId, topicId), eq(meetingTopicCards.cardId, attachment.cardId)));
    if (!currentLink || !currentAttachment || currentAttachment.path !== attachment.path || currentAttachment.kind === "student_card" || !isCardAttachmentVisible(currentAttachment, await getVisibleFieldKeys(currentBoard.id))) throw new MeetingError("Die Quelldatei wurde geändert oder ist nicht mehr freigegeben.");
    await db.insert(meetingDocuments).values({ topicId, filename: saved.filename, path: saved.relPath, mime: saved.mime, size: saved.size, uploadedBy: user.id });
  } catch (error) { await deleteStoredFile(saved.relPath); throw error; }
}
export async function topicDocuments(user: User, topicId: number) {
  await requireTopic(user, topicId);
  return db.select({ id: meetingDocuments.id, filename: meetingDocuments.filename, mime: meetingDocuments.mime, size: meetingDocuments.size }).from(meetingDocuments).where(eq(meetingDocuments.topicId, topicId));
}
export async function removeMeetingDocument(user: User, id: number) {
  const [doc] = await db.select().from(meetingDocuments).where(eq(meetingDocuments.id, id));
  if (!doc) throw new MeetingError("Datei nicht verfügbar.");
  await requireTopic(user, doc.topicId, true);
  await db.delete(meetingDocuments).where(eq(meetingDocuments.id, id));
  await deleteStoredFile(doc.path);
}
export async function deleteTopic(user: User, id: number) {
  const { topic, meeting } = await requireTopic(user, id, true);
  const files = await db.select({ path: meetingDocuments.path }).from(meetingDocuments).where(eq(meetingDocuments.topicId, id));
  await db.transaction(async tx => { if (meeting) await touchMeeting(tx, meeting.id); if(topic.isFinanceTopic){const [child]=await tx.select({id:meetingTopics.id}).from(meetingTopics).where(and(eq(meetingTopics.parentId,id),eq(meetingTopics.isFinanceItem,true))).limit(1);if(child)throw new MeetingError("Bitte zuerst die Finanzanträge-Unter-TOPs entfernen. Die Karten selbst bleiben dabei erhalten.");} await tx.delete(meetingTopics).where(eq(meetingTopics.id, topic.id)); });
  for (const file of files) await deleteStoredFile(file.path);
}

export async function deleteMeeting(user: User, id: number) {
  await requireMeeting(user, id, "manage");
  const files = await db.select({ path: meetingDocuments.path }).from(meetingDocuments).innerJoin(meetingTopics, eq(meetingTopics.id, meetingDocuments.topicId)).where(eq(meetingTopics.meetingId, id));
  await db.delete(meetings).where(eq(meetings.id, id));
  for (const file of files) await deleteStoredFile(file.path);
}

export async function saveArea(user: User, id: number | null, name: string, description: string) {
  const { sanitizeSingleLine, sanitizeMultiLine } = await import("@/lib/text");
  name=sanitizeSingleLine(name);description=sanitizeMultiLine(description);
  if(!name||name.length>200||description.length>5000||!user.isActive)throw new MeetingError("Bitte einen Bereichsnamen angeben (max. 200 Zeichen).");
  if(id==null){const [area]=await db.insert(meetingAreas).values({name,description,ownerId:user.id}).returning();return area.id;}
  await requireArea(user,id,"manage");
  await db.transaction(async tx=>{await tx.update(meetingAreas).set({name,description}).where(eq(meetingAreas.id,id));await tx.update(meetings).set({committee:name,revision:sql`${meetings.revision}+1`}).where(eq(meetings.areaId,id));});
  return id;
}

/** Adopt an author's direct withdrawn submission without changing its session state. */
export async function personalTopicForAction(user:User,id:number):Promise<number>{
  const {topic,meeting}=await requireTopic(user,id);
  if(topic.createdBy!==user.id)throw new MeetingError("Nur die einreichende Person kann ihr eigenes Thema verwalten.");
  if(!meeting)return id;
  if(topic.state!=="withdrawn")throw new MeetingError("Nur zurückgezogene Sitzungsthemen können von hier erneut vorgeschlagen werden.");
  if(topic.originTopicId!=null){const original=await requireTopic(user,topic.originTopicId);if(original.meeting||original.topic.createdBy!==user.id)throw new MeetingError("Kein Zugriff.");return original.topic.id;}
  const inheritedPrivate=topic.parentId!=null&&(await requireTopic(user,topic.parentId)).topic.confidential;
  const links=await visibleTopicLinks(user,id),files:Awaited<ReturnType<typeof saveNamedBuffer>>[]=[];
  try{
    const docs=await db.select().from(meetingDocuments).where(eq(meetingDocuments.topicId,id));
    for(const doc of docs)files.push(await saveNamedBuffer("meeting-topics/personal",doc.filename,await readFile(absPath(doc.path)),doc.mime));
    await requireTopic(user,id);
    const result=await db.transaction(async tx=>{
      const [fresh]=await tx.select().from(meetingTopics).where(eq(meetingTopics.id,id)).for("update");
      if(!fresh||fresh.createdBy!==user.id||fresh.state!=="withdrawn")throw new MeetingError("Das Thema wurde geändert. Bitte neu laden.");
      if(fresh.originTopicId!=null)return {id:fresh.originTopicId,created:false};
      const [root]=await tx.insert(meetingTopics).values({title:topic.title,description:topic.description,motion:topic.motion,presenter:topic.presenter,kind:topic.kind,durationMinutes:topic.durationMinutes,confidential:topic.confidential||!!inheritedPrivate,createdBy:user.id,state:"proposed"}).returning({id:meetingTopics.id});
      for(const file of files)await tx.insert(meetingDocuments).values({topicId:root.id,filename:file.filename,path:file.relPath,mime:file.mime,size:file.size,uploadedBy:user.id});
      for(const link of links)await tx.insert(meetingTopicCards).values({topicId:root.id,cardId:link.id});
      await tx.update(meetingTopics).set({originTopicId:root.id,previousTopicId:root.id}).where(eq(meetingTopics.id,id));
      return {id:root.id,created:true};
    });
    if(!result.created)for(const file of files)await deleteStoredFile(file.relPath);
    return result.id;
  }catch(error){for(const file of files)await deleteStoredFile(file.relPath);throw error;}
}
/** Only the private author may close their withdrawn topic; the session record stays withdrawn. */
export async function resolvePersonalTopic(user:User,id:number){
  id=await personalTopicForAction(user,id);
  const {topic,meeting}=await requireTopic(user,id);
  if(meeting||topic.createdBy!==user.id)throw new MeetingError("Nur die einreichende Person kann ihr eigenes Thema als erledigt markieren.");
  await db.transaction(async tx=>{
    const [root]=await tx.select().from(meetingTopics).where(eq(meetingTopics.id,id)).for("update");
    if(!root||root.resolvedAt)return;
    const occurrences=await tx.select().from(meetingTopics).where(eq(meetingTopics.originTopicId,id)).orderBy(sql`${meetingTopics.id} desc`);
    if(occurrences[0])await requireTopic(user,occurrences[0].id);
    if(occurrences.some(t=>!t.transferred&&["proposed","scheduled"].includes(t.state))||occurrences[0]?.state!=="withdrawn")throw new MeetingError("Nur ein aktuell zurückgezogenes Thema ohne aktive Einplanung kann als erledigt markiert werden.");
    await tx.update(meetingTopics).set({resolvedAt:new Date()}).where(eq(meetingTopics.id,id));
    await tx.insert(meetingTopicActivity).values({originTopicId:id,topicId:occurrences[0].id,state:"resolved"});
  });
}
