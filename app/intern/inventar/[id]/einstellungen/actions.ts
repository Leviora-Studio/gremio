// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  boards,
  groups,
  inventoryBoardAccess,
  inventoryBoardFields,
  inventoryBoards,
  inventoryNumbering,
  users,
} from "@/lib/db/schema";
import { requireInventoryBoardManage } from "@/lib/inventory";
import { createLoanBoardForInventory, deleteBoardCascade } from "@/lib/boards";
import { INVENTORY_FIELD_KEYS } from "@/lib/inventory-fields";

export type LoanBoardState = { error?: string; success?: string };

function clampInt(raw: FormDataEntryValue | null, min: number, max: number): number {
  const n = Number.parseInt(typeof raw === "string" ? raw : "", 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Sichtbare Felder des Boards setzen. */
export async function updateInventoryFieldsAction(formData: FormData) {
  const boardId = Number(formData.get("boardId"));
  await requireInventoryBoardManage(boardId);
  const checked = new Set(formData.getAll("visible").map(String));
  // Upsert: ältere Boards haben evtl. noch keine Zeile für neu hinzugekommene
  // Feld-Schlüssel — dann anlegen statt nur updaten.
  for (let i = 0; i < INVENTORY_FIELD_KEYS.length; i++) {
    const key = INVENTORY_FIELD_KEYS[i];
    await db
      .insert(inventoryBoardFields)
      .values({ boardId, fieldKey: key, visible: checked.has(key), position: i })
      .onConflictDoUpdate({
        target: [inventoryBoardFields.boardId, inventoryBoardFields.fieldKey],
        set: { visible: checked.has(key) },
      });
  }
  revalidatePath(`/intern/inventar/${boardId}/einstellungen`);
  revalidatePath(`/intern/inventar/${boardId}`);
}

/** Auto-Inventarnummer konfigurieren. */
export async function updateInventoryNumberingAction(formData: FormData) {
  const boardId = Number(formData.get("boardId"));
  await requireInventoryBoardManage(boardId);
  const str = (k: string, max: number) =>
    String(formData.get(k) ?? "").slice(0, max);
  await db
    .update(inventoryNumbering)
    .set({
      enabled: formData.get("enabled") === "on",
      prefix: str("prefix", 20),
      year: str("year", 10),
      code: str("code", 20),
      separator: str("separator", 3) || "_",
      padding: clampInt(formData.get("padding"), 0, 10),
      next: clampInt(formData.get("next"), 1, 1_000_000_000),
    })
    .where(eq(inventoryNumbering.boardId, boardId));
  revalidatePath(`/intern/inventar/${boardId}/einstellungen`);
  revalidatePath(`/intern/inventar/${boardId}`);
}

/** Board umbenennen / Beschreibung ändern. */
export async function renameInventoryBoardAction(formData: FormData) {
  const boardId = Number(formData.get("boardId"));
  await requireInventoryBoardManage(boardId);
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const description =
    String(formData.get("description") ?? "").trim().slice(0, 500) || null;
  if (!name) return;
  await db
    .update(inventoryBoards)
    .set({ name, description })
    .where(eq(inventoryBoards.id, boardId));
  revalidatePath(`/intern/inventar/${boardId}/einstellungen`);
  revalidatePath(`/intern/inventar/${boardId}`);
  revalidatePath(`/intern/inventar`);
}

function revLoanBoard(boardId: number) {
  revalidatePath(`/intern/inventar/${boardId}/einstellungen`);
  revalidatePath(`/intern/inventar/${boardId}`);
  revalidatePath(`/intern`);
  revalidatePath(`/intern/boards`);
}

/**
 * Aufgabentracking aktivieren: legt ein dediziertes Leihvorgang-Board
 * (System-Board) mit fester Leih-Spaltenstruktur an und verknüpft es. Zugriff/
 * Freigaben spiegeln automatisch das Inventar.
 */
export async function activateLoanTrackingAction(
  boardId: number,
  _prev: LoanBoardState,
  formData: FormData,
): Promise<LoanBoardState> {
  const { board } = await requireInventoryBoardManage(boardId);
  if (board.loanBoardId != null) {
    return { error: "Aufgabentracking ist bereits aktiv." };
  }
  const name =
    String(formData.get("boardName") ?? "").trim().slice(0, 120) ||
    `${board.name} – Leihvorgänge`;
  await createLoanBoardForInventory(board, name);
  revLoanBoard(boardId);
  return { success: "Leihvorgang-Board erstellt." };
}

/**
 * Aufgabentracking deaktivieren: löst die Verknüpfung und löscht das dedizierte
 * Leihvorgang-Board inkl. seiner Karten. Verknüpfte Vorgänge verlieren ihre
 * Karte (bleiben als Vorgang bestehen).
 */
export async function deactivateLoanTrackingAction(
  boardId: number,
): Promise<void> {
  const { board } = await requireInventoryBoardManage(boardId);
  const loanBoardId = board.loanBoardId;
  if (loanBoardId == null) return;
  // Erst entkoppeln (hebt den Lösch-Schutz des System-Boards auf), dann löschen.
  await db
    .update(inventoryBoards)
    .set({
      loanBoardId: null,
      loanActiveStatusId: null,
      loanReturnedStatusId: null,
    })
    .where(eq(inventoryBoards.id, boardId));
  await db
    .update(boards)
    .set({ inventoryBoardId: null })
    .where(eq(boards.id, loanBoardId));
  await deleteBoardCascade(loanBoardId);
  revLoanBoard(boardId);
}

// --- Eigentum & Löschen (wie Kanban-Boards) -----------------------------

/** Eigentum des Inventars an einen anderen (aktiven) Nutzer übertragen. */
export async function transferInventoryOwnerAction(
  boardId: number,
  formData: FormData,
): Promise<void> {
  await requireInventoryBoardManage(boardId);
  const newOwnerId = Number(formData.get("ownerId"));
  if (!Number.isInteger(newOwnerId)) return;
  const owner = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, newOwnerId), eq(users.isActive, true)))
    .limit(1);
  if (!owner.length) return; // nur aktive Nutzer dürfen Eigentümer werden
  await db
    .update(inventoryBoards)
    .set({ ownerId: newOwnerId })
    .where(eq(inventoryBoards.id, boardId));
  revAccess(boardId);
}

