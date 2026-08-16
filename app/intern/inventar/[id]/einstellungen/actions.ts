// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  attachments,
  boards,
  cards,
  groups,
  inventoryAttachments,
  inventoryBoardAccess,
  inventoryBoardFields,
  inventoryBoards,
  inventoryItems,
  inventoryNumbering,
  users,
} from "@/lib/db/schema";
import { deleteStoredFile } from "@/lib/attachments";
import { requireInventoryBoardManage } from "@/lib/inventory";
import { isForeignKeyViolation } from "@/lib/db-errors";
import {
  BoardDeleteBlockedError,
  boardRoutingBlocker,
  createLoanBoardForInventory,
  deleteBoardCascade,
} from "@/lib/boards";
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

/** Auto-Inventarnummer konfigurieren. Gibt eine Erfolgs-/Fehlermeldung zurück. */
export async function updateInventoryNumberingAction(
  _prev: LoanBoardState,
  formData: FormData,
): Promise<LoanBoardState> {
  const boardId = Number(formData.get("boardId"));
  await requireInventoryBoardManage(boardId);
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
): Promise<{ error?: string } | void> {
  const { board } = await requireInventoryBoardManage(boardId);
  const loanBoardId = board.loanBoardId;
  if (loanBoardId == null) return;
  // Lösch-Blocker VOR dem Entkoppeln prüfen. `deleteBoardCascade` weist Boards
  // ab, auf die ein Standort oder Feedback-Bereich routet — und lief unten das
  // Entkoppeln bereits durch, blieb genau das zurück, was diese Funktion
  // verhindern soll: ein Inventar ohne Leihboard-Verknüpfung und ein Board, das
  // ohne `inventory_board_id` frei verwaltbar ist, aber weiter alle Leihkarten
  // trägt (Done-Spalte/Archiv-Trigger hätten sie dort weggeräumt).
  const blocked = await boardRoutingBlocker(loanBoardId);
  if (blocked) return { error: blocked };
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
  try {
    await deleteBoardCascade(loanBoardId);
  } catch (e) {
    // Restfenster: Zwischen der Prüfung oben und dem Löschen kann ein Admin ein
    // Routing setzen (RESTRICT-FK), oder die Datenbank fällt aus. Dann die
    // Entkopplung zurücknehmen — sonst bliebe das Inventar dauerhaft ohne
    // Leihboard zurück, während das Board mit allen Leihkarten weiterlebt.
    await db
      .update(boards)
      .set({ inventoryBoardId: boardId })
      .where(eq(boards.id, loanBoardId));
    await db
      .update(inventoryBoards)
      .set({
        loanBoardId,
        loanActiveStatusId: board.loanActiveStatusId,
        loanReturnedStatusId: board.loanReturnedStatusId,
      })
      .where(eq(inventoryBoards.id, boardId));
    revLoanBoard(boardId);
    if (e instanceof BoardDeleteBlockedError) return { error: e.message };
    throw e;
  }
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
): Promise<{ error?: string } | void> {
  await requireInventoryBoardManage(boardId);

  // Dateipfade VOR dem Löschen sichern. Der Cascade räumt zwar alle Zeilen ab
  // (inventory_items → inventory_attachments, boards → cards → attachments),
  // die DATEIEN im Upload-Verzeichnis aber nicht. Ohne diesen Schritt blieben
  // sämtliche Kaufbelege, Leihverträge und vor allem Studierendenausweise des
  // Inventars dauerhaft auf der Platte liegen (Aufbewahrungs-/Datenschutz-
  // problem) — gleiches Muster wie `deleteBoardCascade` und `removeCard`.
  const inventarDateien = (
    await db
      .select({ path: inventoryAttachments.path })
      .from(inventoryAttachments)
      .innerJoin(
        inventoryItems,
        eq(inventoryItems.id, inventoryAttachments.itemId),
      )
      .where(eq(inventoryItems.boardId, boardId))
  ).map((r) => r.path);
  // Anhänge der Karten auf dem System-/Leihboard: Es hängt über
  // `boards.inventory_board_id` (ON DELETE CASCADE) mit am Inventar.
  const kartenDateien = (
    await db
      .select({ path: attachments.path })
      .from(attachments)
      .innerJoin(cards, eq(cards.id, attachments.cardId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(eq(boards.inventoryBoardId, boardId))
  ).map((r) => r.path);

  try {
    await db.delete(inventoryBoards).where(eq(inventoryBoards.id, boardId));
  } catch (e) {
    // Das Löschen räumt über `boards.inventory_board_id` (ON DELETE CASCADE)
    // auch das Leihboard mit ab. Routet ein Standort oder Feedback-Bereich
    // darauf (bzw. auf eine seiner Spalten), greift der RESTRICT-FK mitten im
    // Cascade — ohne dieses catch endete das Löschen in einem HTTP 500 ohne
    // jeden Hinweis, was zu tun ist. Gleiche Behandlung wie in
    // `deleteBoardCascade`.
    if (isForeignKeyViolation(e)) {
      return {
        error:
          "Das Inventar kann nicht gelöscht werden: Ein Standort oder Feedback-Bereich routet auf sein Leihvorgang-Board. Bitte zuerst das Routing umstellen.",
      };
    }
    throw e;
  }
  // Erst NACH erfolgreichem Löschen: Ein Rollback kann eine gelöschte Datei
  // nicht zurückholen, ein übrig gebliebenes Fragment ohne Zeile ist folgenlos.
  for (const p of [...inventarDateien, ...kartenDateien]) {
    await deleteStoredFile(p);
  }
  revalidatePath(`/intern/inventar`);
  // Außerhalb des try/catch: redirect() signalisiert über eine Exception.
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
