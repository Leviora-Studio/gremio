// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, max } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  financeBoards,
  financeBoardAccess,
  financeBoardAccounts,
  financeBoardSources,
  financePlanItems,
  financeTemplateItems,
  groups,
  userFinanceBoardOrder,
  users,
} from "@/lib/db/schema";
import { requireAdmin, requireUser } from "@/lib/auth";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import {
  getAccessibleFinanceBoards,
  requireFinanceManage,
} from "@/lib/finance";
import { parseEuroToCents } from "@/lib/money";

export type State = { error?: string; success?: string };

function rev(id: number) {
  revalidatePath(`/finanzen/${id}`);
  revalidatePath(`/finanzen/${id}/einstellungen`);
}

/** Drizzle-Transaktionstyp (für Helfer, die innerhalb einer TX arbeiten). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Kopiert die Positionen eines Finanz-Templates in den Haushaltsplan — in der
 * ÜBERGEBENEN Transaktion, damit Board-Anlage + Plan-Kopie atomar sind (sonst
 * bliebe bei Abbruch ein Finanzboard mit halbem Haushaltsplan zurück).
 */
async function copyFinanceTemplate(
  tx: Tx,
  templateId: number,
  financeBoardId: number,
): Promise<void> {
  const items = await tx
    .select()
    .from(financeTemplateItems)
    .where(eq(financeTemplateItems.templateId, templateId))
    .orderBy(asc(financeTemplateItems.position));
  const tops = items.filter((i) => i.parentId == null);
  for (const top of tops) {
    const [ins] = await tx
      .insert(financePlanItems)
      .values({
        financeBoardId,
        parentId: null,
        kind: top.kind,
        haushaltstitel: top.haushaltstitel,
        title: top.title,
        plannedAmount: top.plannedAmount,
        position: top.position,
      })
      .returning();
    for (const k of items.filter((i) => i.parentId === top.id)) {
      await tx.insert(financePlanItems).values({
        financeBoardId,
        parentId: ins.id,
        kind: k.kind,
        haushaltstitel: k.haushaltstitel,
        title: k.title,
        plannedAmount: k.plannedAmount,
        position: k.position,
      });
    }
  }
}

/** Persönliche Reihenfolge der Finanzübersichten speichern (nur zugängliche). */
export async function reorderFinanceBoardsAction(
  orderedIds: number[],
): Promise<void> {
  const user = await requireUser();
  const accessible = new Set(
    (await getAccessibleFinanceBoards(user)).map((b) => b.id),
  );
  const valid = orderedIds.filter((id) => accessible.has(id));
  await db.transaction(async (tx) => {
    for (let i = 0; i < valid.length; i++) {
      await tx
        .insert(userFinanceBoardOrder)
        .values({ userId: user.id, financeBoardId: valid[i], position: i })
        .onConflictDoUpdate({
          target: [
            userFinanceBoardOrder.userId,
            userFinanceBoardOrder.financeBoardId,
          ],
          set: { position: i },
        });
    }
  });
  revalidatePath("/finanzen");
}

export async function createFinanceBoardAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Bitte einen Namen angeben." };
  const description =
    String(formData.get("description") ?? "").trim().slice(0, 500) || null;
  const templateId = Number(formData.get("templateId")) || null;
  const newId = await db.transaction(async (tx) => {
    const [fb] = await tx
      .insert(financeBoards)
      .values({ name: name.slice(0, 120), description, ownerId: user.id })
      .returning();
    if (templateId) await copyFinanceTemplate(tx, templateId, fb.id);
    return fb.id;
  });
  redirect(`/finanzen/${newId}/einstellungen`);
}

export async function renameFinanceBoardAction(
  id: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  await requireFinanceManage(id);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name erforderlich." };
  const description =
    String(formData.get("description") ?? "").trim().slice(0, 500) || null;
  await db
    .update(financeBoards)
    .set({ name: name.slice(0, 120), description })
    .where(eq(financeBoards.id, id));
  rev(id);
  return { success: "Gespeichert." };
}

