// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  instructionTemplateVersion,
  instructionNumber,
  isUsableInstructionTemplatePdf,
  nextInstructionFilename,
} from "../lib/instruction-form";
import { PDFDocument } from "pdf-lib";

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

test("template versions distinguish replacements even within the same millisecond", () => {
  const uploadedAt = new Date("2026-09-04T12:00:00.000Z");
  const first = instructionTemplateVersion({ path: "forms/first.pdf", uploadedAt });
  const second = instructionTemplateVersion({ path: "forms/second.pdf", uploadedAt });
  assert.notEqual(first, second);
  assert.equal(
    first,
    instructionTemplateVersion({ path: "forms/first.pdf", uploadedAt }),
  );
  assert.doesNotMatch(first, /forms|first/);
});

test("instruction templates need a readable, unencrypted PDF page", async () => {
  const valid = await PDFDocument.create();
  valid.addPage();
  const empty = await PDFDocument.create();
  assert.equal(
    await isUsableInstructionTemplatePdf(await valid.save()),
    true,
  );
  assert.equal(
    await isUsableInstructionTemplatePdf(
      await empty.save({ addDefaultPage: false }),
    ),
    false,
  );
  assert.equal(
    await isUsableInstructionTemplatePdf(Buffer.from("not a pdf")),
    false,
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
