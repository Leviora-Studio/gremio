// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { inventoryBoards } from "@/lib/db/schema";

/** Öffentliche Sichtbarkeit eines Inventars umschalten (nur Admin). */
export async function setInventoryBoardPublicAction(
  formData: FormData,
): Promise<void> {
  await requireAdmin();
  const boardId = Number(formData.get("boardId"));
  const isPublic = formData.get("isPublic") === "1";
  if (!Number.isInteger(boardId)) return;
  await db
    .update(inventoryBoards)
    .set({ isPublic })
    .where(eq(inventoryBoards.id, boardId));
  revalidatePath("/admin/inventar");
  revalidatePath("/inventar");
}
