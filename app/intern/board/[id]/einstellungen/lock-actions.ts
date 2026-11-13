// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { boards, boardStatuses } from "@/lib/db/schema";
import { requireBoardManage } from "@/lib/authz";
export async function saveLockColumnsAction(boardId: number, _previous: {
    error?: string;
    success?: string;
}, data: FormData) {
    const { board } = await requireBoardManage(boardId);
    if (!board.isApplicationBoard || board.inventoryBoardId != null)
        return { error: "Diese Einstellung ist nur auf Antragsboards verfügbar." };
    const ids = data.getAll("statusId").map(Number), completed = Number(data.get("completedStatusId")) || null;
    const statuses = await db.select({ id: boardStatuses.id }).from(boardStatuses).where(eq(boardStatuses.boardId, boardId));
    if ([...ids, ...(completed ? [completed] : [])].some(id => !statuses.some(s => s.id === id)))
        return { error: "Bitte nur Spalten dieses Boards auswählen." };
    await db.transaction(async (tx) => {
        await tx.select({ id: boards.id }).from(boards).where(eq(boards.id, boardId)).for("update");
        await tx.update(boardStatuses).set({ isLockColumn: false }).where(eq(boardStatuses.boardId, boardId));
        if (ids.length)
            await tx.update(boardStatuses).set({ isLockColumn: true }).where(and(eq(boardStatuses.boardId, boardId), inArray(boardStatuses.id, ids)));
        await tx.update(boards).set({ completedStatusId: completed }).where(eq(boards.id, boardId));
    });
    revalidatePath(`/intern/board/${boardId}`, "layout");
    return { success: "Gespeichert." };
}
