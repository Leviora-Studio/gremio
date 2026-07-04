// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  boardStatuses,
  cardActivity,
  cards,
  inventoryBoards,
  inventoryDefects,
  inventoryItems,
  inventoryLoanItems,
  inventoryLoans,
  users,
  type InventoryDefect,
  type InventoryLoan,
} from "@/lib/db/schema";
import { generateToken, isTokenConflict } from "@/lib/token";

// Drizzle-Transaktionshandle (für Helfer, die in einer bestehenden Tx laufen).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Aufgabentracking: Hat das Inventar-Board der Stücke ein Ziel-Board gesetzt,
 * wird für den Vorgang eine Karte in dessen erster Spalte angelegt und mit dem
 * Vorgang verknüpft. Ohne Ziel-Board passiert nichts.
 */
async function maybeCreateTrackingCard(
  tx: Tx,
  itemIds: number[],
  loanId: number,
  info: { borrower: string; purpose: string | null },
): Promise<void> {
  const [firstItem] = await tx
    .select({ boardId: inventoryItems.boardId, name: inventoryItems.name })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemIds[0]))
    .limit(1);
  if (!firstItem) return;

  const [invBoard] = await tx
    .select({ loanBoardId: inventoryBoards.loanBoardId })
    .from(inventoryBoards)
    .where(eq(inventoryBoards.id, firstItem.boardId))
    .limit(1);
  if (!invBoard?.loanBoardId) return;

  const [firstCol] = await tx
    .select({ id: boardStatuses.id })
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, invBoard.loanBoardId))
    .orderBy(asc(boardStatuses.position))
    .limit(1);
  if (!firstCol) return;

  let title = firstItem.name || "Leihgegenstand";
  if (itemIds.length > 1) title = `${title} ×${itemIds.length}`;

  const [maxRow] = await tx
    .select({ m: sql<number>`coalesce(max(${cards.position}), -1)` })
    .from(cards)
    .where(
      and(
        eq(cards.boardId, invBoard.loanBoardId),
        eq(cards.statusId, firstCol.id),
      ),
    );
  const position = (maxRow?.m ?? -1) + 1;

  const [card] = await tx
    .insert(cards)
    .values({
      boardId: invBoard.loanBoardId,
      statusId: firstCol.id,
      title,
      applicant: info.borrower || "—",
      token: generateToken(), // eigener Token; wird nicht veröffentlicht
      notes: info.purpose,
      position,
    })
    .returning({ id: cards.id });

  await tx.insert(cardActivity).values({
    cardId: card.id,
    userId: null,
    type: "created",
    detail: "Leihvorgang aus dem Inventar angelegt",
  });
  await tx
    .update(inventoryLoans)
    .set({ cardId: card.id })
    .where(eq(inventoryLoans.id, loanId));
}

// ---------------------------------------------------------------------------
// Entleihvorgänge
// ---------------------------------------------------------------------------

export type LoanInput = {
  borrower: string;
  borrowerEmail: string | null;
  purpose: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
};

/** Alle Entleihvorgänge, die ein Gegenstand (mit)betrifft (neueste zuerst). */
export async function listLoans(itemId: number): Promise<InventoryLoan[]> {
  const rows = await db
    .select({ l: inventoryLoans })
    .from(inventoryLoanItems)
    .innerJoin(inventoryLoans, eq(inventoryLoans.id, inventoryLoanItems.loanId))
    .where(eq(inventoryLoanItems.itemId, itemId))
    .orderBy(desc(inventoryLoans.createdAt));
  return rows.map((r) => r.l);
}

export async function getLoanById(
  loanId: number,
): Promise<InventoryLoan | undefined> {
  if (!Number.isInteger(loanId)) return undefined;
  const [row] = await db
    .select()
    .from(inventoryLoans)
    .where(eq(inventoryLoans.id, loanId))
    .limit(1);
  return row;
}

/** Die konkreten Stücke eines Vorgangs (Inventarnummer + Bezeichnung). */
export async function getLoanItems(
  loanId: number,
): Promise<{ id: number; number: string | null; name: string }[]> {
  return db
    .select({
      id: inventoryItems.id,
      number: inventoryItems.number,
      name: inventoryItems.name,
    })
    .from(inventoryLoanItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryLoanItems.itemId))
    .where(eq(inventoryLoanItems.loanId, loanId))
    .orderBy(inventoryItems.number, inventoryItems.id);
}

/**
 * Neuen Entleihvorgang anlegen — reserviert 1..n konkrete Stücke. `itemIds[0]`
 * ist das Leit-Stück (loans.item_id), alle Stücke landen in loan_items.
 */
