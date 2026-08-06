// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import "dotenv/config";
import { access } from "node:fs/promises";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "../lib/db";
import {
  attachments,
  inventoryBoards,
  inventoryItems,
  inventoryLoans,
  users,
} from "../lib/db/schema";
import { absPath, saveAntragBuffer } from "../lib/attachments";
import { createLoanBoardForInventory } from "../lib/boards";
import { createLoan, deleteLoan } from "../lib/inventory-loans";

/**
 * Regressionstest zur Dateileiche beim Löschen eines Leihvorgangs.
 *
 * Die Tracking-Karte eines Vorgangs ist eine ganz normale Kanban-Karte — jedes
 * Board-Mitglied kann PDFs an sie hängen. `deleteLoan` löschte die Karte, ohne
 * vorher die Pfade ihrer Anhänge zu sichern: `attachments.card_id` ist
 * ON DELETE CASCADE, die Zeilen verschwanden also, die DATEIEN im
 * Upload-Verzeichnis blieben unauffindbar liegen.
 *
 * Ohne den Fix in `deleteLoan` existiert die Datei unten nach dem Löschen noch.
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

const existiert = async (relPath: string): Promise<boolean> => {
  try {
    await access(absPath(relPath));
    return true;
  } catch {
    return false;
  }
};

test("Karten-Anhänge verschwinden mit dem gelöschten Vorgang", async (t) => {
  if (!verfuegbar) return t.skip("keine Datenbank erreichbar");

  const suffix = `t${process.pid}`;
  const [user] = await db
    .insert(users)
    .values({ username: `loandel-${suffix}`, role: "admin" })
    .returning();
  const [inv] = await db
    .insert(inventoryBoards)
    .values({ name: `LoanDel ${suffix}`, ownerId: user.id })
    .returning();
  await createLoanBoardForInventory(inv, `LoanDel ${suffix} – Vorgänge`);

  aufraeumen = async () => {
    await db.delete(inventoryBoards).where(eq(inventoryBoards.id, inv.id));
    await db.delete(users).where(eq(users.id, user.id));
  };

  const [item] = await db
    .insert(inventoryItems)
    .values({ boardId: inv.id, name: "Beamer", quantity: 1 })
    .returning();

  const loanId = await createLoan([{ itemId: item.id, quantity: 1 }], user.id, {
    borrower: "Testperson",
    borrowerEmail: null,
    purpose: null,
    startDate: null,
    endDate: null,
    notes: null,
  });

  const [loan] = await db
    .select({ cardId: inventoryLoans.cardId })
    .from(inventoryLoans)
    .where(eq(inventoryLoans.id, loanId))
    .limit(1);
  assert.ok(loan?.cardId, "Vorbedingung: der Vorgang hat eine Tracking-Karte");

  // Echte Datei anlegen und als Karten-Anhang eintragen (wie ein interner Upload).
  const saved = await saveAntragBuffer(
    loan.cardId,
    "vertrag.pdf",
    Buffer.from("%PDF-1.4 test"),
    "application/pdf",
  );
  await db.insert(attachments).values({
    cardId: loan.cardId,
    kind: "other",
    filename: saved.filename,
    path: saved.relPath,
    mime: saved.mime,
    size: saved.size,
    uploadedBy: null,
  });
  assert.equal(
    await existiert(saved.relPath),
    true,
    "Vorbedingung: die Datei liegt im Upload-Verzeichnis",
  );

  await deleteLoan(loanId);

  assert.equal(
    await existiert(saved.relPath),
    false,
    "Datei der Tracking-Karte muss mit dem Vorgang vom Datenträger verschwinden",
  );
});
