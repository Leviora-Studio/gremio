// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boards, boardStatuses, cards, cardActivity, type User } from "@/lib/db/schema";
import { canEditBoard } from "@/lib/authz";
import { maybeArchive } from "@/lib/archive";
export async function lockApplicationCard(user: User, cardId: number, expectedStatusId: number) {
    if (!Number.isSafeInteger(cardId) || cardId < 1 || cardId > 2147483647 || !Number.isSafeInteger(expectedStatusId))
        throw new Error("Ungültige Karte.");
    await db.transaction(async (tx) => {
        const [identity] = await tx.select({ boardId: cards.boardId }).from(cards).where(trashAnd(activeRows.cards, eq(cards.id, cardId)));
        if (!identity)
            throw new Error("Karte nicht verfügbar.");
        const [board] = await tx.select().from(boards).where(trashAnd(activeRows.boards, eq(boards.id, identity.boardId))).for("share");
        if (!board?.isApplicationBoard || board.inventoryBoardId != null || !await canEditBoard(user, board))
            throw new Error("Kein Schreibzugriff auf dieses Antragsboard.");
        const [card] = await tx.select().from(cards).where(trashAnd(activeRows.cards, and(eq(cards.id, cardId), eq(cards.boardId, board.id)))).for("update");
        if (!card)
            throw new Error("Karte nicht verfügbar.");
        if (card.lockedAt)
            return;
        const [status] = await tx.select().from(boardStatuses).where(trashAnd(activeRows.boardStatuses, and(eq(boardStatuses.id, card.statusId), eq(boardStatuses.isLockColumn, true)))).for("share");
        if (!status || card.statusId !== expectedStatusId)
            throw new Error("Die Spalte wurde geändert. Bitte neu laden.");
        await tx.update(cards).set({ lockedAt: new Date(), lockedBy: user.id, updatedAt: new Date() }).where(eq(cards.id, card.id));
        await tx.insert(cardActivity).values({ cardId: card.id, userId: user.id, type: "locked", detail: "Karte dauerhaft gesperrt und öffentlicher Status bestätigt" });
    });
    // The database trigger queues the archive in the lock transaction.
    // This post-commit call only accelerates delivery; the worker survives a lost call.
    // Shared by UI, REST and MCP, and idempotent for an already locked card.
    await maybeArchive(cardId);
}