export async function createLoan(
  itemIds: number[],
  createdBy: number | null,
  data: LoanInput,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(inventoryLoans)
      .values({ itemId: itemIds[0], createdBy, ...data })
      .returning({ id: inventoryLoans.id });
    await tx
      .insert(inventoryLoanItems)
      .values(itemIds.map((itemId) => ({ loanId: row.id, itemId })));
    await maybeCreateTrackingCard(tx, itemIds, row.id, {
      borrower: data.borrower,
      purpose: data.purpose,
    });
    return row.id;
  });
}

/** Vorgang als zurückgegeben markieren (beendet den laufenden Entleihzeitraum). */
export async function returnLoan(loanId: number): Promise<void> {
  await db
    .update(inventoryLoans)
    .set({ returnedAt: new Date(), status: "returned" })
    .where(eq(inventoryLoans.id, loanId));
}

export async function deleteLoan(loanId: number): Promise<void> {
  // Verknüpfte Tracking-Karte mitlöschen, damit keine Karteileiche übrig bleibt.
  const [loan] = await db
    .select({ cardId: inventoryLoans.cardId })
    .from(inventoryLoans)
    .where(eq(inventoryLoans.id, loanId))
    .limit(1);
  await db.delete(inventoryLoans).where(eq(inventoryLoans.id, loanId));
  if (loan?.cardId != null) {
    await db.delete(cards).where(eq(cards.id, loan.cardId));
  }
}

/** Hinweise des Verleihers an den Entleiher setzen (über Status-Link sichtbar). */
export async function setLoanBorrowerNote(
  loanId: number,
  note: string | null,
): Promise<void> {
  await db
    .update(inventoryLoans)
    .set({ borrowerNote: note })
    .where(eq(inventoryLoans.id, loanId));
}

/**
 * Öffentliche Entleih-Anfrage anlegen (status='requested' + Status-Token) —
 * reserviert 1..n konkrete Stücke.
 */
export async function createLoanRequest(
  itemIds: number[],
  data: LoanInput,
): Promise<{ id: number; token: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateToken();
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(inventoryLoans)
          .values({
            itemId: itemIds[0],
            status: "requested",
            token,
            createdBy: null,
            ...data,
          })
          .returning({ id: inventoryLoans.id });
        await tx
          .insert(inventoryLoanItems)
          .values(itemIds.map((itemId) => ({ loanId: row.id, itemId })));
        await maybeCreateTrackingCard(tx, itemIds, row.id, {
          borrower: data.borrower,
          purpose: data.purpose,
        });
        return { id: row.id, token };
      });
    } catch (e) {
      if (isTokenConflict(e)) continue;
      throw e;
    }
  }
  throw new Error("Konnte keinen eindeutigen Token erzeugen.");
}

// Zustände einer noch nicht angenommenen/abgeschlossenen Anfrage.
export const PENDING_LOAN_STATUSES = [
  "requested",
  "contract_provided",
  "contract_signed",
] as const;

/**
 * Aufgabentracking (kartengeführt): Bewegt sich die verknüpfte Karte, wird der
 * Vorgangsstatus daraus abgeleitet. Erreicht die Karte die „ausgeliehen"-Spalte
 * des Inventar-Boards → Vorgang active (Gegenstand entliehen); erreicht sie die
 * „zurückgegeben"-Spalte → Vorgang returned (Gegenstand wieder verfügbar).
 * No-op, wenn die Karte zu keinem Vorgang gehört oder keine Trigger gesetzt sind.
 */
export async function syncLoanFromCard(
  cardId: number,
  statusId: number,
): Promise<void> {
  const [loan] = await db
    .select({ id: inventoryLoans.id, itemId: inventoryLoans.itemId })
    .from(inventoryLoans)
    .where(eq(inventoryLoans.cardId, cardId))
    .limit(1);
  if (!loan) return;

  const [cfg] = await db
    .select({
      activeId: inventoryBoards.loanActiveStatusId,
      returnedId: inventoryBoards.loanReturnedStatusId,
    })
    .from(inventoryItems)
    .innerJoin(
      inventoryBoards,
      eq(inventoryBoards.id, inventoryItems.boardId),
    )
    .where(eq(inventoryItems.id, loan.itemId))
    .limit(1);
  if (!cfg) return;

  if (cfg.returnedId != null && statusId === cfg.returnedId) {
    // Rückgabe: nur wenn noch nicht zurückgegeben.
    await db
      .update(inventoryLoans)
      .set({ status: "returned", returnedAt: new Date() })
      .where(
        and(eq(inventoryLoans.id, loan.id), isNull(inventoryLoans.returnedAt)),
      );
  } else if (cfg.activeId != null && statusId === cfg.activeId) {
    // Ausgeliehen: nur aus einem Pending-Zustand (verwandelt Anfrage in Ausleihe).
    await db
      .update(inventoryLoans)
      .set({ status: "active" })
      .where(
        and(
          eq(inventoryLoans.id, loan.id),
          inArray(inventoryLoans.status, [...PENDING_LOAN_STATUSES]),
        ),
      );
  }
}

