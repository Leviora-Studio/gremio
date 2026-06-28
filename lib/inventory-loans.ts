// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventoryDefects,
  inventoryLoans,
  type InventoryDefect,
  type InventoryLoan,
} from "@/lib/db/schema";
import { generateToken, isTokenConflict } from "@/lib/token";

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

/** Alle Entleihvorgänge eines Gegenstands (neueste zuerst). */
export async function listLoans(itemId: number): Promise<InventoryLoan[]> {
  return db
    .select()
    .from(inventoryLoans)
    .where(eq(inventoryLoans.itemId, itemId))
    .orderBy(desc(inventoryLoans.createdAt));
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

/** Neuen Entleihvorgang anlegen (offen = aktuell entliehen). */
export async function createLoan(
  itemId: number,
  createdBy: number | null,
  data: LoanInput,
): Promise<number> {
  const [row] = await db
    .insert(inventoryLoans)
    .values({ itemId, createdBy, ...data })
    .returning({ id: inventoryLoans.id });
  return row.id;
}

/** Vorgang als zurückgegeben markieren (beendet den laufenden Entleihzeitraum). */
export async function returnLoan(loanId: number): Promise<void> {
  await db
    .update(inventoryLoans)
    .set({ returnedAt: new Date(), status: "returned" })
    .where(eq(inventoryLoans.id, loanId));
}

export async function deleteLoan(loanId: number): Promise<void> {
  await db.delete(inventoryLoans).where(eq(inventoryLoans.id, loanId));
}

/** Öffentliche Entleih-Anfrage anlegen (status='requested' + Status-Token). */
export async function createLoanRequest(
  itemId: number,
  data: LoanInput,
): Promise<{ id: number; token: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateToken();
    try {
      const [row] = await db
        .insert(inventoryLoans)
        .values({ itemId, status: "requested", token, createdBy: null, ...data })
        .returning({ id: inventoryLoans.id });
      return { id: row.id, token };
    } catch (e) {
      if (isTokenConflict(e)) continue;
      throw e;
    }
  }
  throw new Error("Konnte keinen eindeutigen Token erzeugen.");
}

/** Anfrage annehmen → laufender Vorgang. */
export async function approveLoan(loanId: number): Promise<void> {
  await db
    .update(inventoryLoans)
    .set({ status: "active" })
    .where(
      and(
        eq(inventoryLoans.id, loanId),
        eq(inventoryLoans.status, "requested"),
      ),
    );
}

/** Anfrage ablehnen. */
export async function rejectLoan(loanId: number): Promise<void> {
  await db
    .update(inventoryLoans)
    .set({ status: "rejected" })
    .where(
      and(
        eq(inventoryLoans.id, loanId),
        eq(inventoryLoans.status, "requested"),
      ),
    );
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
      itemId: inventoryLoans.itemId,
      borrower: inventoryLoans.borrower,
      startDate: inventoryLoans.startDate,
      endDate: inventoryLoans.endDate,
      createdAt: inventoryLoans.createdAt,
    })
    .from(inventoryLoans)
    .where(
      and(
        inArray(inventoryLoans.itemId, itemIds),
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

export async function listDefects(itemId: number): Promise<InventoryDefect[]> {
  return db
    .select()
    .from(inventoryDefects)
    .where(eq(inventoryDefects.itemId, itemId))
    .orderBy(desc(inventoryDefects.createdAt));
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