/** Inventar (inkl. Gegenstände/Optionen/Felder) endgültig löschen. */
export async function deleteInventoryBoardConfirmedAction(
  boardId: number,
): Promise<void> {
  await requireInventoryBoardManage(boardId);
  await db.delete(inventoryBoards).where(eq(inventoryBoards.id, boardId));
  revalidatePath(`/intern/inventar`);
  redirect(`/intern/inventar`);
}

// --- Freigaben (wie Kanban-Boards) --------------------------------------
function revAccess(boardId: number) {
  revalidatePath(`/intern/inventar/${boardId}/einstellungen`);
  revalidatePath(`/intern/inventar/${boardId}`);
  revalidatePath(`/intern/inventar`);
}

/** Board einem Nutzer freigeben. */
export async function addInventoryAccessUserAction(
  boardId: number,
  formData: FormData,
): Promise<void> {
  await requireInventoryBoardManage(boardId);
  const userId = Number(formData.get("userId"));
  if (!Number.isInteger(userId)) return;
  const exists = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!exists.length) return;
  await db
    .insert(inventoryBoardAccess)
    .values({ boardId, userId })
    .onConflictDoNothing();
  revAccess(boardId);
}

/** Board einer Gruppe freigeben. */
export async function addInventoryAccessGroupAction(
  boardId: number,
  formData: FormData,
): Promise<void> {
  await requireInventoryBoardManage(boardId);
  const groupId = Number(formData.get("groupId"));
  if (!Number.isInteger(groupId)) return;
  const exists = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!exists.length) return;
  await db
    .insert(inventoryBoardAccess)
    .values({ boardId, groupId })
    .onConflictDoNothing();
  revAccess(boardId);
}

/** Eine Freigabe entfernen. */
export async function removeInventoryAccessAction(
  boardId: number,
  accessId: number,
): Promise<void> {
  await requireInventoryBoardManage(boardId);
  await db
    .delete(inventoryBoardAccess)
    .where(
      and(
        eq(inventoryBoardAccess.id, accessId),
        eq(inventoryBoardAccess.boardId, boardId),
      ),
    );
  revAccess(boardId);
}
