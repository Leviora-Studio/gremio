// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
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
import {
  LOAN_CONTRACT_PROVIDED_COLUMN,
  LOAN_CONTRACT_SIGNED_COLUMN,
} from "@/lib/boards";

// Drizzle-Transaktionshandle (für Helfer, die in einer bestehenden Tx laufen).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Eine reservierte Einheit eines Vorgangs: ein konkretes Stück + Menge. Gruppen
 * liefern je Stück quantity=1; ein Mengen-Gegenstand liefert EIN Stück mit der
 * gewünschten Anzahl.
 */
export type LoanUnit = { itemId: number; quantity: number };

/**
 * Aufgabentracking: Hat das Inventar-Board der Stücke ein Ziel-Board gesetzt,
 * wird für den Vorgang eine Karte in dessen erster Spalte angelegt und mit dem
 * Vorgang verknüpft. Ohne Ziel-Board passiert nichts.
 */
async function maybeCreateTrackingCard(
  tx: Tx,
  units: LoanUnit[],
  loanId: number,
  info: { borrower: string; purpose: string | null },
): Promise<void> {
  const leadId = units[0]?.itemId;
  if (leadId == null) return;
  const totalQty = units.reduce((s, u) => s + u.quantity, 0);
  const [firstItem] = await tx
    .select({ boardId: inventoryItems.boardId, name: inventoryItems.name })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, leadId))
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
  if (totalQty > 1) title = `${title} ×${totalQty}`;

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
 * Bestätigte/zugeordnete Gesamtmenge eines Vorgangs = Summe der Mengen aller
 * zugeordneten Stücke (Gruppen: 1 je Stück; Mengen-Gegenstand: die Anzahl).
 */
export async function getConfirmedQuantity(loanId: number): Promise<number> {
  const [row] = await db
    .select({
      n: sql<number>`coalesce(sum(${inventoryLoanItems.quantity}), 0)::int`,
    })
    .from(inventoryLoanItems)
    .where(eq(inventoryLoanItems.loanId, loanId));
  return row?.n ?? 0;
}

/** Aktualisiert den Titel der Tracking-Karte anhand Leit-Stück + Stückzahl. */
export async function updateTrackingCardTitle(loanId: number): Promise<void> {
  const loan = await getLoanById(loanId);
  if (!loan?.cardId) return;
  const [lead] = await db
    .select({ name: inventoryItems.name })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, loan.itemId))
    .limit(1);
  const [cnt] = await db
    .select({
      n: sql<number>`coalesce(sum(${inventoryLoanItems.quantity}), 1)::int`,
    })
    .from(inventoryLoanItems)
    .where(eq(inventoryLoanItems.loanId, loanId));
  let title = lead?.name || "Leihgegenstand";
  if ((cnt?.n ?? 1) > 1) title = `${title} ×${cnt.n}`;
  await db
    .update(cards)
    .set({ title, updatedAt: new Date() })
    .where(eq(cards.id, loan.cardId));
}

/**
 * Verfügbare Stücke der Gruppe eines Vorgangs, die noch NICHT zugeordnet sind —
 * zum manuellen Ergänzen (bestätigte Stückzahl anpassen). Leer, wenn das
 * Leit-Stück keiner Gruppe angehört.
 */
export async function getAddableGroupUnits(
  loanId: number,
): Promise<{ id: number; number: string | null; name: string }[]> {
  const loan = await getLoanById(loanId);
  if (!loan) return [];
  const [lead] = await db
    .select({
      boardId: inventoryItems.boardId,
      groupName: inventoryItems.groupName,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, loan.itemId))
    .limit(1);
  if (!lead?.groupName) return [];
  const candidates = await db
    .select({
      id: inventoryItems.id,
      number: inventoryItems.number,
      name: inventoryItems.name,
    })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.boardId, lead.boardId),
        eq(inventoryItems.groupName, lead.groupName),
        eq(inventoryItems.condition, "active"),
        eq(inventoryItems.lendable, true),
      ),
    )
    .orderBy(inventoryItems.number, inventoryItems.id);
  if (!candidates.length) return [];
  const active = await getActiveLoanMap(candidates.map((c) => c.id));
  const attached = new Set(
    (
      await db
        .select({ id: inventoryLoanItems.itemId })
        .from(inventoryLoanItems)
        .where(eq(inventoryLoanItems.loanId, loanId))
    ).map((r) => r.id),
  );
  return candidates.filter((c) => !active.has(c.id) && !attached.has(c.id));
}