export type LoanCardProgress = {
  boardId: number;
  columns: { id: number; name: string }[];
  currentStatusId: number;
  currentName: string;
  archived: boolean;
};

/**
 * Spalten-Fortschritt der verknüpften Karte (für die öffentliche Statusseite):
 * alle Board-Spalten in Reihenfolge + die aktuelle. NULL, wenn keine Karte.
 */
export async function getLoanCardProgress(
  cardId: number,
): Promise<LoanCardProgress | null> {
  const [card] = await db
    .select({
      statusId: cards.statusId,
      boardId: cards.boardId,
      archivedAt: cards.archivedAt,
    })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!card) return null;
  const columns = await db
    .select({ id: boardStatuses.id, name: boardStatuses.name })
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, card.boardId))
    .orderBy(asc(boardStatuses.position));
  const current = columns.find((c) => c.id === card.statusId);
  return {
    boardId: card.boardId,
    columns,
    currentStatusId: card.statusId,
    currentName: current?.name ?? "",
    archived: card.archivedAt != null,
  };
}

/** Anfrage annehmen → laufender Vorgang (nur aus einem Pending-Zustand). */
export async function approveLoan(loanId: number): Promise<void> {
  await db
    .update(inventoryLoans)
    .set({ status: "active" })
    .where(
      and(
        eq(inventoryLoans.id, loanId),
        inArray(inventoryLoans.status, [...PENDING_LOAN_STATUSES]),
      ),
    );
}

/** Anfrage ablehnen (jederzeit vor der Annahme möglich). */
export async function rejectLoan(loanId: number): Promise<void> {
  await db
    .update(inventoryLoans)
    .set({ status: "rejected" })
    .where(
      and(
        eq(inventoryLoans.id, loanId),
        inArray(inventoryLoans.status, [...PENDING_LOAN_STATUSES]),
      ),
    );
}

/** Anfrage vom Einreicher zurückziehen (öffentlich). */
export async function withdrawLoan(loanId: number): Promise<void> {
  await db
    .update(inventoryLoans)
    .set({ status: "withdrawn" })
    .where(
      and(
        eq(inventoryLoans.id, loanId),
        inArray(inventoryLoans.status, [...PENDING_LOAN_STATUSES]),
      ),
    );
}

/** Auto: Vertrag bereitgestellt (intern hochgeladen). */
export async function advanceLoanToContractProvided(
  loanId: number,
): Promise<void> {
  await db
    .update(inventoryLoans)
    .set({ status: "contract_provided" })
    .where(
      and(
        eq(inventoryLoans.id, loanId),
        eq(inventoryLoans.status, "requested"),
      ),
    );
}

/** Auto: Vertrag unterschrieben (vom Einreicher hochgeladen). */
export async function advanceLoanToContractSigned(
  loanId: number,
): Promise<void> {
  await db
    .update(inventoryLoans)
    .set({ status: "contract_signed" })
    .where(
      and(
        eq(inventoryLoans.id, loanId),
        inArray(inventoryLoans.status, ["requested", "contract_provided"]),
      ),
    );
}

export type BoardLoanCard = {
  loanId: number;
  cardId: number;
  kanbanBoardId: number;
  columnId: number;
  columnName: string;
  columnPosition: number;
  borrower: string;
  itemName: string;
  endDate: string | null;
};

/**
 * Laufende, kartengeführte Leihvorgänge eines Inventar-Boards inkl. aktueller
 * Kanban-Spalte — für die kompakte „Laufende Vorgänge"-Übersicht. Ohne
 * zurückgegebene/abgelehnte/zurückgezogene und ohne archivierte Karten.
 */
export async function listInventoryBoardLoanCards(
  inventoryBoardId: number,
): Promise<BoardLoanCard[]> {
  const rows = await db
    .select({
      loanId: inventoryLoans.id,
      cardId: cards.id,
      kanbanBoardId: cards.boardId,
      columnId: boardStatuses.id,
      columnName: boardStatuses.name,
      columnPosition: boardStatuses.position,
      borrower: inventoryLoans.borrower,
      itemName: inventoryItems.name,
      endDate: inventoryLoans.endDate,
    })
    .from(inventoryLoans)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryLoans.itemId))
    .innerJoin(cards, eq(cards.id, inventoryLoans.cardId))
    .innerJoin(boardStatuses, eq(boardStatuses.id, cards.statusId))
    .where(
      and(
        eq(inventoryItems.boardId, inventoryBoardId),
        isNull(cards.archivedAt),
        inArray(inventoryLoans.status, [
          "requested",
          "contract_provided",
          "contract_signed",
          "active",
        ]),
      ),
    )
    .orderBy(asc(boardStatuses.position), desc(inventoryLoans.createdAt));
  return rows;
}