export async function deleteFinanceBoardAction(id: number): Promise<void> {
  await requireFinanceManage(id);
  await db.delete(financeBoards).where(eq(financeBoards.id, id));
  redirect("/finanzen");
}

/** Eigentum übertragen (Owner ODER Admin). */
export async function transferFinanceOwnerAction(
  id: number,
  formData: FormData,
): Promise<void> {
  await requireFinanceManage(id);
  const newOwnerId = Number(formData.get("ownerId"));
  if (!newOwnerId) return;
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, newOwnerId), eq(users.isActive, true)))
    .limit(1);
  if (!u) return;
  await db
    .update(financeBoards)
    .set({ ownerId: newOwnerId })
    .where(eq(financeBoards.id, id));
  rev(id);
}

/** Admin-Löschen aus dem Admin-Panel (ohne Redirect zur Finanzliste). */
export async function deleteFinanceBoardAdminAction(id: number): Promise<void> {
  await requireAdmin();
  await db.delete(financeBoards).where(eq(financeBoards.id, id));
  revalidatePath("/admin/finanzboards");
}

/** Betroffenes Konto hinzufügen (n:m) — mehrere Konten je Finanzboard möglich. */
export async function addFinanceAccountAction(
  id: number,
  formData: FormData,
): Promise<void> {
  await requireFinanceManage(id);
  const accountId = Number(formData.get("accountId"));
  if (!accountId) return;
  const [acc] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!acc) return; // ungültige accountId (manipuliert) → No-op statt FK-500
  await db
    .insert(financeBoardAccounts)
    .values({ financeBoardId: id, accountId })
    .onConflictDoNothing();
  rev(id);
}

export async function removeFinanceAccountAction(
  id: number,
  accountId: number,
): Promise<void> {
  await requireFinanceManage(id);
  await db
    .delete(financeBoardAccounts)
    .where(
      and(
        eq(financeBoardAccounts.financeBoardId, id),
        eq(financeBoardAccounts.accountId, accountId),
      ),
    );
  rev(id);
}

export async function addFinanceSourceAction(
  id: number,
  formData: FormData,
): Promise<void> {
  const { user } = await requireFinanceManage(id);
  const boardId = Number(formData.get("boardId"));
  if (!boardId) return;
  const board = await getBoardById(boardId);
  if (!board || !(await canAccessBoard(user, board))) return; // nur eigene Boards
  await db
    .insert(financeBoardSources)
    .values({ financeBoardId: id, boardId })
    .onConflictDoNothing();
  rev(id);
}

export async function removeFinanceSourceAction(
  id: number,
  boardId: number,
): Promise<void> {
  await requireFinanceManage(id);
  await db
    .delete(financeBoardSources)
    .where(
      and(
        eq(financeBoardSources.financeBoardId, id),
        eq(financeBoardSources.boardId, boardId),
      ),
    );
  rev(id);
}

// --- Freigaben ----------------------------------------------------------
export async function addFinanceAccessUserAction(
  id: number,
  formData: FormData,
): Promise<void> {
  await requireFinanceManage(id);
  const userId = Number(formData.get("userId"));
  if (!userId) return;
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return; // ungültige userId (manipuliert) → No-op statt FK-500
  const exists = await db
    .select({ id: financeBoardAccess.id })
    .from(financeBoardAccess)
    .where(
      and(
        eq(financeBoardAccess.financeBoardId, id),
        eq(financeBoardAccess.userId, userId),
      ),
    )
    .limit(1);
  if (!exists.length) {
    await db.insert(financeBoardAccess).values({ financeBoardId: id, userId });
  }
  rev(id);
}

