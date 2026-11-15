// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { TRASH_RETENTION_MS } from "@/lib/trash-retention";
import { access } from "node:fs/promises";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { db, pool } from "@/lib/db";
import { attachments, cards, cardActivity, trashEntries, users, type User } from "@/lib/db/schema";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { isCardAttachmentVisible } from "@/lib/card-attachment-visibility";
import { requireMutableCard } from "@/lib/card-freeze";
import { absPath } from "@/lib/attachments";
import { TrashError } from "@/lib/trash-error";
import { activeRows } from "@/lib/trash-visibility";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Attachment = typeof attachments.$inferSelect;
export type AttachmentTrashContext = {
  boardId: number; cardId: number; cardTitle: string; cardNumber: string | null;
  attachment: Omit<Attachment, "uploadedAt"> & { uploadedAt: string };
};
export function attachmentTrashContext(value: unknown): AttachmentTrashContext {
  const context = value as AttachmentTrashContext | null;
  if (!context || !Number.isSafeInteger(context.boardId) || !Number.isSafeInteger(context.cardId) || !context.attachment || typeof context.attachment.path !== "string")
    throw new TrashError("Der Datei-Eintrag ist nicht verfügbar.");
  return context;
}

/** The caller already holds the card lock and checks its live write/field rights.
 * Snapshot the complete metadata and remove only the live reference atomically.
 * File bytes remain at their original path throughout the retention period. */
export async function stageAttachmentTrash(tx: Tx, cardId: number, attachmentId: number, userId: number) {
  const card = await requireMutableCard(tx, cardId);
  const [stored] = await tx.select({ file: attachments, uploadedAt: sql<string>`${attachments.uploadedAt}::text` }).from(attachments).where(and(eq(attachments.id, attachmentId), eq(attachments.cardId, cardId))).for("update");
  const file = stored?.file;
  if (!file) return;
  const context: AttachmentTrashContext = {
    boardId: card.boardId, cardId, cardTitle: card.title, cardNumber: card.number,
    attachment: { ...file, uploadedAt: stored.uploadedAt },
  };
  const deletedAt = new Date();
  const [entry] = await tx.insert(trashEntries).values({
    kind: "attachment", entityId: file.id, label: file.filename, deletedBy: userId,
    deletedAt, expiresAt: new Date(deletedAt.getTime() + TRASH_RETENTION_MS),
    context, cleanupPaths: [file.path],
  }).returning({ id: trashEntries.id });
  await tx.delete(attachments).where(eq(attachments.id, file.id));
  await tx.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, cardId));
  await tx.insert(cardActivity).values({ cardId, userId, type: "attachment_trashed", detail: `In den Papierkorb verschoben: ${file.filename}` });
  return entry.id;
}

/** Shared by manual restore/purge. Board identity, active user, grants and hidden
 * attachment fields are checked independently of confirmation words. */
export async function authorizeAttachmentTrash(client: PoolClient, user: User, rawContext: unknown, boardId?: number) {
  const context = attachmentTrashContext(rawContext);
  if (boardId !== undefined && boardId !== context.boardId) throw new TrashError("Die Datei gehört nicht zu diesem Board.");
  const person = (await client.query("select role,is_active from users where id=$1 for share", [user.id])).rows[0];
  const live = { ...user, role: person?.role, isActive: person?.is_active } as User;
  const locked = await client.query("select id from boards where id=$1 and deleted_at is null for share", [context.boardId]);
  const board = await getBoardById(context.boardId);
  if (!locked.rowCount || !person?.is_active || !board || !await canAccessBoard(live, board, "write")) throw new TrashError("Kein Schreibzugriff auf dieses Board.");
  if (!isCardAttachmentVisible(context.attachment, await getVisibleFieldKeys(board.id))) throw new TrashError("Diese Datei ist nicht freigegeben.");
  return context;
}

export async function boardAttachmentTrash(user: User, boardId: number) {
  const board = await getBoardById(boardId);
  if (!board || !await canAccessBoard(user, board)) throw new TrashError("Kein Zugriff auf dieses Board.");
  const visible = await getVisibleFieldKeys(boardId);
  const rows = await db.select({ entry: trashEntries, name: users.name, username: users.username })
    .from(trashEntries).leftJoin(users, eq(users.id, trashEntries.deletedBy))
    .where(and(eq(trashEntries.kind, "attachment"), inArray(trashEntries.state, ["trashed", "purging"]), sql`${trashEntries.context}->>'boardId'=${String(boardId)}`))
    .orderBy(desc(trashEntries.deletedAt), desc(trashEntries.id));
  const result = [];
  for (const { entry, name, username } of rows) {
    const context = attachmentTrashContext(entry.context);
    if (!isCardAttachmentVisible(context.attachment, visible)) continue;
    const [card] = await db.select({ id: cards.id, title: cards.title, number: cards.number, lockedAt: cards.lockedAt }).from(cards).where(and(activeRows.cards, eq(cards.id, context.cardId), eq(cards.boardId, boardId)));
    // Deliberately return display metadata only, never paths or unfiltered JSON.
    result.push({ id: entry.id, filename: entry.label, deletedAt: entry.deletedAt, expiresAt: entry.expiresAt,
      state: entry.state, lastError: entry.lastError, deletedBy: name || username || "Nicht mehr verfügbar",
      cardId: card?.id ?? null, cardTitle: card?.title ?? context.cardTitle,
      cardNumber: visible.has("number") ? card ? card.number : context.cardNumber : null,
      locked: !!card?.lockedAt, restorable: !!card && !card.lockedAt && entry.state === "trashed" && entry.expiresAt > new Date(),
    });
  }
  return result;
}

