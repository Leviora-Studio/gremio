// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, boards, cards, cashbookEntries, type User } from "@/lib/db/schema";
import { canAccessBoard } from "@/lib/authz";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { isCardAttachmentVisible } from "@/lib/card-attachment-visibility";
import type { Cashbook } from "./access";
export async function cashbookCandidates(user: User, book: Cashbook) { const result = []; for (const boardId of book.config.sourceBoardIds) {
    const [board] = await db.select().from(boards).where(trashAnd(activeRows.boards, eq(boards.id, boardId)));
    if (!board?.isApplicationBoard || !await canAccessBoard(user, board))
        continue;
    const visible = await getVisibleFieldKeys(board.id);
    for (const card of await db.select().from(cards).where(trashAnd(activeRows.cards, eq(cards.boardId, boardId))).orderBy(asc(cards.id))) {
        if (!card.lockedAt)
            continue;
        const receipts = (await db.select({ id: attachments.id, filename: attachments.filename, kind:attachments.kind, uploadPurpose:attachments.uploadPurpose }).from(attachments).where(trashAnd(activeRows.attachments, and(eq(attachments.cardId, card.id), eq(attachments.kind,"other"), eq(attachments.mime,"application/pdf"), eq(attachments.uploadPurpose, "receipt")))).orderBy(asc(attachments.id))).filter(file=>isCardAttachmentVisible(file,visible)).map(file=>({id:file.id,filename:file.filename}));
        result.push({ id: card.id, label: [card.number, card.title].filter(Boolean).join(" · "), number: card.number ?? String(card.id), receipts });
    }
} return result; }
/** Book access is intentionally not required for the board's read-only payment summary. */
export async function postedCardBookings(cardId: number) { return db.select({ id: cashbookEntries.id, bookingNumber:cashbookEntries.bookingNumber, cashbookId: cashbookEntries.cashbookId, data: cashbookEntries.data, authorizedAt: cashbookEntries.authorizedAt, bookingDate: cashbookEntries.bookingDate, correctsId: cashbookEntries.correctsId }).from(cashbookEntries).where(trashAnd(activeRows.cashbookEntries, and(eq(cashbookEntries.state, "posted"), sql `${cashbookEntries.data}->>'cardId' = ${String(cardId)}`))).then(rows => rows.filter(r => r.data.cardId === cardId)); }
export function effectiveCashbookEntries<T extends {
    id: number;
    correctsId: number | null;
}>(entries: T[]) { const superseded = new Set(entries.flatMap(e => e.correctsId ? [e.correctsId] : [])); return entries.filter(e => !superseded.has(e.id)); }
