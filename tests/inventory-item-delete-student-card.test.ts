// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import {
  inventoryAttachments,
  inventoryBoards,
  inventoryItems,
  inventoryLoans,
  users,
} from "../lib/db/schema";
import { createLoanBoardForInventory } from "../lib/boards";
import { createLoan, removeLoanItem } from "../lib/inventory-loans";
import { deleteInventoryItem } from "../lib/inventory-items";

/**
 * Regressionstest zum verwaisten Studierendenausweis.
 *
 * `deleteInventoryItem` sammelte nur die Anhänge, die AM GELÖSCHTEN Gegenstand
 * hängen. Der Ausweis einer öffentlichen Leih-Anfrage hängt aber am LEIT-Stück
 * des Vorgangs — und die Leit-Rolle wandert, sobald ein Verwalter das
 * ursprüngliche Leit-Stück über `removeLoanItem` aus dem Vorgang nimmt.
 *
 * Wird danach das NEUE Leit-Stück gelöscht, nimmt der FK-Cascade
 * (`inventory_loans.item_id` ON DELETE CASCADE) zwar den Vorgang mit, den
 * Ausweis aber nicht: `inventory_attachments.loan_id` ist ON DELETE SET NULL.
 * Das Ausweisdokument blieb damit unzugeordnet und dauerhaft am ursprünglichen
 * Gegenstand hängen — genau das, was `deleteLoan` seit jeher verhindert.
 *
 * Ohne den Fix in `deleteInventoryItem` ist die Zeile unten noch da.
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

test("Ausweis verschwindet mit dem cascadierten Vorgang", async (t) => {
  if (!verfuegbar) return t.skip("keine Datenbank erreichbar");

  const suffix = `t${process.pid}`;
  const [user] = await db
    .insert(users)
    .values({ username: `sccascade-${suffix}`, role: "admin" })
    .returning();
  const [inv] = await db
    .insert(inventoryBoards)
    .values({ name: `SC ${suffix}`, ownerId: user.id })
    .returning();
  await createLoanBoardForInventory(inv, `SC ${suffix} – Vorgänge`);

  aufraeumen = async () => {
    await db.delete(inventoryBoards).where(eq(inventoryBoards.id, inv.id));
    await db.delete(users).where(eq(users.id, user.id));
  };

  // Zwei Einzelstücke derselben Obergruppe.
  const [itemA] = await db
    .insert(inventoryItems)
    .values({
      boardId: inv.id,
      name: "Bierbank A",
      groupName: "Bierbank",
      quantity: 1,
    })
    .returning();
  const [itemB] = await db
    .insert(inventoryItems)
    .values({
      boardId: inv.id,
      name: "Bierbank B",
      groupName: "Bierbank",
      quantity: 1,
    })
    .returning();

  // Vorgang über beide Stücke; Leit-Stück ist A.
  const loanId = await createLoan(
    [
      { itemId: itemA.id, quantity: 1 },
      { itemId: itemB.id, quantity: 1 },
    ],
    user.id,
    {
      borrower: "Testperson",
      borrowerEmail: null,
      purpose: null,
      startDate: null,
      endDate: null,
      notes: null,
    },
  );

  // Ausweis wie bei einer öffentlichen Anfrage: am Leit-Stück, an den Vorgang
  // gebunden. Der Pfad muss nicht existieren — deleteStoredFile schluckt das.
  const [ausweis] = await db
    .insert(inventoryAttachments)
    .values({
      itemId: itemA.id,
      loanId,
      kind: "student_card",
      filename: "ausweis.pdf",
      path: `inventory/${itemA.id}/nicht-vorhanden-${suffix}.pdf`,
      mime: "application/pdf",
      size: 1,
      uploadedBy: null,
    })
    .returning();

  // Leit-Rolle wandert von A nach B (A aus dem Vorgang genommen).
  await removeLoanItem(loanId, itemA.id);
  const [nachUmzug] = await db
    .select({ itemId: inventoryLoans.itemId })
    .from(inventoryLoans)
    .where(eq(inventoryLoans.id, loanId))
    .limit(1);
  assert.equal(
    nachUmzug?.itemId,
    itemB.id,
    "Vorbedingung: die Leit-Rolle muss auf B gewandert sein",
  );

  // Neues Leit-Stück löschen → der Vorgang verschwindet per Cascade.
  await deleteInventoryItem(itemB.id);
  const [restVorgang] = await db
    .select({ id: inventoryLoans.id })
    .from(inventoryLoans)
    .where(eq(inventoryLoans.id, loanId))
    .limit(1);
  assert.equal(restVorgang, undefined, "Vorbedingung: Vorgang ist cascadiert");

  // Der Ausweis darf NICHT als unzugeordnetes Dokument an A zurückbleiben.
  const rest = await db
    .select({ id: inventoryAttachments.id })
    .from(inventoryAttachments)
    .where(
      and(
        eq(inventoryAttachments.id, ausweis.id),
        eq(inventoryAttachments.kind, "student_card"),
      ),
    );
  assert.equal(
    rest.length,
    0,
    "Studierendenausweis des cascadierten Vorgangs muss mitgelöscht werden",
  );
});
