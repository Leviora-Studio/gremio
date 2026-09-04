// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { isForeignKeyViolation } from "@/lib/db-errors";
import {
  attachments,
  boardArchive,
  boardCardFields,
  boardInstructionForms,
  boardNumbering,
  boards,
  boardStatuses,
  boardTemplateStatuses,
  cards,
  feedbackAreas,
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

/** Feedback-Bereich, der dieses Board als Ziel nutzt — Löschschutz wie beim Standort. */
export async function feedbackAreaReferencingBoard(boardId: number) {
  const rows = await db
    .select({ id: feedbackAreas.id, name: feedbackAreas.name })
    .from(feedbackAreas)
    .where(eq(feedbackAreas.targetBoardId, boardId))
    .limit(1);
  return rows[0];
}

export class BoardDeleteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardDeleteBlockedError";
  }
}

/**
 * Routing-Löschschutz eines Boards als reine Abfrage: Meldung, wenn ein Standort
 * oder Feedback-Bereich darauf zeigt — sonst `null`.
 *
 * Eigene Funktion, weil sie an ZWEI Stellen gebraucht wird: `deleteBoardCascade`
 * wirft daraus, und `deactivateLoanTrackingAction` (Inventar-Einstellungen) muss
 * sie prüfen, BEVOR es das Leihboard vom Inventar entkoppelt. Dort lief das
 * Entkoppeln sonst durch und erst der anschließende Löschversuch scheiterte —
 * zurück blieb ein Inventar ohne Leihboard-Verknüpfung und ein Board, das ohne
 * `inventory_board_id` plötzlich frei verwaltbar war (Done-Spalte/Archiv-Trigger
 * hätten die Leihkarten weggeräumt).
 */
export async function boardRoutingBlocker(
  boardId: number,
): Promise<string | null> {
  const ref = await locationReferencingBoard(boardId);
  if (ref) {
    return `Board wird vom Standort „${ref.name}" als Ziel verwendet. Bitte zuerst das Standort-Routing umstellen.`;
  }
  const fbRef = await feedbackAreaReferencingBoard(boardId);
  if (fbRef) {
    return `Board wird vom Feedback-Bereich „${fbRef.name}" als Ziel verwendet. Bitte zuerst das Routing unter „Umfragen" umstellen.`;
  }
  return null;
}

/** Board inkl. Karten/Anhänge/Stati/Freigaben löschen. Wirft bei Standort-Bindung. */
export async function deleteBoardCascade(boardId: number): Promise<void> {
  const blocked = await boardRoutingBlocker(boardId);
  if (blocked) throw new BoardDeleteBlockedError(blocked);
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
  let cleanup: { attachmentPaths: string[]; instructionPath: string | null };
  try {
    cleanup = await db.transaction(async (tx) => {
      // Board und Karten vor dem Pfad-Snapshot sperren. Upload/PDF-Ersetzung
      // sperren dieselben Karten; Vorlagenänderungen sperren dasselbe Board.
      // Dadurch kann nach dem Snapshot keine später kaskadierte Datei mehr
      // unbemerkt auf der Platte zurückbleiben.
      const [lockedBoard] = await tx
        .select({ id: boards.id })
        .from(boards)
        .where(eq(boards.id, boardId))
        .for("update");
      if (!lockedBoard) {
        return { attachmentPaths: [], instructionPath: null };
      }
      await tx
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.boardId, boardId))
        .orderBy(asc(cards.id))
        .for("update");
      const atts = await tx
        .select({ path: attachments.path })
        .from(attachments)
        .innerJoin(cards, eq(cards.id, attachments.cardId))
        .where(eq(cards.boardId, boardId));
      const [instructionForm] = await tx
        .select({ path: boardInstructionForms.path })
        .from(boardInstructionForms)
        .where(eq(boardInstructionForms.boardId, boardId))
        .limit(1);
      await tx.delete(cards).where(eq(cards.boardId, boardId));
      await tx.delete(boards).where(eq(boards.id, boardId));
      return {
        attachmentPaths: atts.map((attachment) => attachment.path),
        instructionPath: instructionForm?.path ?? null,
      };
    });
  } catch (e) {
    // Die Vorab-Prüfungen oben laufen VOR der Transaktion: Routet ein Admin im
    // Fenster dazwischen einen Standort/Feedback-Bereich auf dieses Board (oder
    // eine seiner Spalten), schlägt der RESTRICT-FK zu. Das ist derselbe
    // fachliche Grund — also dieselbe verständliche Meldung statt eines 500ers.
    if (isForeignKeyViolation(e)) {
      throw new BoardDeleteBlockedError(
        "Board wird inzwischen von einem Standort oder Feedback-Bereich als Ziel verwendet. Bitte zuerst das Routing umstellen.",
      );
    }
    throw e;
  }

  // Nach erfolgreichem Commit: Dateien von der Platte entfernen (best effort).
  for (const path of cleanup.attachmentPaths) await deleteStoredFile(path);
  if (cleanup.instructionPath) await deleteStoredFile(cleanup.instructionPath);
}