/**
 * Anzahl laufender Vorgänge eines Inventar-Boards OHNE verknüpfte Karte — z. B.
 * weil (noch) kein Ziel-Board gesetzt ist. Als Hinweis, damit solche Vorgänge
 * nicht unsichtbar werden.
 */
export async function countUntrackedLoans(
  inventoryBoardId: number,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inventoryLoans)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryLoans.itemId))
    .where(
      and(
        eq(inventoryItems.boardId, inventoryBoardId),
        isNull(inventoryLoans.cardId),
        inArray(inventoryLoans.status, [
          "requested",
          "contract_provided",
          "contract_signed",
          "active",
        ]),
      ),
    );
  return row?.n ?? 0;
}

export async function getLoanByToken(
  token: string,
): Promise<InventoryLoan | undefined> {
  if (!token) return undefined;
  const [row] = await db
    .select()
    .from(inventoryLoans)
    .where(eq(inventoryLoans.token, token))
    .limit(1);
  return row;
}

export type ActiveLoan = {
  borrower: string;
  startDate: string | null;
  endDate: string | null;
};

/** Laufender (nicht zurückgegebener) Vorgang je Gegenstand — für die Liste. */
export async function getActiveLoanMap(
  itemIds: number[],
): Promise<Map<number, ActiveLoan>> {
  if (!itemIds.length) return new Map();
  const rows = await db
    .select({
      itemId: inventoryLoanItems.itemId,
      borrower: inventoryLoans.borrower,
      startDate: inventoryLoans.startDate,
      endDate: inventoryLoans.endDate,
      createdAt: inventoryLoans.createdAt,
    })
    .from(inventoryLoanItems)
    .innerJoin(inventoryLoans, eq(inventoryLoans.id, inventoryLoanItems.loanId))
    .where(
      and(
        inArray(inventoryLoanItems.itemId, itemIds),
        eq(inventoryLoans.status, "active"),
        isNull(inventoryLoans.returnedAt),
      ),
    )
    .orderBy(desc(inventoryLoans.createdAt));
  const map = new Map<number, ActiveLoan>();
  for (const r of rows) {
    if (!map.has(r.itemId)) {
      map.set(r.itemId, {
        borrower: r.borrower,
        startDate: r.startDate,
        endDate: r.endDate,
      });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Mängel
// ---------------------------------------------------------------------------

export type DefectView = InventoryDefect & { creatorName: string | null };

export async function listDefects(itemId: number): Promise<DefectView[]> {
  const rows = await db
    .select({ d: inventoryDefects, creatorName: users.username })
    .from(inventoryDefects)
    .leftJoin(users, eq(users.id, inventoryDefects.createdBy))
    .where(eq(inventoryDefects.itemId, itemId))
    .orderBy(desc(inventoryDefects.createdAt));
  return rows.map((r) => ({ ...r.d, creatorName: r.creatorName }));
}

export async function getDefectById(
  defectId: number,
): Promise<InventoryDefect | undefined> {
  if (!Number.isInteger(defectId)) return undefined;
  const [row] = await db
    .select()
    .from(inventoryDefects)
    .where(eq(inventoryDefects.id, defectId))
    .limit(1);
  return row;
}

export async function createDefect(
  itemId: number,
  createdBy: number | null,
  description: string,
): Promise<number> {
  const [row] = await db
    .insert(inventoryDefects)
    .values({ itemId, createdBy, description })
    .returning({ id: inventoryDefects.id });
  return row.id;
}

/** Mangel auf behoben/offen setzen. */
export async function setDefectResolved(
  defectId: number,
  resolved: boolean,
): Promise<void> {
  await db
    .update(inventoryDefects)
    .set({ resolvedAt: resolved ? new Date() : null })
    .where(eq(inventoryDefects.id, defectId));
}

export async function deleteDefect(defectId: number): Promise<void> {
  await db.delete(inventoryDefects).where(eq(inventoryDefects.id, defectId));
}

/** Anzahl offener Mängel je Gegenstand — für die Liste. */
export async function getOpenDefectCountMap(
  itemIds: number[],
): Promise<Map<number, number>> {
  if (!itemIds.length) return new Map();
  const rows = await db
    .select({
      itemId: inventoryDefects.itemId,
      count: sql<number>`count(*)::int`,
    })
    .from(inventoryDefects)
    .where(
      and(
        inArray(inventoryDefects.itemId, itemIds),
        isNull(inventoryDefects.resolvedAt),
      ),
    )
    .groupBy(inventoryDefects.itemId);
  return new Map(rows.map((r) => [r.itemId, r.count]));
}
