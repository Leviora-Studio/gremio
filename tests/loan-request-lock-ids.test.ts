// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../lib/db";
import { loanRequestLockIds, type LoanUnit } from "../lib/inventory-loans";

/**
 * Regressionstest zur Überbuchung bei gleichzeitigen Leih-Anfragen.
 *
 * `createLoanRequest` sperrte nur `units[0]` (das Leit-Stück), reservierte aber
 * ALLE Stücke der Anfrage. Eine Obergruppen-Anfrage über [A, B] nahm damit nur
 * den Lock auf A; eine gleichzeitige Einzel-/Mengen-Anfrage auf B (erreichbar
 * über `/inventar/{id}/anfrage?item=B`) sperrte nur B, wartete also nicht, sah
 * dieselbe freie Menge und buchte denselben Bestand ein zweites Mal.
 *
 * Die Sperrmenge muss deshalb ALLE beteiligten Stücke abdecken — und
 * aufsteigend sortiert sein, damit zwei Anfragen mit überlappenden Stücken die
 * Sperren in derselben Reihenfolge nehmen und sich nicht verklemmen können.
 *
 * Braucht keine Datenbank — geprüft wird die reine Sperrmengen-Berechnung.
 */

const unit = (itemId: number, quantity = 1): LoanUnit => ({ itemId, quantity });

after(async () => {
  // lib/inventory-loans zieht lib/db mit; Pool schließen, damit der Runner endet.
  await pool.end().catch(() => {});
});

test("alle beteiligten Stücke werden gesperrt, nicht nur das Leit-Stück", () => {
  const units = [unit(7, 3), unit(2, 1), unit(5, 2)];
  const ids = loanRequestLockIds(units);
  for (const u of units) {
    assert.ok(
      ids.includes(u.itemId),
      `Stück ${u.itemId} wird reserviert, muss also auch gesperrt werden`,
    );
  }
});

test("Sperren werden aufsteigend genommen (deadlock-frei)", () => {
  // Zwei Anfragen mit überlappender Stückmenge, in unterschiedlicher Reihenfolge
  // zusammengestellt: Die Sperrreihenfolge muss identisch sein.
  const a = loanRequestLockIds([unit(9), unit(4), unit(1)]);
  const b = loanRequestLockIds([unit(1), unit(9), unit(4)]);
  assert.deepEqual(a, [1, 4, 9]);
  assert.deepEqual(a, b);
});

test("Doppelte Stück-IDs ergeben genau eine Sperre", () => {
  assert.deepEqual(loanRequestLockIds([unit(3, 2), unit(3, 1), unit(8)]), [3, 8]);
});

test("Einzelstück-Anfrage sperrt genau dieses Stück", () => {
  assert.deepEqual(loanRequestLockIds([unit(42, 5)]), [42]);
});
