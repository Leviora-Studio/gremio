// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import {
  inventoryAttachments,
  inventoryBoards,
  inventoryItems,
  inventoryLoans,
  users,
} from "../lib/db/schema";
import { createLoanRequest } from "../lib/inventory-loans";
import { displayFileName } from "../lib/attachments";

/**
 * Regressionstest zur fehlenden Eingangsbereinigung der öffentlichen
 * Leih-Anfrage: `createLoanRequest` reichte borrower/purpose/E-Mail roh in den
 * INSERT durch. Ein NUL-Zeichen (das PostgreSQL in `text` ablehnt) ließ die
 * Anfrage mit einem von außen auslösbaren 500 abstürzen, statt bereinigt
 * gespeichert zu werden — im Widerspruch zur dokumentierten Eingangsgrenze
 * (`lib/text.ts`, CLAUDE.md „Eingangsbereinigung freier Texte").
 *
 * Ohne `normalizeLoanInput` schlägt der zentrale Test hier mit
 * „invalid byte sequence for encoding UTF8: 0x00" fehl.
 *
 * Braucht eine erreichbare Datenbank; sonst überspringt er sich selbst.
 */

const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);

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

test("öffentliche Leih-Anfrage bereinigt NUL/Steuerzeichen statt 500", async (t) => {
  if (!verfuegbar) return t.skip("keine Datenbank erreichbar");

  const suffix = `t${process.pid}`;
  const [user] = await db
    .insert(users)
    .values({ username: `loansan-${suffix}`, role: "admin" })
    .returning();
  const [inv] = await db
    .insert(inventoryBoards)
    .values({ name: `LoanSan ${suffix}`, ownerId: user.id })
    .returning();
  const [item] = await db
    .insert(inventoryItems)
    .values({ boardId: inv.id, name: "Testbeamer", quantity: 2 })
    .returning();

  aufraeumen = async () => {
    await db.delete(inventoryBoards).where(eq(inventoryBoards.id, inv.id));
    await db.delete(users).where(eq(users.id, user.id));
  };

  // Genau die Werte, die ein manipulierter Client schicken kann: NUL im Namen,
  // NUL in der E-Mail (das Regex-Muster der Action lässt NUL durch, weil NUL
  // kein \s ist), TAB im Zweck.
  const { id } = await createLoanRequest(
    [{ itemId: item.id, quantity: 1 }],
    {
      borrower: `Max${NUL} Mustermann`,
      borrowerEmail: `max${NUL}@example.org`,
      purpose: `Grillabend${TAB}FB5`,
      startDate: null,
      endDate: null,
      notes: null,
    },
    {
      filename: "ausweis.pdf",
      relPath: `inventory/${item.id}/test-ausweis.pdf`,
      mime: "application/pdf",
      size: 4,
    },
  );

  const [loan] = await db
    .select()
    .from(inventoryLoans)
    .where(eq(inventoryLoans.id, id))
    .limit(1);
  assert.ok(loan, "Vorgang muss angelegt sein");
  assert.equal(loan.borrower, "Max Mustermann");
  assert.equal(loan.borrowerEmail, "max@example.org");
  assert.equal(loan.purpose, "Grillabend FB5");

  // Der Pflicht-Ausweis hängt als interne Anhang-Zeile am Vorgang.
  const [att] = await db
    .select()
    .from(inventoryAttachments)
    .where(eq(inventoryAttachments.loanId, id))
    .limit(1);
  assert.equal(att?.kind, "student_card");
});

test("displayFileName entfernt Steuer- und Zero-Width-Zeichen aus Anzeigenamen", () => {
  // Der Anzeigename eines Uploads landet in der Datenbank — NUL ließ den
  // Insert der Anhang-Zeile werfen (öffentl. Studierendenausweis/Leihvertrag).
  assert.equal(displayFileName(`quittung${NUL}.pdf`), "quittung.pdf");
  assert.equal(displayFileName(`mein${TAB}scan.jpg`), "mein scan.jpg");
  // Nur-unsichtbare Namen fallen auf den neutralen Platzhalter zurück.
  assert.equal(displayFileName(`${NUL}${NUL}`), "datei");
  // Umlaute und normale Namen bleiben unangetastet.
  assert.equal(displayFileName("Übungsplan 2026.pdf"), "Übungsplan 2026.pdf");
  const long = displayFileName(`${"界".repeat(200)}.pdf`);
  assert.ok(Buffer.byteLength(long) <= 255);
  assert.match(long, /\.pdf$/);
  assert.ok(!long.includes("\uFFFD"), "UTF-8 truncation never splits a character");
});