export async function addFinanceAccessGroupAction(
  id: number,
  formData: FormData,
): Promise<void> {
  await requireFinanceManage(id);
  const groupId = Number(formData.get("groupId"));
  if (!groupId) return;
  const [g] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!g) return; // ungültige groupId (manipuliert) → No-op statt FK-500
  const exists = await db
    .select({ id: financeBoardAccess.id })
    .from(financeBoardAccess)
    .where(
      and(
        eq(financeBoardAccess.financeBoardId, id),
        eq(financeBoardAccess.groupId, groupId),
      ),
    )
    .limit(1);
  if (!exists.length) {
    await db
      .insert(financeBoardAccess)
      .values({ financeBoardId: id, groupId });
  }
  rev(id);
}

export async function removeFinanceAccessAction(
  id: number,
  accessId: number,
): Promise<void> {
  await requireFinanceManage(id);
  await db
    .delete(financeBoardAccess)
    .where(
      and(
        eq(financeBoardAccess.id, accessId),
        eq(financeBoardAccess.financeBoardId, id),
      ),
    );
  rev(id);
}

// --- Haushaltsplan ------------------------------------------------------
export async function addPlanItemAction(
  id: number,
  parentId: number | null,
  kind: "income" | "expense" = "expense",
): Promise<void> {
  await requireFinanceManage(id);
  // Unterpunkte erben das Kind (Einnahme/Ausgabe) ihres Oberpunkts.
  let effectiveKind: "income" | "expense" = kind === "income" ? "income" : "expense";
  if (parentId) {
    const [p] = await db
      .select({
        kind: financePlanItems.kind,
        boardId: financePlanItems.financeBoardId,
      })
      .from(financePlanItems)
      .where(eq(financePlanItems.id, parentId))
      .limit(1);
    // Oberpunkt muss zu DIESEM Finanzboard gehören (keine board-übergreifende
    // Verknüpfung über manipuliertes parentId).
    if (!p || p.boardId !== id) return;
    effectiveKind = p.kind;
  }
  const [row] = await db
    .select({ m: max(financePlanItems.position) })
    .from(financePlanItems)
    .where(eq(financePlanItems.financeBoardId, id));
  await db.insert(financePlanItems).values({
    financeBoardId: id,
    parentId: parentId ?? null,
    kind: effectiveKind,
    position: (row?.m ?? -1) + 1,
  });
  rev(id);
}

async function planItemBoardId(itemId: number): Promise<number | null> {
  const [it] = await db
    .select({ fb: financePlanItems.financeBoardId })
    .from(financePlanItems)
    .where(eq(financePlanItems.id, itemId))
    .limit(1);
  return it?.fb ?? null;
}

export async function editPlanItemAction(
  itemId: number,
  _prev: State,
  formData: FormData,
): Promise<State> {
  const fbId = await planItemBoardId(itemId);
  if (!fbId) return { error: "Position nicht gefunden." };
  await requireFinanceManage(fbId);
  const haushaltstitel = String(formData.get("haushaltstitel") ?? "").slice(0, 60);
  const title = String(formData.get("title") ?? "").slice(0, 200);
  const rawAmount = String(formData.get("plannedAmount") ?? "").trim();
  const plannedAmount = parseEuroToCents(rawAmount);
  // Nicht-leere, aber ungültige/zu große Eingabe NICHT still als „leer" speichern.
  if (rawAmount !== "" && plannedAmount === null) {
    return { error: "Betrag ungültig oder zu groß (max. 20.000.000,00 €)." };
  }
  await db
    .update(financePlanItems)
    .set({ haushaltstitel, title, plannedAmount })
    .where(eq(financePlanItems.id, itemId));
  rev(fbId);
  return { success: "Gespeichert." };
}

export async function deletePlanItemAction(itemId: number): Promise<void> {
  const fbId = await planItemBoardId(itemId);
  if (!fbId) return;
  await requireFinanceManage(fbId);
  await db.delete(financePlanItems).where(eq(financePlanItems.id, itemId));
  rev(fbId);
}
