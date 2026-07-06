// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  attachments,
  boardArchive,
  boardCardFields,
  boardNumbering,
  boards,
  boardStatuses,
  boardTemplateStatuses,
  cards,
  inventoryBoards,
  locations,
  type InventoryBoard,
} from "@/lib/db/schema";
import { CARD_FIELD_KEYS } from "@/lib/constants";
import { deleteStoredFile } from "@/lib/attachments";

// Standard-Spalten eines automatisch erzeugten Leihvorgang-Boards.
export const LOAN_BOARD_COLUMNS = [
  "Eingegangen",
  "In Prüfung",
  "Vertrag bereitgestellt",
  "Vertrag unterschrieben",
  "Ausleihe bestätigt",
  "in Ausleihe",
  "Zurückgegeben",
] as const;
const LOAN_ACTIVE_COLUMN = "in Ausleihe"; // → Gegenstand gilt als ausgeliehen
const LOAN_RETURNED_COLUMN = "Zurückgegeben"; // → Gegenstand wieder verfügbar
// Spalte, in die die Karte springt, wenn der Entleiher den Vertrag einsendet.
export const LOAN_CONTRACT_SIGNED_COLUMN = "Vertrag unterschrieben";

/**
 * Legt das dedizierte Leihvorgang-Board („System-Board") eines Inventars an:
 * eigenes Kanban-Board mit fester Leih-Spaltenstruktur, als System-Board
 * markiert (boards.inventory_board_id) und mit dem Inventar verknüpft
 * (loan_board_id + Trigger-Spalten). Eigentümer = Inventar-Eigentümer.
 */
export async function createLoanBoardForInventory(
  inventoryBoard: InventoryBoard,
  name: string,
): Promise<number> {
  // Grundgerüst (Kartenfelder/Archiv/Nummerierung) wie ein normales Board.
  const boardId = await createBoardFromTemplate(
    inventoryBoard.ownerId,
    name,
    `Leihvorgänge – ${inventoryBoard.name}`,
    null,
  );
  for (let i = 0; i < LOAN_BOARD_COLUMNS.length; i++) {
    await db
      .insert(boardStatuses)
      .values({ boardId, name: LOAN_BOARD_COLUMNS[i], position: i });
  }
  const cols = await db
    .select({ id: boardStatuses.id, name: boardStatuses.name })
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, boardId));
  const activeCol = cols.find((c) => c.name === LOAN_ACTIVE_COLUMN);
  const returnedCol = cols.find((c) => c.name === LOAN_RETURNED_COLUMN);

  await db
    .update(boards)
    .set({ inventoryBoardId: inventoryBoard.id })
    .where(eq(boards.id, boardId));
  await db
    .update(inventoryBoards)
    .set({
      loanBoardId: boardId,
      loanActiveStatusId: activeCol?.id ?? null,
      loanReturnedStatusId: returnedCol?.id ?? null,
    })
    .where(eq(inventoryBoards.id, inventoryBoard.id));
  return boardId;
}

/**
 * Neues Board aus einem Template: kopiert dessen Spalten (inkl. Archiv-Trigger),
 * setzt alle Kartenfelder sichtbar und legt die (deaktivierte) Archiv-Zeile an.
 * Ohne (gültige) templateId entsteht ein Board ohne Spalten.
 */
export async function createBoardFromTemplate(
  ownerId: number,
  name: string,
  description: string | null,
  templateId: number | null,
): Promise<number> {
  const templateStatuses = templateId
    ? await db
        .select()
        .from(boardTemplateStatuses)
        .where(eq(boardTemplateStatuses.templateId, templateId))
        .orderBy(asc(boardTemplateStatuses.position))
    : [];

  return db.transaction(async (tx) => {
    const [board] = await tx
      .insert(boards)
      .values({ name, description: description ?? null, ownerId })
      .returning();

    for (let index = 0; index < templateStatuses.length; index++) {
      const status = templateStatuses[index];
      await tx.insert(boardStatuses).values({
        boardId: board.id,
        name: status.name,
        position: index,
        isArchiveTrigger: status.isArchiveTrigger,
      });
    }

    for (let i = 0; i < CARD_FIELD_KEYS.length; i++) {
      await tx.insert(boardCardFields).values({
        boardId: board.id,
        fieldKey: CARD_FIELD_KEYS[i],
        visible: true,
        position: i,
      });
    }

    await tx.insert(boardArchive).values({ boardId: board.id, enabled: false });
    await tx.insert(boardNumbering).values({ boardId: board.id });
    return board.id;
  });
}

/** Standort, der dieses Board (oder eine seiner Spalten) als Ziel nutzt — Löschschutz. */
export async function locationReferencingBoard(boardId: number) {
  const rows = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(eq(locations.targetBoardId, boardId))
    .limit(1);
  return rows[0];
}

export class BoardDeleteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardDeleteBlockedError";
  }
}

/** Board inkl. Karten/Anhänge/Stati/Freigaben löschen. Wirft bei Standort-Bindung. */
export async function deleteBoardCascade(boardId: number): Promise<void> {
  const ref = await locationReferencingBoard(boardId);
  if (ref) {
    throw new BoardDeleteBlockedError(
      `Board wird vom Standort „${ref.name}" als Ziel verwendet. Bitte zuerst das Standort-Routing umstellen.`,
    );
  }
  // System-Board (Leihvorgänge) wird über das Inventar verwaltet, nicht hier.
  const [sys] = await db
    .select({ inventoryBoardId: boards.inventoryBoardId })
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1);
  if (sys?.inventoryBoardId != null) {
    throw new BoardDeleteBlockedError(
      "Dies ist ein Leihvorgang-Board eines Inventars. Deaktiviere das Aufgabentracking in den Inventar-Einstellungen, um es zu entfernen.",
    );
  }
  // Anhang-Pfade VOR dem Löschen sammeln, um die physischen Dateien danach
  // zu entfernen (FK-Cascade löscht nur die DB-Zeilen, nicht die Dateien).
  const atts = await db
    .select({ path: attachments.path })
    .from(attachments)
    .innerJoin(cards, eq(cards.id, attachments.cardId))
    .where(eq(cards.boardId, boardId));

  await db.transaction(async (tx) => {
    await tx.delete(cards).where(eq(cards.boardId, boardId));
    await tx.delete(boards).where(eq(boards.id, boardId));
  });

  // Nach erfolgreichem Commit: Dateien von der Platte entfernen (best effort).
  for (const a of atts) await deleteStoredFile(a.path);
}