export async function restoreBoardAttachment(user: User, boardId: number, id: number, confirmation: unknown) {
  if (typeof confirmation !== "string" || confirmation.trim() !== "WIEDERHERSTELLEN") throw new TrashError("Bitte WIEDERHERSTELLEN genau so eingeben.");
  if (!Number.isSafeInteger(boardId) || boardId < 1 || !Number.isSafeInteger(id) || id < 1) throw new TrashError("Ungültiger Datei-Eintrag.");
  // Verify storage outside the transaction; all state/permissions are rechecked
  // under the entry lock, so a concurrent purge cannot create a dangling file.
  const [candidate] = await db.select().from(trashEntries).where(and(eq(trashEntries.id, id), eq(trashEntries.kind, "attachment")));
  if (!candidate) throw new TrashError("Die Datei liegt nicht mehr im Papierkorb.");
  const initial = attachmentTrashContext(candidate.context);
  const board = await getBoardById(boardId);
  if (initial.boardId !== boardId || !board || !await canAccessBoard(user, board, "write") || !isCardAttachmentVisible(initial.attachment, await getVisibleFieldKeys(boardId))) throw new TrashError("Kein Zugriff auf diese Datei.");
  try { await access(absPath(initial.attachment.path)); } catch { throw new TrashError("Die gespeicherte Datei fehlt. Wiederherstellung nicht möglich."); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const entry = (await client.query("select * from trash_entries where id=$1 and kind='attachment' for update", [id])).rows[0];
    if (!entry || entry.state !== "trashed") throw new TrashError("Die Datei liegt nicht mehr im Papierkorb.");
    if (new Date(entry.expires_at).getTime() <= Date.now()) throw new TrashError("Die Wiederherstellungsfrist von 30 Tagen ist abgelaufen.");
    const context = await authorizeAttachmentTrash(client, user, entry.context, boardId);
    const card = (await client.query("select * from cards where id=$1 and board_id=$2 and deleted_at is null for update", [context.cardId, boardId])).rows[0];
    if (!card) throw new TrashError("Die ursprüngliche Karte wurde gelöscht. Die Datei kann nicht wiederhergestellt werden.");
    if (card.locked_at) throw new TrashError("Die ursprüngliche Karte ist dauerhaft gesperrt. Eine Wiederherstellung würde ihre eingefrorenen Inhalte verändern.");
    const file = context.attachment;
    if (file.kind !== "other" && (await client.query("select 1 from attachments where card_id=$1 and kind=$2", [card.id, file.kind])).rowCount) throw new TrashError("Dieser Dateibereich ist bereits belegt. Bitte die aktuelle Datei zuerst in den Papierkorb verschieben; es wird nichts überschrieben.");
    // Deleted folders are not recreated implicitly; restore at the card root.
    const folder = file.folderId == null ? null : (await client.query("select id from attachment_folders where id=$1 and card_id=$2", [file.folderId, card.id])).rows[0];
    const uploader = file.uploadedBy == null ? null : (await client.query("select id from users where id=$1", [file.uploadedBy])).rows[0];
    await client.query("insert into attachments(id,card_id,kind,upload_purpose,folder_id,filename,path,mime,size,uploaded_at,uploaded_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [file.id, card.id, file.kind, file.uploadPurpose, folder?.id ?? null, file.filename, file.path, file.mime, file.size, file.uploadedAt, uploader?.id ?? null]);
    await client.query("update cards set updated_at=now() where id=$1", [card.id]);
    await client.query("insert into card_activity(card_id,user_id,type,detail) values($1,$2,'attachment_restored',$3)", [card.id, user.id, `Aus dem Papierkorb wiederhergestellt: ${file.filename}`]);
    await client.query("update trash_entries set state='restored',finished_at=now(),finished_by=$2,last_error=null,context='{}',cleanup_paths='[]' where id=$1", [id, user.id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
