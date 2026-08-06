// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import {
  cards,
  inventoryBoards,
  inventoryItems,
  inventoryLoans,
  users,
} from "../lib/db/schema";
import { createLoanBoardForInventory } from "../lib/boards";
import { createLoanRequest, getLoanByToken } from "../lib/inventory-loans";
import {
  getApplicationStatusByToken,
  resolveApplicationCardId,
} from "../lib/public-status";

/**
 * Regressionstest zur Trennung der Status-Tokens.
 *
 * `cards.token` ist NOT NULL UNIQUE — die Tracking-Karte eines Leihvorgangs
 * bekommt also zwangsläufig einen Token, obwohl sie keinen braucht. Die
 * Antrags-Route prüfte nur auf Feedback-Karten und lieferte für diesen Token
 * eine vollwertige Antrags-Statusseite mit Gegenstandsname, Entleihername und
 * offenem PDF-Upload aus.
 *
 * Der öffentliche Ausleih-Status hängt an einem EIGENEN Token an der
 * Vorgangszeile (`inventory_loans.token`, `/inventar/status/{token}`) und muss
 * unverändert funktionieren — beides wird hier zusammen geprüft, damit die
 * Sperre nicht versehentlich den falschen Token trifft.
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

test("Karten-Token einer Leihkarte ist kein Antrags-Token", async (t) => {
  if (!verfuegbar) return t.skip("keine Datenbank erreichbar");

  const suffix = `t${process.pid}`;
  const [user] = await db
    .insert(users)
    .values({ username: `loantok-${suffix}`, role: "admin" })
    .returning();
  const [inv] = await db
    .insert(inventoryBoards)
    .values({ name: `LoanTok ${suffix}`, ownerId: user.id })
    .returning();
  await createLoanBoardForInventory(inv, `LoanTok ${suffix} – Vorgänge`);

  aufraeumen = async () => {
    await db.delete(inventoryBoards).where(eq(inventoryBoards.id, inv.id));
    await db.delete(users).where(eq(users.id, user.id));
  };

  const [item] = await db
    .insert(inventoryItems)
    .values({ boardId: inv.id, name: "Zelt", quantity: 1 })
    .returning();

  // Öffentliche Anfrage: erzeugt Vorgangs-Token UND Tracking-Karte.
  const { id: loanId, token: vorgangsToken } = await createLoanRequest(
    [{ itemId: item.id, quantity: 1 }],
    {
      borrower: "Testperson",
      borrowerEmail: "test@example.org",
      purpose: "Testzweck",
      startDate: null,
      endDate: null,
      notes: null,
    },
    {
      filename: "ausweis.pdf",
      relPath: `inventory/${item.id}/nicht-vorhanden-${suffix}.pdf`,
      mime: "application/pdf",
      size: 1,
    },
  );

  const [loan] = await db
    .select({ cardId: inventoryLoans.cardId })
    .from(inventoryLoans)
    .where(eq(inventoryLoans.id, loanId))
    .limit(1);
  assert.ok(loan?.cardId, "Vorbedingung: der Vorgang hat eine Tracking-Karte");
  const [card] = await db
    .select({ token: cards.token })
    .from(cards)
    .where(eq(cards.id, loan.cardId))
    .limit(1);
  assert.ok(card?.token, "Vorbedingung: die Karte hat einen Token");

  // 1. Der KARTEN-Token darf auf der Antrags-Route nichts liefern.
  assert.equal(
    await getApplicationStatusByToken(card.token),
    undefined,
    "Antrags-Statusseite darf eine Leih-Tracking-Karte nicht anzeigen",
  );
  assert.equal(
    await resolveApplicationCardId(card.token),
    null,
    "Anhang-Route und öffentliche Server Actions müssen den Token abweisen",
  );

  // 2. Der VORGANGS-Token muss weiterhin funktionieren (/inventar/status/...).
  const perVorgangsToken = await getLoanByToken(vorgangsToken);
  assert.equal(
    perVorgangsToken?.id,
    loanId,
    "der öffentliche Ausleih-Status-Link darf davon nicht betroffen sein",
  );
  assert.notEqual(
    vorgangsToken,
    card.token,
    "Vorgangs- und Karten-Token sind bewusst verschieden",
  );
});
