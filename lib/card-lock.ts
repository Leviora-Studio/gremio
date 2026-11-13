// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boards, boardStatuses, cards, cardActivity, type User } from "@/lib/db/schema";
import { canEditBoard } from "@/lib/authz";
export async function lockApplicationCard(user: User, cardId: number, expectedStatusId: number) {
    if (!Number.isSafeInteger(cardId) || cardId < 1 || cardId > 2147483647 || !Number.isSafeInteger(expectedStatusId))
        throw new Error("Ungültige Karte.");
    return db.transaction(async (tx) => {
        const [identity] = await tx.select({ boardId: cards.boardId }).from(cards).where(eq(cards.id, cardId));
        if (!identity)
            throw new Error("Karte nicht verfügbar.");
        const [board] = await tx.select().from(boards).where(eq(boards.id, identity.boardId)).for("share");
        if (!board?.isApplicationBoard || board.inventoryBoardId != null || !await canEditBoard(user, board))
            throw new Error("Kein Schreibzugriff auf dieses Antragsboard.");
        const [card] = await tx.select().from(cards).where(and(eq(cards.id, cardId), eq(cards.boardId, board.id))).for("update");
        if (!card)
            throw new Error("Karte nicht verfügbar.");
        if (card.lockedAt)
            return;
        const [status] = await tx.select().from(boardStatuses).where(and(eq(boardStatuses.id, card.statusId), eq(boardStatuses.isLockColumn, true))).for("share");
        if (!status || card.statusId !== expectedStatusId)
            throw new Error("Die Spalte wurde geändert. Bitte neu laden.");
        await tx.update(cards).set({ lockedAt: new Date(), lockedBy: user.id, updatedAt: new Date() }).where(eq(cards.id, card.id));
        await tx.insert(cardActivity).values({ cardId: card.id, userId: user.id, type: "locked", detail: "Karte dauerhaft gesperrt und öffentlicher Status bestätigt" });
    });
}
