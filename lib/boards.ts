// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  boardArchive,
  boardCardFields,
  boardNumbering,
  boards,
  boardStatuses,
  boardTemplateStatuses,
  feedbackAreas,
  inventoryBoards,
  locations,
  users,
  type InventoryBoard,
} from "@/lib/db/schema";
import { CARD_FIELD_KEYS, LEGACY_FINANCE_FIELD_KEYS, ATTACHMENT_FIELD_KEYS } from "@/lib/constants";

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
// „Vertrag einsenden" bewegt die Karte von der Quell- in die Ziel-Spalte —
// nur wenn sie in der Quell-Spalte steht (Prinzip wie der Quittungs-Von→Nach-Zug
// auf normalen Boards). So wird nie rückwärts/aus einer späteren Spalte bewegt.
export const LOAN_CONTRACT_PROVIDED_COLUMN = "Vertrag bereitgestellt"; // Quelle
export const LOAN_CONTRACT_SIGNED_COLUMN = "Vertrag unterschrieben"; // Ziel

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
    .where(trashAnd(activeRows.boardStatuses, eq(boardStatuses.boardId, boardId)));
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
 * setzt aktuelle Kartenfelder sichtbar (ohne alte Einzelfelder für Finanzen)
 * und legt die (deaktivierte) Archiv-Zeile an.
 * Ohne (gültige) templateId entsteht ein Board ohne Spalten.
 */
export async function createBoardFromTemplate(
  ownerId: number,
  name: string,
  description: string | null,
  templateId: number | null,
  application?: { attachmentFields: string[] },
): Promise<number> {
  if (application) {
    const [creator] = await db.select().from(users).where(eq(users.id, ownerId));
    if (!creator?.isActive || creator.role !== "admin") throw new Error("Nur Administrationskonten dürfen Antragsboards erstellen.");
    const allowed = ["finance_request","annex_a","annex_b","student_card","receipts"];
    if (application.attachmentFields.some(key=>!allowed.includes(key)) || new Set(application.attachmentFields).size!==application.attachmentFields.length) throw new Error("Ungültige Anhangstypen.");
  }
  const templateStatuses = templateId
    ? await db
        .select()
        .from(boardTemplateStatuses)
        .where(trashAnd(activeRows.boardTemplateStatuses, eq(boardTemplateStatuses.templateId, templateId)))
        .orderBy(asc(boardTemplateStatuses.position))
    : [];

  return db.transaction(async (tx) => {
    const [board] = await tx
      .insert(boards)
      .values({ name, description: description ?? null, ownerId, isApplicationBoard: !!application, attachmentFields: application?.attachmentFields ?? [] })
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
      if (LEGACY_FINANCE_FIELD_KEYS.includes(CARD_FIELD_KEYS[i])) continue;
      if (ATTACHMENT_FIELD_KEYS.includes(CARD_FIELD_KEYS[i] as (typeof ATTACHMENT_FIELD_KEYS)[number]) && CARD_FIELD_KEYS[i] !== "other_pdfs" && !application?.attachmentFields.includes(CARD_FIELD_KEYS[i])) continue;
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
    .where(trashAnd(activeRows.locations, eq(locations.targetBoardId, boardId)))
    .limit(1);
  return rows[0];
}

/** Feedback-Bereich, der dieses Board als Ziel nutzt — Löschschutz wie beim Standort. */
export async function feedbackAreaReferencingBoard(boardId: number) {
  const rows = await db
    .select({ id: feedbackAreas.id, name: feedbackAreas.name })
    .from(feedbackAreas)
    .where(trashAnd(activeRows.feedbackAreas, eq(feedbackAreas.targetBoardId, boardId)))
    .limit(1);
  return rows[0];
}
