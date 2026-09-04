import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { boards, boardStatuses } from "@/lib/db/schema";

/** Caller must require board management. Validate and replace atomically. */
export async function setBoardTriggerSources(boardId: number, kind: "archive" | "receipt", input: unknown[]) {
  const ids = [...new Set(input.map(Number))];
  return db.transaction(async (tx) => {
    const [board] = await tx.select({ id: boards.id }).from(boards).where(eq(boards.id, boardId)).for("update");
    const statuses = await tx.select({ id: boardStatuses.id }).from(boardStatuses).where(eq(boardStatuses.boardId, boardId)).for("update");
    if (!board || ids.some((id) => !Number.isInteger(id) || !statuses.some((s) => s.id === id))) return { error: "Bitte ausschließlich Spalten dieses Boards auswählen." };
    if (kind === "receipt") await tx.update(boards).set({ receiptFromStatusId: null }).where(eq(boards.id, boardId));
    const field = kind === "archive" ? "isArchiveTrigger" : "isReceiptTrigger";
    await tx.update(boardStatuses).set({ [field]: false }).where(eq(boardStatuses.boardId, boardId));
    if (ids.length) await tx.update(boardStatuses).set({ [field]: true }).where(inArray(boardStatuses.id, ids));
    return { success: "Trigger gespeichert." };
  });
}
