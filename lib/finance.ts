// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { and, eq, inArray, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  boards,
  financeBoardAccess,
  financeBoards,
  financeBoardSources,
  users,
  type Board,
  type FinanceBoard,
  type User,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canAccessBoard, getUserGroupIds } from "@/lib/authz";

/**
 * Quell-Boards eines Finanzboards, aufgeteilt danach, ob der **Eigentümer**
 * aktuell Zugriff darauf hat (Live-Prüfung). Die Finanzansicht zeigt nur die
 * Daten zugänglicher Quell-Boards; auf nicht-zugängliche wird hingewiesen.
 */
export async function resolveSourceBoards(fb: FinanceBoard): Promise<{
  accessible: { id: number; name: string }[];
  inaccessible: { id: number; name: string }[];
}> {
  const rows = await db
    .select({ id: boards.id, name: boards.name, ownerId: boards.ownerId })
    .from(financeBoardSources)
    .innerJoin(boards, eq(boards.id, financeBoardSources.boardId))
    .where(eq(financeBoardSources.financeBoardId, fb.id))
    .orderBy(boards.name);

  const [ownerUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, fb.ownerId))
    .limit(1);

  const accessible: { id: number; name: string }[] = [];
  const inaccessible: { id: number; name: string }[] = [];
  for (const r of rows) {
    const board = { id: r.id, ownerId: r.ownerId } as unknown as Board;
    if (ownerUser && (await canAccessBoard(ownerUser, board))) {
      accessible.push({ id: r.id, name: r.name });
    } else {
      inaccessible.push({ id: r.id, name: r.name });
    }
  }
  return { accessible, inaccessible };
}

export async function getFinanceBoardById(
  id: number,
): Promise<FinanceBoard | undefined> {
  if (!Number.isInteger(id)) return undefined; // NaN/ungültige ID → 404
  const [row] = await db
    .select()
    .from(financeBoards)
    .where(eq(financeBoards.id, id))
    .limit(1);
  return row;
}

/** Sehen: admin ODER Eigentümer ODER Freigabe (Nutzer/Gruppe). */
export async function canAccessFinanceBoard(
  user: User,
  fb: FinanceBoard,
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (fb.ownerId === user.id) return true;
  const groupIds = await getUserGroupIds(user.id);
  const rows = await db
    .select({ id: financeBoardAccess.id })
    .from(financeBoardAccess)
    .where(
      and(
        eq(financeBoardAccess.financeBoardId, fb.id),
        or(
          eq(financeBoardAccess.userId, user.id),
          groupIds.length
            ? inArray(financeBoardAccess.groupId, groupIds)
            : undefined,
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Verwalten (Name, Konto, Quellen, Freigaben, Plan, löschen): admin ODER Eigentümer. */
export function canManageFinanceBoard(user: User, fb: FinanceBoard): boolean {
  return user.role === "admin" || fb.ownerId === user.id;
}

export async function getAccessibleFinanceBoards(
  user: User,
): Promise<FinanceBoard[]> {
  if (user.role === "admin") {
    return db.select().from(financeBoards).orderBy(financeBoards.name);
  }
  const groupIds = await getUserGroupIds(user.id);
  const ownerRows = await db
    .select({ id: financeBoards.id })
    .from(financeBoards)
    .where(eq(financeBoards.ownerId, user.id));
  const userRows = await db
    .select({ id: financeBoardAccess.financeBoardId })
    .from(financeBoardAccess)
    .where(eq(financeBoardAccess.userId, user.id));
  const groupRows = groupIds.length
    ? await db
        .select({ id: financeBoardAccess.financeBoardId })
        .from(financeBoardAccess)
        .where(inArray(financeBoardAccess.groupId, groupIds))
    : [];
  const ids = Array.from(
    new Set([...ownerRows, ...userRows, ...groupRows].map((r) => r.id)),
  );
  if (!ids.length) return [];
  return db
    .select()
    .from(financeBoards)
    .where(inArray(financeBoards.id, ids))
    .orderBy(financeBoards.name);
}

export async function requireFinanceAccess(
  id: number,
): Promise<{ user: User; fb: FinanceBoard }> {
  const user = await requireUser();
  const fb = await getFinanceBoardById(id);
  if (!fb || !(await canAccessFinanceBoard(user, fb))) notFound();
  return { user, fb };
}

export async function requireFinanceManage(
  id: number,
): Promise<{ user: User; fb: FinanceBoard }> {
  const user = await requireUser();
  const fb = await getFinanceBoardById(id);
  if (!fb || !canManageFinanceBoard(user, fb)) notFound();
  return { user, fb };
}
