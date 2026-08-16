// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import {
  boardStatuses,
  cards,
  inventoryBoards,
  inventoryItems,
  inventoryLoanItems,
  inventoryLoans,
  users,
} from "../lib/db/schema";
import { createLoanBoardForInventory } from "../lib/boards";
import { getActiveLoanMap } from "../lib/inventory-loans";
import { generateToken } from "../lib/token";

/**
 * Regressionstest zum dauerhaft blockierten Bestand: Der kartengeführte Zweig
 * von `getActiveLoanMap` prüfte nur „Karte in der Aktiv-Spalte und nicht
 * zurückgegeben" — ohne den Vorgangsstatus. `syncLoanFromCard` kann einen
 * `withdrawn`-Vorgang aber nie mehr anfassen (sein UPDATE ist auf
 * PENDING_LOAN_STATUSES beschränkt), und `withdrawLoan` räumt die Karte nicht
 * weg. Landete die liegengebliebene Karte danach in „in Ausleihe", galt die
 * Menge für immer als verliehen.
 *
 * Ohne den Statusfilter schlägt der zentrale Test hier fehl.
 *
 * Braucht eine erreichbare Datenbank; sonst überspringt er sich selbst.
 */

let verfuegbar = false;
let aufraeumen: (() => Promise<void>) | null = null;

before(async () => {
  try {
    await db.execute("select 1");
    verfuegbar = true;
  } catch {
    verfuegbar = false;
  }
});

after(async () => {
  if (aufraeumen) await aufraeumen();
  await pool.end().catch(() => {});
});

test("zurückgezogener Vorgang blockiert keinen Bestand", async (t) => {
  if (!verfuegbar) return t.skip("keine Datenbank erreichbar");

  const suffix = `t${process.pid}`;
  const [user] = await db
    .insert(users)
    .values({ username: `loanmap-${suffix}`, role: "admin" })
    .returning();
  const [inv] = await db
    .insert(inventoryBoards)
    .values({ name: `LoanMap ${suffix}`, ownerId: user.id })
    .returning();
  await createLoanBoardForInventory(inv, `LoanMap ${suffix} – Vorgänge`);
  const [board] = await db
    .select()
    .from(inventoryBoards)
    .where(eq(inventoryBoards.id, inv.id))
    .limit(1);
  const [item] = await db
    .insert(inventoryItems)
    .values({ boardId: inv.id, name: "Testbank", quantity: 3 })
    .returning();

  aufraeumen = async () => {
    await db.delete(inventoryBoards).where(eq(inventoryBoards.id, inv.id));
    await db.delete(users).where(eq(users.id, user.id));
  };

  // Vorgang anlegen, Karte in die erste Spalte, dann öffentlich zurückziehen.
  const [firstCol] = await db
    .select()
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, board.loanBoardId!))
    .orderBy(boardStatuses.position)
    .limit(1);
  const [card] = await db
    .insert(cards)
    .values({
      boardId: board.loanBoardId!,
      statusId: firstCol.id,
      title: "Testbank ×2",
      applicant: "Testperson",
      token: generateToken(),
    })
    .returning();
  const [loan] = await db
    .insert(inventoryLoans)
    .values({
      itemId: item.id,
      status: "withdrawn", // öffentlich zurückgezogen
      borrower: "Testperson",
      requestedQuantity: 2,
      cardId: card.id,
    })
    .returning();
  await db
    .insert(inventoryLoanItems)
    .values({ loanId: loan.id, itemId: item.id, quantity: 2 });

  // Die liegengebliebene Karte landet in der Aktiv-Spalte.
  await db
    .update(cards)
    .set({ statusId: board.loanActiveStatusId! })
    .where(eq(cards.id, card.id));

  const map = await getActiveLoanMap([item.id]);
  assert.equal(
    map.get(item.id)?.lentQuantity ?? 0,
    0,
    "zurückgezogener Vorgang darf keine Menge belegen",
  );

  // Gegenprobe: derselbe Vorgang als 'active' MUSS belegen.
  await db
    .update(inventoryLoans)
    .set({ status: "active" })
    .where(eq(inventoryLoans.id, loan.id));
  const map2 = await getActiveLoanMap([item.id]);
  assert.equal(map2.get(item.id)?.lentQuantity ?? 0, 2);

  // Ebenso muss 'rejected' freigeben.
  await db
    .update(inventoryLoans)
    .set({ status: "rejected" })
    .where(eq(inventoryLoans.id, loan.id));
  const map3 = await getActiveLoanMap([item.id]);
  assert.equal(map3.get(item.id)?.lentQuantity ?? 0, 0);
});
