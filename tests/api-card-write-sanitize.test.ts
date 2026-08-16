// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../lib/db";
import { cardWriteSchema } from "../lib/api-cards";

/**
 * Regressionstest zur fehlenden Eingangsbereinigung der REST-API.
 *
 * `cardWriteSchema` bereinigte nur `title` und `applicant`. `budgetTitle`,
 * `number`, `decisionRef`, `notes` und `applicantNote` gingen roh in den
 * UPDATE — ein NUL-Zeichen darin lehnt PostgreSQL ab, und weil der Handler den
 * Datenbankfehler nicht abfängt, antwortete `PATCH /api/v1/cards/{id}` mit
 * einem 500er statt mit einer Validierungsmeldung. CLAUDE.md sichert dagegen
 * ausdrücklich zu, dass Formular, REST-API und öffentliche API alle über
 * `lib/text.ts` laufen.
 *
 * Zusätzlich hielt die alte Bereinigung von `applicant` den Typ nicht fest:
 * `applicant: 42` wurde still zu einem leeren String (200 OK), obwohl die
 * OpenAPI-Spezifikation `string` zusichert.
 *
 * Steuerzeichen stehen hier bewusst als Escape-Sequenz (`\u0000`) — literale
 * Steuerzeichen im Quelltext sind unsichtbar und gehen beim Kopieren verloren.
 *
 * Braucht keine Datenbank — geprüft wird ausschließlich das zod-Schema.
 */

const NUL = "\u0000";

after(async () => {
  // lib/api-cards zieht lib/db mit; Pool schließen, damit der Runner endet.
  await pool.end().catch(() => {});
});

test("NUL wird in allen Freitextfeldern entfernt", () => {
  const parsed = cardWriteSchema.safeParse({
    title: `Grill${NUL}abend`,
    applicant: `Max\tMustermann`,
    budgetTitle: `427 11${NUL}`,
    number: `A1${NUL}_2026`,
    decisionRef: `Beschluss 12/2026${NUL}`,
    notes: `Zeile 1\r\nZeile 2${NUL}!`,
    applicantNote: `Bitte${NUL} Quittung nachreichen`,
  });
  if (!parsed.success) {
    assert.fail(`Bereinigte Eingabe muss gültig sein: ${parsed.error.message}`);
  }
  const d = parsed.data;

  for (const wert of [
    d.title,
    d.applicant,
    d.budgetTitle,
    d.number,
    d.decisionRef,
    d.notes,
    d.applicantNote,
  ]) {
    assert.equal(typeof wert, "string");
    assert.ok(
      !(wert as string).includes(NUL),
      `NUL darf nicht durchkommen: ${JSON.stringify(wert)}`,
    );
  }

  assert.equal(d.title, "Grillabend");
  // Einzeilig: Tabulator wird zu einem Leerzeichen.
  assert.equal(d.applicant, "Max Mustermann");
  assert.equal(d.budgetTitle, "427 11");
  assert.equal(d.number, "A1_2026");
  assert.equal(d.decisionRef, "Beschluss 12/2026");
  // Mehrzeilig: CRLF wird zu LF vereinheitlicht, innere Umbrüche BLEIBEN.
  assert.equal(d.notes, "Zeile 1\nZeile 2!");
  assert.equal(d.applicantNote, "Bitte Quittung nachreichen");
});

test("Längengrenzen greifen NACH der Bereinigung", () => {
  // 60 sichtbare Zeichen plus Steuerzeichen: nach der Bereinigung genau 60 und
  // damit zulässig (vorher zählte das Schema die Rohlänge mit).
  const ok = cardWriteSchema.safeParse({
    budgetTitle: `${"a".repeat(60)}${NUL}${NUL}${NUL}`,
  });
  if (!ok.success) {
    assert.fail("60 Zeichen nach Bereinigung müssen zulässig sein");
  }
  assert.equal(ok.data.budgetTitle, "a".repeat(60));

  const zuLang = cardWriteSchema.safeParse({ budgetTitle: "a".repeat(61) });
  assert.equal(zuLang.success, false, "61 Zeichen müssen abgewiesen werden");
});

test("Nicht-Strings werden abgewiesen statt still zu leeren Werten", () => {
  for (const feld of [
    "applicant",
    "budgetTitle",
    "number",
    "decisionRef",
    "notes",
    "applicantNote",
  ] as const) {
    const res = cardWriteSchema.safeParse({ [feld]: 42 });
    assert.equal(
      res.success,
      false,
      `${feld}: Zahl statt Zeichenkette muss abgewiesen werden, nicht still ""`,
    );
  }
});

test("null bleibt null (Feld leeren), fehlendes Feld bleibt unberührt", () => {
  const parsed = cardWriteSchema.safeParse({ notes: null, budgetTitle: null });
  if (!parsed.success) assert.fail("null muss zulässig sein");
  assert.equal(parsed.data.notes, null);
  assert.equal(parsed.data.budgetTitle, null);
  assert.equal("applicantNote" in parsed.data, false);
});
