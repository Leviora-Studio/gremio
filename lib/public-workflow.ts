import { and, eq, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, boards, boardStatuses, cards } from "@/lib/db/schema";
import { MAX_PUBLIC_OTHER_FILES } from "@/lib/constants";
import { nextReceiptIndex, receiptFileName, saveAntragFile, deleteStoredFile } from "@/lib/attachments";
import { doneSinceForStatus } from "@/lib/done-archive";

export type UploadPurpose = "general" | "resubmission" | "receipt";
export class PublicWorkflowError extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function publicGates(archive: boolean, receipt: boolean, statusId: number, board: { resubmitStatusId: number | null; receiptToStatusId: number | null }, validTarget: boolean) {
  return { canUploadDocuments: !archive, canResubmit: !archive && board.resubmitStatusId === statusId,
    canReceipt: !archive && receipt && board.receiptToStatusId != null && validTarget };
}

async function lockedWorkflow(tx: Tx, cardId: number) {
  // Row locks also serialize against ordinary internal card moves. Recheck
  // gates AFTER locking; advisory locks alone do not protect against moves.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${0x5055}, ${cardId})`);
  const [identity] = await tx.select({ boardId: cards.boardId }).from(cards).where(eq(cards.id, cardId));
  if (!identity) throw new PublicWorkflowError("Antrag nicht gefunden.");
  const [board] = await tx.select().from(boards).where(eq(boards.id, identity.boardId)).for("share");
  const [card] = await tx.select().from(cards).where(eq(cards.id, cardId)).for("update");
  if (!card) throw new PublicWorkflowError("Antrag nicht gefunden.");
  const statuses = await tx.select().from(boardStatuses).where(eq(boardStatuses.boardId, card.boardId)).for("share");
  const status = statuses.find((s) => s.id === card.statusId);
  if (!board || !status || board.inventoryBoardId != null) throw new PublicWorkflowError("Antrag nicht gefunden.");
  const gates = publicGates(status.isArchiveTrigger, status.isReceiptTrigger, card.statusId, board, statuses.some((s) => s.id === board.receiptToStatusId));
  if (!gates.canUploadDocuments) throw new PublicWorkflowError("Dieser Antrag ist bereits archiviert. Es können keine Dateien mehr eingereicht werden.");
  return { card, board, gates };
}

export async function insertPublicAttachment(cardId: number, purpose: UploadPurpose, saved: { filename: string; relPath: string; mime: string; size: number }) {
  return db.transaction(async (tx) => {
    const { card, gates } = await lockedWorkflow(tx, cardId);
    if ((purpose === "receipt" && !gates.canReceipt) || (purpose === "resubmission" && !gates.canResubmit)) throw new PublicWorkflowError("Dieser Einreichungsbereich ist aktuell nicht freigeschaltet.");
    const existing = await tx.select({ filename: attachments.filename }).from(attachments).where(and(eq(attachments.cardId, cardId), eq(attachments.kind, "other")));
    if (existing.length >= MAX_PUBLIC_OTHER_FILES) throw new PublicWorkflowError("Maximale Anzahl an Dateien erreicht.");
    const filename = purpose === "receipt" ? receiptFileName(card.number, nextReceiptIndex(card.number, existing.map((a) => a.filename)), saved.filename) : saved.filename;
    await tx.insert(attachments).values({ cardId, kind: "other", uploadPurpose: purpose, filename, path: saved.relPath, mime: saved.mime, size: saved.size, uploadedBy: null });
    await tx.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, cardId));
    return filename;
  });
}

/** File IO precedes the short transaction. Any failed DB association removes
 * exactly that new file; existing attachments are never touched. */
export async function storePublicAttachment(cardId: number, purpose: UploadPurpose, file: File, dependencies = {
  save: saveAntragFile, insert: insertPublicAttachment, remove: deleteStoredFile,
}) {
  const saved = await dependencies.save(cardId, file);
  try { return await dependencies.insert(cardId, purpose, saved); }
  catch (error) { await dependencies.remove(saved.relPath); throw error; }
}

export async function submitPublicWorkflow(cardId: number, purpose: "receipt" | "resubmission") {
  return db.transaction(async (tx) => {
    const { card, board, gates } = await lockedWorkflow(tx, cardId);
    if (purpose === "resubmission") {
      if (!gates.canResubmit) throw new PublicWorkflowError("Nachreichung ist aktuell nicht freigeschaltet.");
      await tx.update(cards).set({ resubmittedAt: new Date(), updatedAt: new Date() }).where(eq(cards.id, cardId));
      return { boardId: board.id, target: null };
    }
    if (!gates.canReceipt || board.receiptToStatusId == null) throw new PublicWorkflowError("Quittungseinreichung ist aktuell nicht freigeschaltet.");
    const target = board.receiptToStatusId;
    const [row] = await tx.select({ m: max(cards.position) }).from(cards).where(and(eq(cards.boardId, board.id), eq(cards.statusId, target)));
    await tx.update(cards).set({ statusId: target, position: (row?.m ?? -1) + 1, resubmittedAt: null, doneSince: doneSinceForStatus(board.doneStatusId, target, card.doneSince), updatedAt: new Date() }).where(eq(cards.id, cardId));
    return { boardId: board.id, target };
  });
}
