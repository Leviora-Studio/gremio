// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  boardAccess,
  boards,
  inventoryBoardAccess,
  inventoryBoards,
  userGroups,
  users,
  type Board,
  type User,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";

/** Gruppen-IDs eines Nutzers. */
export async function getUserGroupIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ groupId: userGroups.groupId })
    .from(userGroups)
    .where(eq(userGroups.userId, userId));
  return rows.map((r) => r.groupId);
}

/**
 * Zugriff auf ein Inventar-Board (Eigentümer ODER Freigabe an Nutzer/Gruppe).
 * Hier inline gehalten, damit die Zugriffslogik der Leihvorgang-System-Boards
 * das Inventar spiegelt, ohne Import-Zyklus mit lib/inventory.
 */
async function canAccessInventoryBoardById(
  user: User,
  inventoryBoardId: number,
): Promise<boolean> {
  const [inv] = await db
    .select({ ownerId: inventoryBoards.ownerId })
    .from(inventoryBoards)
    .where(eq(inventoryBoards.id, inventoryBoardId))
    .limit(1);
  if (!inv) return false;
  if (inv.ownerId === user.id) return true;
  const groupIds = await getUserGroupIds(user.id);
  const rows = await db
    .select({ id: inventoryBoardAccess.id })
    .from(inventoryBoardAccess)
    .where(
      and(
        eq(inventoryBoardAccess.boardId, inventoryBoardId),
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

/**
 * Sehen + Karten bearbeiten:
 * admin ODER Eigentümer ODER Freigabe an Nutzer ODER an eine seiner Gruppen.
 */
export async function canAccessBoard(
  user: User,
  board: Board,
): Promise<boolean> {
  if (user.role === "admin") return true;
  // System-Board (Leihvorgänge): Zugriff spiegelt das verknüpfte Inventar.
  if (board.inventoryBoardId != null) {
    return canAccessInventoryBoardById(user, board.inventoryBoardId);
  }
  if (board.ownerId === user.id) return true;

  const groupIds = await getUserGroupIds(user.id);
  const rows = await db
    .select({ id: boardAccess.id })
    .from(boardAccess)
    .where(
      and(
        eq(boardAccess.boardId, board.id),
        or(
          eq(boardAccess.userId, user.id),
          groupIds.length ? inArray(boardAccess.groupId, groupIds) : undefined,
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Verwalten (umbenennen, Stati, Freigaben, Nextcloud, löschen): admin ODER Eigentümer. */
export function canManageBoard(user: User, board: Board): boolean {
  return user.role === "admin" || board.ownerId === user.id;
}

/** Alle Boards, die ein Nutzer sehen darf (Admin: alle). */
export async function getAccessibleBoards(user: User): Promise<Board[]> {
  if (user.role === "admin") {
    return db.select().from(boards).orderBy(boards.name);
  }

  const groupIds = await getUserGroupIds(user.id);
  const ownerRows = await db
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.ownerId, user.id));
  const userRows = await db
    .select({ id: boardAccess.boardId })
    .from(boardAccess)
    .where(eq(boardAccess.userId, user.id));
  const groupRows = groupIds.length
    ? await db
        .select({ id: boardAccess.boardId })
        .from(boardAccess)
        .where(inArray(boardAccess.groupId, groupIds))
    : [];

  // System-Boards (Leihvorgänge): über die zugänglichen Inventare einbeziehen,
  // damit Freigaben identisch zum Inventar wirken.
  const invOwner = await db
    .select({ id: inventoryBoards.id })
    .from(inventoryBoards)
    .where(eq(inventoryBoards.ownerId, user.id));
  const invUser = await db
    .select({ id: inventoryBoardAccess.boardId })
    .from(inventoryBoardAccess)
    .where(eq(inventoryBoardAccess.userId, user.id));
  const invGroup = groupIds.length
    ? await db
        .select({ id: inventoryBoardAccess.boardId })
        .from(inventoryBoardAccess)
        .where(inArray(inventoryBoardAccess.groupId, groupIds))
    : [];
  const invIds = Array.from(
    new Set([...invOwner, ...invUser, ...invGroup].map((r) => r.id)),
  );
  const sysRows = invIds.length
    ? await db
        .select({ id: boards.id })
        .from(boards)
        .where(inArray(boards.inventoryBoardId, invIds))
    : [];

  const ids = Array.from(
    new Set(
      [...ownerRows, ...userRows, ...groupRows, ...sysRows].map((r) => r.id),
    ),
  );
  if (!ids.length) return [];
  return db
    .select()
    .from(boards)
    .where(inArray(boards.id, ids))
    .orderBy(boards.name);
}

export async function getBoardById(boardId: number): Promise<Board | undefined> {
  if (!Number.isInteger(boardId)) return undefined; // NaN/ungültige ID → 404
  const rows = await db
    .select()
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1);
  return rows[0];
}

/** Alle aktiven Nutzer mit Zugriff auf das Board (Eigentümer + Admins + Freigaben + Gruppenmitglieder). */
export async function getBoardMemberUsers(
  board: Board,
): Promise<
  { id: number; username: string; name: string | null; avatarPath: string | null }[]
> {
  const adminRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)));

  // System-Board (Leihvorgänge): Mitglieder = Mitglieder des Inventars.
  let ownerId = board.ownerId;
  let directRows: { id: number | null }[];
  let groupMemberRows: { id: number }[];
  if (board.inventoryBoardId != null) {
    const invId = board.inventoryBoardId;
    const [inv] = await db
      .select({ ownerId: inventoryBoards.ownerId })
      .from(inventoryBoards)
      .where(eq(inventoryBoards.id, invId))
      .limit(1);
    if (inv) ownerId = inv.ownerId;
    directRows = await db
      .select({ id: inventoryBoardAccess.userId })
      .from(inventoryBoardAccess)
      .where(
        and(
          eq(inventoryBoardAccess.boardId, invId),
          isNotNull(inventoryBoardAccess.userId),
        ),
      );
    groupMemberRows = await db
      .select({ id: userGroups.userId })
      .from(userGroups)
      .innerJoin(
        inventoryBoardAccess,
        eq(inventoryBoardAccess.groupId, userGroups.groupId),
      )
      .where(eq(inventoryBoardAccess.boardId, invId));
  } else {
    directRows = await db
      .select({ id: boardAccess.userId })
      .from(boardAccess)
      .where(
        and(eq(boardAccess.boardId, board.id), isNotNull(boardAccess.userId)),
      );
    groupMemberRows = await db
      .select({ id: userGroups.userId })
      .from(userGroups)
      .innerJoin(boardAccess, eq(boardAccess.groupId, userGroups.groupId))
      .where(eq(boardAccess.boardId, board.id));
  }

  const ids = Array.from(
    new Set<number>([
      ownerId,
      ...adminRows.map((r) => r.id),
      ...directRows.map((r) => r.id as number),
      ...groupMemberRows.map((r) => r.id),
    ]),
  );
  if (!ids.length) return [];
  return db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      avatarPath: users.avatarPath,
    })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)))
    .orderBy(users.username);
}

/** Guard: Login + Board-Zugriff. 404 sonst. */
export async function requireBoardAccess(
  boardId: number,
): Promise<{ user: User; board: Board }> {
  const user = await requireUser();
  const board = await getBoardById(boardId);
  if (!board || !(await canAccessBoard(user, board))) notFound();
  return { user, board };
}

/** Guard: Login + Board-Verwaltungsrecht (Eigentümer/Admin). 404 sonst. */
export async function requireBoardManage(
  boardId: number,
): Promise<{ user: User; board: Board }> {
  const user = await requireUser();
  const board = await getBoardById(boardId);
  if (!board || !canManageBoard(user, board)) notFound();
  // System-Boards (Leihvorgänge) haben KEINE normalen Board-Einstellungen — sie
  // werden über /intern/inventar/{id}/einstellungen verwaltet. Serverseitig hart
  // abweisen (nicht nur die Seite umleiten), damit Done-Spalte/Archiv-Trigger/
  // Nextcloud nie auf einem Leihboard scharfgeschaltet werden können (sonst
  // würde der Done-Sweep bzw. die Archivierung Leihkarten wegräumen).
  if (board.inventoryBoardId != null) notFound();
  return { user, board };
}
