// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  userBoardOrder,
  userFinanceBoardOrder,
  userInventoryBoardOrder,
} from "@/lib/db/schema";

function applyOrder<T extends { id: number; name: string }>(
  boards: T[],
  pos: Map<number, number>,
): T[] {
  return [...boards].sort((a, b) => {
    const pa = pos.get(a.id);
    const pb = pos.get(b.id);
    // Gespeicherte Reihenfolge zuerst; neue (ungeordnete) Boards alphabetisch ans Ende.
    if (pa != null && pb != null) return pa - pb;
    if (pa != null) return -1;
    if (pb != null) return 1;
    return a.name.localeCompare(b.name, "de");
  });
}

/** Sortiert Boards nach der persönlichen Reihenfolge des Nutzers. */
export async function sortByUserBoardOrder<T extends { id: number; name: string }>(
  userId: number,
  boards: T[],
): Promise<T[]> {
  const rows = await db
    .select()
    .from(userBoardOrder)
    .where(eq(userBoardOrder.userId, userId));
  return applyOrder(boards, new Map(rows.map((r) => [r.boardId, r.position])));
}

/** Sortiert Finanzübersichten nach der persönlichen Reihenfolge des Nutzers. */
export async function sortByUserFinanceBoardOrder<
  T extends { id: number; name: string },
>(userId: number, boards: T[]): Promise<T[]> {
  const rows = await db
    .select()
    .from(userFinanceBoardOrder)
    .where(eq(userFinanceBoardOrder.userId, userId));
  return applyOrder(
    boards,
    new Map(rows.map((r) => [r.financeBoardId, r.position])),
  );
}

/** Sortiert Inventar-Boards nach der persönlichen Reihenfolge des Nutzers. */
export async function sortByUserInventoryBoardOrder<
  T extends { id: number; name: string },
>(userId: number, boards: T[]): Promise<T[]> {
  const rows = await db
    .select()
    .from(userInventoryBoardOrder)
    .where(eq(userInventoryBoardOrder.userId, userId));
  return applyOrder(boards, new Map(rows.map((r) => [r.boardId, r.position])));
}