/** Ein weiteres Stück derselben Gruppe dem Vorgang zuordnen (bestätigte Menge). */
export async function addLoanItem(
  loanId: number,
  itemId: number,
): Promise<void> {
  const loan = await getLoanById(loanId);
  if (!loan) return;
  const [lead] = await db
    .select({
      boardId: inventoryItems.boardId,
      groupName: inventoryItems.groupName,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, loan.itemId))
    .limit(1);
  const [target] = await db
    .select({
      boardId: inventoryItems.boardId,
      groupName: inventoryItems.groupName,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .limit(1);
  // Nur Stücke derselben Gruppe/desselben Boards zulassen.
  if (
    !lead ||
    !target ||
    !lead.groupName ||
    target.boardId !== lead.boardId ||
    target.groupName !== lead.groupName
  ) {
    return;
  }
  // Kein bereits laufend verliehenes Stück zuordnen (keine Doppelbuchung).
  const active = await getActiveLoanMap([itemId]);
  if (active.has(itemId)) return;
  await db
    .insert(inventoryLoanItems)
    .values({ loanId, itemId })
    .onConflictDoNothing();
  await updateTrackingCardTitle(loanId);
}

/** Ein zugeordnetes Stück wieder entfernen (mind. 1 bleibt; Leit-Stück wandert). */
export async function removeLoanItem(
  loanId: number,
  itemId: number,
): Promise<void> {
  // Lesen + Löschen + Leit-Stück-Umzug atomar (kein TOCTOU zwischen den Schritten).
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: inventoryLoanItems.itemId })
      .from(inventoryLoanItems)
      .where(eq(inventoryLoanItems.loanId, loanId));
    const ids = rows.map((r) => r.id);
    if (!ids.includes(itemId) || ids.length <= 1) return; // letztes Stück bleibt
    await tx
      .delete(inventoryLoanItems)
      .where(
        and(
          eq(inventoryLoanItems.loanId, loanId),
          eq(inventoryLoanItems.itemId, itemId),
        ),
      );
    const [loan] = await tx
      .select({ itemId: inventoryLoans.itemId })
      .from(inventoryLoans)
      .where(eq(inventoryLoans.id, loanId))
      .limit(1);
    if (loan && loan.itemId === itemId) {
      const nextLead = ids.find((id) => id !== itemId);
      if (nextLead != null) {
        await tx
          .update(inventoryLoans)
          .set({ itemId: nextLead })
          .where(eq(inventoryLoans.id, loanId));
      }
    }
  });
  await updateTrackingCardTitle(loanId);
}

/**
 * Neuen Entleihvorgang anlegen — reserviert 1..n konkrete Stücke. `itemIds[0]`
 * ist das Leit-Stück (loans.item_id), alle Stücke landen in loan_items.
 */
