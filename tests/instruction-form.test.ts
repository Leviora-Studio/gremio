// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  instructionNumber,
  nextInstructionFilename,
} from "../lib/instruction-form";

test("Anweisungen beginnen bei 1 und laufen ab der höchsten Nummer weiter", () => {
  assert.equal(nextInstructionFilename([]), "Anweisung 1.pdf");
  assert.equal(
    nextInstructionFilename([
      "Anweisung 1.pdf",
      "Anweisung 2.pdf", // darf auch ein normaler manueller Upload sein
    ]),
    "Anweisung 3.pdf",
  );
  assert.equal(
    nextInstructionFilename(["Anweisung 1.pdf", "Anweisung 3.pdf"]),
    "Anweisung 4.pdf",
    "gelöschte Lücken werden nicht wiederverwendet",
  );
});

test("nur exakte PDF-Namen des Anweisungsschemas beeinflussen die Nummer", () => {
  assert.equal(instructionNumber("Anweisung.pdf"), 1);
  assert.equal(instructionNumber("anweisung 7.PDF"), 7);
  assert.equal(instructionNumber("Anweisung 0.pdf"), null);
  assert.equal(instructionNumber("Meine Anweisung 12.pdf"), null);
  assert.equal(instructionNumber("Anweisung 9.docx"), null);
  assert.equal(
    nextInstructionFilename([
      "Anweisung.pdf",
      "anweisung 7.PDF",
      "Meine Anweisung 99.pdf",
    ]),
    "Anweisung 8.pdf",
  );
});
