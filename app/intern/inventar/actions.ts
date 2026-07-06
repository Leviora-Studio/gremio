// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { userInventoryBoardOrder } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import {
  createInventoryBoard,
  getAccessibleInventoryBoards,
} from "@/lib/inventory";

export type State = { error?: string };

const boardSchema = z.object({
  name: z.string().trim().min(1, "Name erforderlich.").max(120),
  description: z.string().trim().max(500).optional(),
});

export async function createInventoryBoardAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const user = await requireUser();
  const parsed = boardSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }
  const id = await createInventoryBoard(
    user.id,
    parsed.data.name,
    parsed.data.description ?? null,
  );
  redirect(`/intern/inventar/${id}`);
}

/** Persönliche Inventar-Reihenfolge speichern (nur zugängliche Boards). */
export async function reorderInventoryBoardsAction(
  orderedIds: number[],
): Promise<void> {
  const user = await requireUser();
  const accessible = new Set(
    (await getAccessibleInventoryBoards(user)).map((b) => b.id),
  );
  const valid = orderedIds.filter((id) => accessible.has(id));
  await db.transaction(async (tx) => {
    for (let i = 0; i < valid.length; i++) {
      await tx
        .insert(userInventoryBoardOrder)
        .values({ userId: user.id, boardId: valid[i], position: i })
        .onConflictDoUpdate({
          target: [
            userInventoryBoardOrder.userId,
            userInventoryBoardOrder.boardId,
          ],
          set: { position: i },
        });
    }
  });
  revalidatePath("/intern/inventar");
}
