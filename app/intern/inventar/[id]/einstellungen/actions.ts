// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { moveToTrash } from "@/lib/trash";
import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";

import { parseAccessLevel } from "@/lib/access-level";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { groups, inventoryBoardAccess, inventoryBoardFields, inventoryBoards, inventoryNumbering, users } from "@/lib/db/schema";

import { requireInventoryBoardManage, requireInventorySettingsAccess } from "@/lib/inventory";

import { createLoanBoardForInventory } from "@/lib/boards";
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
  await requireInventorySettingsAccess(boardId);
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

/** Auto-Inventarnummer konfigurieren. Gibt eine Erfolgs-/Fehlermeldung zurück. */
export async function updateInventoryNumberingAction(
  _prev: LoanBoardState,
  formData: FormData,
): Promise<LoanBoardState> {
  const boardId = Number(formData.get("boardId"));
  await requireInventorySettingsAccess(boardId);
  const str = (k: string, max: number) =>
    String(formData.get(k) ?? "").slice(0, max);
  const values = {
    enabled: formData.get("enabled") === "on",
    prefix: str("prefix", 20),
    year: str("year", 10),
    // Kürzel gibt es in der UI nicht mehr → immer leer.
    code: "",
    separator: str("separator", 3) || "_",
    padding: clampInt(formData.get("padding"), 0, 10),
    next: clampInt(formData.get("next"), 1, 1_000_000_000),
  };
  // Upsert: ältere Boards haben evtl. noch keine Nummerierungs-Zeile.
  await db
    .insert(inventoryNumbering)
    .values({ boardId, ...values })
    .onConflictDoUpdate({ target: inventoryNumbering.boardId, set: values });
  revalidatePath(`/intern/inventar/${boardId}/einstellungen`);
  revalidatePath(`/intern/inventar/${boardId}`);
  return { success: "Nummerierung gespeichert." };
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
  confirmation?: string,
): Promise<{ error?: string } | void> {
  const {user,board} = await requireInventoryBoardManage(boardId);
  if(typeof confirmation!=="string"||confirmation.trim()!=="LÖSCHEN")return {error:"Bitte LÖSCHEN eingeben."};
  if(board.loanBoardId==null)return;
  try { await moveToTrash(user,"board",board.loanBoardId,confirmation,{trackingInventoryId:boardId}); }
  catch(error){return {error:error instanceof Error?error.message:"Verschieben fehlgeschlagen."};}
  revLoanBoard(boardId);
}

// --- Eigentum & Löschen (wie Kanban-Boards) -----------------------------

/** Eigentum des Inventars an einen anderen (aktiven) Nutzer übertragen. */

export async function deleteInventoryBoardConfirmedAction(
  boardId: number,
  confirmation?: unknown,
  inventoryName?: unknown,
): Promise<{ error?: string } | void> {
  const {user} = await requireInventoryBoardManage(boardId);
  try { await moveToTrash(user, "inventory", boardId, confirmation, { inventoryName }); }
  catch(error) { return {error:error instanceof Error ? error.message : "Verschieben in den Papierkorb fehlgeschlagen."}; }
  revalidatePath("/intern", "layout"); redirect("/intern/inventar");
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
  await requireInventorySettingsAccess(boardId);
  const accessLevel = parseAccessLevel(formData.get("accessLevel"));
  if (!accessLevel) return;
  const userId = Number(formData.get("userId"));
  if (!Number.isSafeInteger(userId) || userId < 1 || userId > 2147483647) return;
  const exists = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!exists.length) return;
  await db
    .insert(inventoryBoardAccess)
    .values({ boardId, userId, accessLevel })
    .onConflictDoUpdate({ target: [inventoryBoardAccess.boardId, inventoryBoardAccess.userId], set: { accessLevel } });
  revAccess(boardId);
}

/** Board einer Gruppe freigeben. */
export async function addInventoryAccessGroupAction(
  boardId: number,
  formData: FormData,
): Promise<void> {
  await requireInventorySettingsAccess(boardId);
  const accessLevel = parseAccessLevel(formData.get("accessLevel"));
  if (!accessLevel) return;
  const groupId = Number(formData.get("groupId"));
  if (!Number.isSafeInteger(groupId) || groupId < 1 || groupId > 2147483647) return;
  const exists = await db
    .select({ id: groups.id })
    .from(groups)
    .where(trashAnd(activeRows.groups, eq(groups.id, groupId)))
    .limit(1);
  if (!exists.length) return;
  await db
    .insert(inventoryBoardAccess)
    .values({ boardId, groupId, accessLevel })
    .onConflictDoUpdate({ target: [inventoryBoardAccess.boardId, inventoryBoardAccess.groupId], set: { accessLevel } });
  revAccess(boardId);
}

/** Eine Freigabe entfernen. */
export async function removeInventoryAccessAction(
  boardId: number,
  accessId: number,
): Promise<void> {
  await requireInventorySettingsAccess(boardId);
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

export async function updateInventoryAccessLevelAction(boardId: number, accessId: number, formData: FormData): Promise<void> {
  await requireInventorySettingsAccess(boardId);
  const accessLevel = parseAccessLevel(formData.get("accessLevel"));
  if (!accessLevel || !Number.isSafeInteger(accessId)) return;
  await db.update(inventoryBoardAccess).set({ accessLevel }).where(and(eq(inventoryBoardAccess.id, accessId), eq(inventoryBoardAccess.boardId, boardId)));
  revAccess(boardId);
}
