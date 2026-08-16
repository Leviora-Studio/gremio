// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, eq, inArray, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  inventoryBoardAccess,
  inventoryBoardFields,
  inventoryBoards,
  inventoryNumbering,
  type InventoryBoard,
  type User,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getUserGroupIds } from "@/lib/authz";
import { INVENTORY_FIELD_KEYS } from "@/lib/inventory-fields";

// Zugriffsmodell der Inventar-Boards = identisch zu den Kanban-Boards:
// admin ODER Eigentümer ODER Freigabe an Nutzer/Gruppe (binär, kein Lese-/
// Schreib-Unterschied). Verwalten (Struktur/Freigaben/löschen) = admin ODER
// Eigentümer.

/** Sehen + bearbeiten eines Inventar-Boards. */
export async function canAccessInventoryBoard(
  user: User,
  board: InventoryBoard,
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (board.ownerId === user.id) return true;
  const groupIds = await getUserGroupIds(user.id);
  const rows = await db
    .select({ id: inventoryBoardAccess.id })
    .from(inventoryBoardAccess)
    .where(
      and(
        eq(inventoryBoardAccess.boardId, board.id),
        or(
          eq(inventoryBoardAccess.userId, user.id),
          groupIds.length
            ? inArray(inventoryBoardAccess.groupId, groupIds)
            : undefined,
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Verwalten (umbenennen, Felder/Nummerierung, Freigaben, löschen). */
export function canManageInventoryBoard(
  user: User,
  board: InventoryBoard,
): boolean {
  return user.role === "admin" || board.ownerId === user.id;
}

/** Alle Inventar-Boards, die ein Nutzer sehen darf (Admin: alle). */
export async function getAccessibleInventoryBoards(
  user: User,
): Promise<InventoryBoard[]> {
  if (user.role === "admin") {
    return db.select().from(inventoryBoards).orderBy(inventoryBoards.name);
  }
  const groupIds = await getUserGroupIds(user.id);
  const ownerRows = await db
    .select({ id: inventoryBoards.id })
    .from(inventoryBoards)
    .where(eq(inventoryBoards.ownerId, user.id));
  const userRows = await db
    .select({ id: inventoryBoardAccess.boardId })
    .from(inventoryBoardAccess)
    .where(eq(inventoryBoardAccess.userId, user.id));
  const groupRows = groupIds.length
    ? await db
        .select({ id: inventoryBoardAccess.boardId })
        .from(inventoryBoardAccess)
        .where(inArray(inventoryBoardAccess.groupId, groupIds))
    : [];
  const ids = Array.from(
    new Set([...ownerRows, ...userRows, ...groupRows].map((r) => r.id)),
  );
  if (!ids.length) return [];
  return db
    .select()
    .from(inventoryBoards)
    .where(inArray(inventoryBoards.id, ids))
    .orderBy(inventoryBoards.name);
}

export async function getInventoryBoardById(
  boardId: number,
): Promise<InventoryBoard | undefined> {
  if (!Number.isInteger(boardId)) return undefined;
  const rows = await db
    .select()
    .from(inventoryBoards)
    .where(eq(inventoryBoards.id, boardId))
    .limit(1);
  return rows[0];
}

/** Guard: Login + Inventar-Board-Zugriff. 404 sonst. */
export async function requireInventoryBoardAccess(
  boardId: number,
): Promise<{ user: User; board: InventoryBoard }> {
  const user = await requireUser();
  const board = await getInventoryBoardById(boardId);
  if (!board || !(await canAccessInventoryBoard(user, board))) notFound();
  return { user, board };
}

/** Guard: Login + Inventar-Board-Verwaltungsrecht (Eigentümer/Admin). 404 sonst. */
export async function requireInventoryBoardManage(
  boardId: number,
): Promise<{ user: User; board: InventoryBoard }> {
  const user = await requireUser();
  const board = await getInventoryBoardById(boardId);
  if (!board || !canManageInventoryBoard(user, board)) notFound();
  return { user, board };
}

/**
 * Neues Inventar-Board anlegen (Ersteller = Eigentümer). Setzt alle Felder
 * sichtbar und legt die (deaktivierte) Nummerierung an. Gibt die ID zurück.
 */
export async function createInventoryBoard(
  ownerId: number,
  name: string,
  description: string | null,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [board] = await tx
      .insert(inventoryBoards)
      .values({ name, description, ownerId })
      .returning({ id: inventoryBoards.id });

    for (let i = 0; i < INVENTORY_FIELD_KEYS.length; i++) {
      await tx.insert(inventoryBoardFields).values({
        boardId: board.id,
        fieldKey: INVENTORY_FIELD_KEYS[i],
        visible: true,
        position: i,
      });
    }
    await tx.insert(inventoryNumbering).values({ boardId: board.id });
    return board.id;
  });
}