export async function createLoan(
  units: LoanUnit[],
  createdBy: number | null,
  data: LoanInput,
): Promise<number> {
  const totalQty = units.reduce((s, u) => s + u.quantity, 0);
  // maybeCreateTrackingCard vergibt einen Karten-Token; kollidiert er (faktisch
  // unmöglich), bricht die Transaktion ab → erneut versuchen (wie createLoanRequest).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(inventoryLoans)
          .values({
            itemId: units[0].itemId,
            createdBy,
            requestedQuantity: totalQty,
            ...data,
          })
          .returning({ id: inventoryLoans.id });
        await tx.insert(inventoryLoanItems).values(
          units.map((u) => ({
            loanId: row.id,
            itemId: u.itemId,
            quantity: u.quantity,
          })),
        );
        await maybeCreateTrackingCard(tx, units, row.id, {
          borrower: data.borrower,
          purpose: data.purpose,
        });
        return row.id;
      });
    } catch (e) {
      if (isTokenConflict(e)) continue;
      throw e;
    }
  }
  throw new Error("Konnte den Vorgang nicht anlegen (Token-Kollision).");
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
  units: LoanUnit[],
  data: LoanInput,
): Promise<{ id: number; token: string }> {
  const totalQty = units.reduce((s, u) => s + u.quantity, 0);
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateToken();
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(inventoryLoans)
          .values({
            itemId: units[0].itemId,
            status: "requested",
            token,
            createdBy: null,
            requestedQuantity: totalQty,
            ...data,
          })
          .returning({ id: inventoryLoans.id });
        await tx.insert(inventoryLoanItems).values(
          units.map((u) => ({
            loanId: row.id,
            itemId: u.itemId,
            quantity: u.quantity,
          })),
        );
        await maybeCreateTrackingCard(tx, units, row.id, {
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

// Namespace für den Transaktions-Advisory-Lock, der Sync-Aufrufe je Karte
// serialisiert (pg_advisory_xact_lock(ns, cardId)); "LS" = Loan Sync.
const LOAN_SYNC_LOCK_NS = 0x4c53;

/**
 * Aufgabentracking (kartengeführt): Bewegt sich die verknüpfte Karte, wird der
 * Vorgangsstatus daraus abgeleitet. Erreicht die Karte die „ausgeliehen"-Spalte
 * des Inventar-Boards → Vorgang active (Gegenstand entliehen); erreicht sie die
 * „zurückgegeben"-Spalte → Vorgang returned (Gegenstand wieder verfügbar).
 * No-op, wenn die Karte zu keinem Vorgang gehört oder keine Trigger gesetzt sind.
 *
 * Nebenläufigkeit: Zwei gleichzeitige gegenläufige Moves DERSELBEN Karte werden
 * per Transaktions-Advisory-Lock (je cardId) serialisiert. Innerhalb der Sperre
 * wird der AKTUELLE Kartenstatus frisch gelesen (statt dem übergebenen `statusId`
 * zu vertrauen), damit die zuletzt committete Kartenposition maßgeblich ist und
 * Karte/Vorgang konsistent bleiben. `statusId` dient nur noch als Hinweis.
 */
export async function syncLoanFromCard(
  cardId: number,
  _statusId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialisieren; Lock wird am Transaktionsende automatisch freigegeben.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${LOAN_SYNC_LOCK_NS}, ${cardId})`,
    );

    const [loan] = await tx
      .select({ id: inventoryLoans.id, itemId: inventoryLoans.itemId })
      .from(inventoryLoans)
      .where(eq(inventoryLoans.cardId, cardId))
      .limit(1);
    if (!loan) return;

    // Aktuellen Kartenstatus frisch lesen (maßgeblich für die Ableitung).
    const [card] = await tx
      .select({ statusId: cards.statusId })
      .from(cards)
      .where(eq(cards.id, cardId))
      .limit(1);
    if (!card) return;
    const curStatus = card.statusId;

    const [cfg] = await tx
      .select({
        activeId: inventoryBoards.loanActiveStatusId,
        returnedId: inventoryBoards.loanReturnedStatusId,
      })
      .from(inventoryItems)
      .innerJoin(inventoryBoards, eq(inventoryBoards.id, inventoryItems.boardId))
      .where(eq(inventoryItems.id, loan.itemId))
      .limit(1);
    if (!cfg) return;

    if (cfg.returnedId != null && curStatus === cfg.returnedId) {
      // Rückgabe: nur wenn noch nicht zurückgegeben.
      await tx
        .update(inventoryLoans)
        .set({ status: "returned", returnedAt: new Date() })
        .where(
          and(eq(inventoryLoans.id, loan.id), isNull(inventoryLoans.returnedAt)),
        );
    } else if (cfg.activeId != null && curStatus === cfg.activeId) {
      // Ausgeliehen: aus einem Pending-Zustand (Anfrage → Ausleihe) ODER zurück
      // aus „zurückgegeben". Karte in der Aktiv-Spalte = Gegenstand entliehen ⇒
      // Vorgang aktiv, `returnedAt` zurücksetzen (Kartenposition ist maßgeblich).
      // Bereits aktive Vorgänge bleiben unberührt (No-op).
      await tx
        .update(inventoryLoans)
        .set({ status: "active", returnedAt: null })
        .where(
          and(
            eq(inventoryLoans.id, loan.id),
            or(
              inArray(inventoryLoans.status, [...PENDING_LOAN_STATUSES]),
              isNotNull(inventoryLoans.returnedAt),
            ),
          ),
        );
    } else if (cfg.activeId != null) {
      // Karte in einer Vor-Ausleihe-Spalte (weder „ausgeliehen" noch
      // „zurückgegeben"). War der Vorgang aber fälschlich schon aktiv/
      // zurückgegeben (z. B. Karte versehentlich auf „in Ausleihe" gezogen und
      // danach korrigiert), setzen wir ihn auf „Vertrag bereitgestellt" zurück —
      // damit der Entleiher den Vertrag weiterhin einreichen kann. Den normalen
      // Vertragsfortschritt (requested/contract_provided/contract_signed) rühren
      // wir NICHT an (WHERE-Guard auf active/returned).
      await tx
        .update(inventoryLoans)
        .set({ status: "contract_provided", returnedAt: null })
        .where(
          and(
            eq(inventoryLoans.id, loan.id),
            inArray(inventoryLoans.status, ["active", "returned"]),
          ),
        );
    }
  });
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

/**
 * Auto: Vertrag unterschrieben. Gibt zurück, ob der Status wirklich
 * weitergestellt wurde (false, wenn der Vorgang die Vertragsphase bereits
 * verlassen hat — dann darf auch die Karte nicht mehr bewegt werden).
 */
export async function advanceLoanToContractSigned(
  loanId: number,
): Promise<boolean> {
  const rows = await db
    .update(inventoryLoans)
    .set({ status: "contract_signed" })
    .where(
      and(
        eq(inventoryLoans.id, loanId),
        inArray(inventoryLoans.status, ["requested", "contract_provided"]),
      ),
    )
    .returning({ id: inventoryLoans.id });
  return rows.length > 0;
}

/**
 * Entleiher sendet den Vertrag ein (öffentlich, token-gesichert): Vorgang auf
 * „Vertrag unterschrieben" setzen UND — falls kartengeführt — die verknüpfte
 * Karte in die „Vertrag unterschrieben"-Spalte des Leihboards bewegen, damit der
 * kartenbasierte öffentliche Status-Stepper mitzieht. No-op, wenn der Vorgang
 * nicht (mehr) in der Vertragsphase ist. Gibt zurück, ob etwas passiert ist.
 */
export async function submitLoanContract(loanId: number): Promise<boolean> {
  const [loan] = await db
    .select({
      status: inventoryLoans.status,
      cardId: inventoryLoans.cardId,
    })
    .from(inventoryLoans)
    .where(eq(inventoryLoans.id, loanId))
    .limit(1);
  if (!loan) return false;
  if (loan.status !== "requested" && loan.status !== "contract_provided") {
    return false;
  }
  // 1) Vorgangsstatus weiterstellen — nur fortfahren, wenn wirklich advanced
  //    (sonst hat ein paralleler Schritt den Vorgang schon weitergebracht).
  const advanced = await advanceLoanToContractSigned(loanId);
  if (!advanced) return false;

  // 2) Kartengeführt: Karte NUR aus der Quell-Spalte („Vertrag bereitgestellt")
  //    in die Ziel-Spalte („Vertrag unterschrieben") bewegen — Quell-Gate wie
  //    beim Quittungs-Von→Nach-Zug. Steht die Karte woanders (früher/später),
  //    wird nichts bewegt (nie rückwärts, kein Überspringen).
  if (loan.cardId == null) return true;
  const [card] = await db
    .select({ id: cards.id, boardId: cards.boardId, statusId: cards.statusId })
    .from(cards)
    .where(eq(cards.id, loan.cardId))
    .limit(1);
  if (!card) return true;
  const cols = await db
    .select({ id: boardStatuses.id, name: boardStatuses.name })
    .from(boardStatuses)
    .where(
      and(
        eq(boardStatuses.boardId, card.boardId),
        inArray(boardStatuses.name, [
          LOAN_CONTRACT_PROVIDED_COLUMN,
          LOAN_CONTRACT_SIGNED_COLUMN,
        ]),
      ),
    );
  const from = cols.find((c) => c.name === LOAN_CONTRACT_PROVIDED_COLUMN);
  const to = cols.find((c) => c.name === LOAN_CONTRACT_SIGNED_COLUMN);
  // Quell-Gate: nur bewegen, wenn die Karte in der Quell-Spalte steht.
  if (!from || !to || card.statusId !== from.id) return true;
  const [maxRow] = await db
    .select({ m: sql<number>`coalesce(max(${cards.position}), -1)` })
    .from(cards)
    .where(
      and(
        eq(cards.boardId, card.boardId),
        eq(cards.statusId, to.id),
        isNull(cards.archivedAt),
      ),
    );
  await db
    .update(cards)
    .set({
      statusId: to.id,
      position: (maxRow?.m ?? -1) + 1,
      updatedAt: new Date(),
    })
    .where(eq(cards.id, card.id));
  await db.insert(cardActivity).values({
    cardId: card.id,
    userId: null,
    type: "status",
    detail: "Vertrag vom Entleiher eingesendet → Vertrag unterschrieben",
  });
  return true;
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
  // Summe der aktuell verliehenen Menge dieses Gegenstands (über alle laufenden
  // Vorgänge). Für Einzel-/Gruppen-Stücke 1; für Mengen-Gegenstände die Summe.
  lentQuantity: number;
};

/**
 * Aktuell entliehene Stücke — Grundregel: ein Stück ist NUR dann entliehen,
 * wenn seine Vorgangs-Karte gerade in der „ausgeliehen"-Spalte (in Ausleihe)
 * des Inventar-Boards liegt. Verlässt die Karte diese Spalte, ist das Stück
 * sofort wieder verfügbar (nicht am Vorgangsstatus „festgeklebt").
 *
 * Fallback ohne Aufgabentracking (kein Ziel-Board/keine Karte oder keine
 * Trigger-Spalte gesetzt): der klassische Status 'active' (nicht zurückgegeben).
 */
export async function getActiveLoanMap(
  itemIds: number[],
): Promise<Map<number, ActiveLoan>> {
  if (!itemIds.length) return new Map();
  const rows = await db
    .select({
      itemId: inventoryLoanItems.itemId,
      quantity: inventoryLoanItems.quantity,
      borrower: inventoryLoans.borrower,
      startDate: inventoryLoans.startDate,
      endDate: inventoryLoans.endDate,
      createdAt: inventoryLoans.createdAt,
    })
    .from(inventoryLoanItems)
    .innerJoin(inventoryLoans, eq(inventoryLoans.id, inventoryLoanItems.loanId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryLoanItems.itemId))
    .innerJoin(inventoryBoards, eq(inventoryBoards.id, inventoryItems.boardId))
    .leftJoin(cards, eq(cards.id, inventoryLoans.cardId))
    .where(
      and(
        inArray(inventoryLoanItems.itemId, itemIds),
        or(
          // Kartengeführt: Karte liegt in der „ausgeliehen"-Spalte (und der
          // Vorgang ist nicht bereits zurückgegeben).
          and(
            isNotNull(inventoryBoards.loanActiveStatusId),
            isNotNull(inventoryLoans.cardId),
            eq(cards.statusId, inventoryBoards.loanActiveStatusId),
            isNull(inventoryLoans.returnedAt),
          ),
          // Fallback: klassischer aktiver Vorgang ohne Karten-Trigger.
          and(
            or(
              isNull(inventoryBoards.loanActiveStatusId),
              isNull(inventoryLoans.cardId),
            ),
            eq(inventoryLoans.status, "active"),
            isNull(inventoryLoans.returnedAt),
          ),
        ),
      ),
    )
    .orderBy(desc(inventoryLoans.createdAt));
  // Nach createdAt DESC sortiert → das erste Vorkommen je Gegenstand ist der
  // jüngste Vorgang (liefert borrower/Datum); weitere laufende Vorgänge desselben
  // Mengen-Gegenstands summieren nur noch die verliehene Menge dazu.
  const map = new Map<number, ActiveLoan>();
  for (const r of rows) {
    const existing = map.get(r.itemId);
    if (existing) {
      existing.lentQuantity += r.quantity;
    } else {
      map.set(r.itemId, {
        borrower: r.borrower,
        startDate: r.startDate,
        endDate: r.endDate,
        lentQuantity: r.quantity,
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
