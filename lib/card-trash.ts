// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { cards, trashEntries, users, type User } from "@/lib/db/schema";
import type { PoolClient } from "pg";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { TrashError } from "@/lib/trash-error";

export type CardTrashContext = { boardId: number };
export function cardTrashContext(value: unknown): CardTrashContext {
  const context = value as CardTrashContext | null;
  if (!context || !Number.isSafeInteger(context.boardId) || context.boardId < 1) throw new TrashError("Der Karten-Eintrag ist nicht verfügbar.");
  return context;
}
export async function authorizeCardTrash(client: PoolClient, user: User, rawContext: unknown, boardId?: number) {
  const context = cardTrashContext(rawContext);
  if (boardId !== undefined && context.boardId !== boardId) throw new TrashError("Die Karte gehört nicht zu diesem Board.");
  const person = (await client.query("select role,is_active from users where id=$1 for share", [user.id])).rows[0];
  const board=(await client.query("select * from boards where id=$1 and deleted_at is null for share",[context.boardId])).rows[0];
  if(!person?.is_active||!board)throw new TrashError("Kein Schreibzugriff auf dieses Board.");
  if(board.inventory_board_id!=null)throw new TrashError("Leihvorgang-Karten bitte über das Inventar verwalten.");
  const owner=person.role==="admin"||board.owner_id===user.id||(await client.query("select 1 from board_owners where board_id=$1 and user_id=$2",[board.id,user.id])).rowCount;
  const grant=owner||(await client.query("select 1 from board_access a where a.board_id=$1 and a.access_level='write' and (a.user_id=$2 or exists(select 1 from user_groups ug join groups g on g.id=ug.group_id and g.deleted_at is null where ug.user_id=$2 and ug.group_id=a.group_id)) limit 1",[board.id,user.id])).rowCount;
  if(!grant)throw new TrashError("Kein Schreibzugriff auf dieses Board.");
  return context;
}
export async function boardCardTrash(user: User, boardId: number) {
  const board = await getBoardById(boardId);
  if (!board || !await canAccessBoard(user, board)) throw new TrashError("Kein Zugriff auf dieses Board.");
  const visible = await getVisibleFieldKeys(boardId);
  const rows = await db.select({ entry: trashEntries, title: cards.title, number: cards.number, cardId: cards.id, name: users.name, username: users.username }).from(trashEntries)
    .leftJoin(cards, and(eq(cards.id, trashEntries.entityId), eq(cards.boardId, boardId)))
    .leftJoin(users, eq(users.id, trashEntries.deletedBy))
    .where(and(eq(trashEntries.kind, "card"), inArray(trashEntries.state, ["trashed", "purging"]), sql`${trashEntries.context}->>'boardId'=${String(boardId)}`)).orderBy(desc(trashEntries.deletedAt), desc(trashEntries.id));
  return rows.map(({ entry, title, number, cardId, name, username }) => ({ id: entry.id, title: title ?? entry.label, number: visible.has("number") ? number : null, deletedAt: entry.deletedAt, expiresAt: entry.expiresAt, state: entry.state, lastError: entry.lastError, deletedBy: name || username || "Nicht mehr verfügbar", restorable: !!cardId && entry.state === "trashed" && entry.expiresAt > new Date() }));
}
export async function restoreBoardCard(user: User, boardId: number, id: number, confirmation: unknown) {
  if (typeof confirmation !== "string" || confirmation.trim() !== "WIEDERHERSTELLEN") throw new TrashError("Bitte WIEDERHERSTELLEN genau so eingeben.");
  if (!Number.isSafeInteger(boardId) || boardId < 1 || !Number.isSafeInteger(id) || id < 1) throw new TrashError("Ungültiger Karten-Eintrag.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const entry = (await client.query("select * from trash_entries where id=$1 and kind='card' for update", [id])).rows[0];
    if (!entry || entry.state !== "trashed") throw new TrashError("Die Karte liegt nicht mehr im Papierkorb.");
    if (new Date(entry.expires_at) <= new Date()) throw new TrashError("Die Wiederherstellungsfrist von 30 Tagen ist abgelaufen.");
    await authorizeCardTrash(client, user, entry.context, boardId);
    const card = (await client.query("select id from cards where id=$1 and board_id=$2 and deleted_at is not null for update", [entry.entity_id, boardId])).rows[0];
    if (!card) throw new TrashError("Die ursprüngliche Karte ist nicht mehr verfügbar.");
    await client.query("select set_config('gremio.trash_restore',$1,true)", [String(id)]);
    await client.query("update cards set deleted_at=null where id=$1", [card.id]);
    await client.query("insert into card_activity(card_id,user_id,type,detail) values($1,$2,'card_restored','Karte aus dem Papierkorb wiederhergestellt.')", [card.id, user.id]);
    await client.query("update trash_entries set state='restored',finished_at=now(),finished_by=$2,last_error=null where id=$1", [id, user.id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
