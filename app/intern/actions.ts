// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { userBoardOrder } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getAccessibleBoards } from "@/lib/authz";

/** Persönliche Board-Reihenfolge speichern (nur zugängliche Boards). */
export async function reorderBoardsAction(orderedIds: number[]): Promise<void> {
  const user = await requireUser();
  const accessible = new Set((await getAccessibleBoards(user)).map((b) => b.id));
  const valid = orderedIds.filter((id) => accessible.has(id));
  await db.transaction(async (tx) => {
    for (let i = 0; i < valid.length; i++) {
      await tx
        .insert(userBoardOrder)
        .values({ userId: user.id, boardId: valid[i], position: i })
        .onConflictDoUpdate({
          target: [userBoardOrder.userId, userBoardOrder.boardId],
          set: { position: i },
        });
    }
  });
  revalidatePath("/intern");
}
