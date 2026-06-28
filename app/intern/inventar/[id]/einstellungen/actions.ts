// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  inventoryBoardFields,
  inventoryBoards,
  inventoryNumbering,
} from "@/lib/db/schema";
import { requireInventoryBoardManage } from "@/lib/inventory";
import { INVENTORY_FIELD_KEYS } from "@/lib/inventory-fields";

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
  for (const key of INVENTORY_FIELD_KEYS) {
    await db
      .update(inventoryBoardFields)
      .set({ visible: checked.has(key) })
      .where(
        and(
          eq(inventoryBoardFields.boardId, boardId),
          eq(inventoryBoardFields.fieldKey, key),
        ),
      );
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

/** Board (inkl. Gegenstände/Optionen/Felder) löschen. */
export async function deleteInventoryBoardAction(formData: FormData) {
  const boardId = Number(formData.get("boardId"));
  await requireInventoryBoardManage(boardId);
  await db.delete(inventoryBoards).where(eq(inventoryBoards.id, boardId));
  revalidatePath(`/intern/inventar`);
  redirect(`/intern/inventar`);
}
