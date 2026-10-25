// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { applyPdfEdits, readPdfFields, sanitizeWinAnsi } from "../lib/pdf-edit";

/**
 * Regression: Der WinAnsi-Filter des PDF-Editors machte aus jedem
 * Zeilenumbruch ein „?" (Freitext und mehrzeilige Formularfelder), und
 * zerlegte Umlaute aus Copy & Paste („u" + „¨") wurden zu „u?".
 */

test("sanitizeWinAnsi keeps line breaks only where they can be stored", () => {
  assert.equal(sanitizeWinAnsi("A\nB\r\nC\rD", { multiline: true }), "A\nB\nC\nD");
  assert.equal(sanitizeWinAnsi("A\nB\r\nC"), "A B C");
  assert.equal(sanitizeWinAnsi("a\tb"), "a b");
});

test("sanitizeWinAnsi keeps every Helvetica glyph and only marks truly missing ones", () => {
  // Zerlegte Umlaute (macOS/PDF-Copy) werden zusammengesetzt.
  assert.equal(sanitizeWinAnsi("für Müller"), "für Müller");
  // Alles in WinAnsi bleibt unverändert, auch typografische Zeichen.
  const winAnsi = "äöüÄÖÜß € „Zitat“ ‚x‘ – — … • ™ ‰ Œ œ Š š Ž ž ½ ° §";
  assert.equal(sanitizeWinAnsi(winAnsi), winAnsi);
  // Ohne Glyphe: auf den Grundbuchstaben zurückführen statt „?".
  assert.equal(sanitizeWinAnsi("Łódź Čech ﬁnal 5 € 3−2"), "Lódz Cech final 5 € 3-2");
  // Unsichtbare Zeichen verschwinden statt als „?"/„-" im Wort zu landen.
  assert.equal(sanitizeWinAnsi("Weich­trenn​ung﻿"), "Weichtrennung");
  assert.equal(sanitizeWinAnsi("Emoji 😀"), "Emoji ?");
});

async function formPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const form = doc.getForm();
  const single = form.createTextField("single");
  single.addToPage(page, { x: 30, y: 500, width: 200, height: 20 });
  const multi = form.createTextField("multi");
  multi.enableMultiline();
  multi.addToPage(page, { x: 30, y: 380, width: 300, height: 100 });
  const limited = form.createTextField("limited");
  limited.setMaxLength(4);
  limited.addToPage(page, { x: 30, y: 340, width: 100, height: 20 });
  // Leeres Rich-Text-Feld: pdf-lib wirft bei getText() statt "" zu liefern.
  const rich = form.createTextField("rich");
  rich.addToPage(page, { x: 30, y: 300, width: 100, height: 20 });
  rich.acroField.setFlags(rich.acroField.getFlags() | (1 << 25));
  return Buffer.from(await doc.save());
}

test("form fields keep line breaks in multiline fields and report limits", async () => {
  const fields = await readPdfFields(await formPdf());
  const byName = new Map(fields.map((f) => [f.name, f]));
  assert.equal(byName.get("multi")?.multiline, true);
  assert.equal(byName.get("single")?.multiline, false);
  assert.equal(byName.get("limited")?.maxLength, 4);
  assert.equal(byName.get("rich")?.value, "", "one unreadable field must not hide all others");

  const { pdf, failed } = await applyPdfEdits(await formPdf(), {
    fields: [
      { name: "single", value: "Zeile 1\nZeile 2" },
      { name: "multi", value: "Für Müller\nZweite Zeile\n\nAbsatz • Ende" },
    ],
  });
  assert.deepEqual(failed, []);
  const after = new Map((await readPdfFields(pdf)).map((f) => [f.name, f.value]));
  assert.equal(after.get("single"), "Zeile 1 Zeile 2");
  assert.equal(after.get("multi"), "Für Müller\nZweite Zeile\n\nAbsatz • Ende");
});

test("free text stays multiline, keeps its size and can be removed", async () => {
  const blank = await PDFDocument.create();
  blank.addPage([400, 600]);
  const base = Buffer.from(await blank.save());
  const sizeRatio = 16 / 600;

  const first = await applyPdfEdits(base, {
    texts: [{ page: 0, xRatio: 0.1, yRatio: 0.1, text: "Erste Zeile\r\nZweite Zeile mit WWWWWW", sizeRatio }],
  });
  let [field] = (await readPdfFields(first.pdf)).filter((f) => f.gremioText);
  assert.equal(field.value, "Erste Zeile\nZweite Zeile mit WWWWWW");
  assert.equal(field.multiline, true);
  assert.ok(Math.abs((field.sizeRatio ?? 0) - sizeRatio) < 1e-6, "multiline free text must not shrink to 12 pt");
  // Box breit genug für die längste Zeile (mit der echten Schrift gemessen).
  const doc = await PDFDocument.load(first.pdf);
  const widget = doc.getForm().getTextField(field.name).acroField.getWidgets()[0];
  const font = await doc.embedFont("Helvetica");
  assert.ok(widget.getRectangle().width >= font.widthOfTextAtSize("Zweite Zeile mit WWWWWW", 16));

  const second = await applyPdfEdits(first.pdf, {
    texts: [{ name: field.name, page: 0, xRatio: field.rect!.xRatio, yRatio: field.rect!.yRatio, text: "Geändert", sizeRatio: field.sizeRatio }],
  });
  [field] = (await readPdfFields(second.pdf)).filter((f) => f.gremioText);
  assert.equal(field.value, "Geändert");

  const removed = await applyPdfEdits(second.pdf, {
    texts: [{ name: field.name, page: 0, xRatio: 0, yRatio: 0, text: "" }],
  });
  assert.equal((await readPdfFields(removed.pdf)).length, 0);
  const annots = (await PDFDocument.load(removed.pdf)).getPage(0).node.Annots();
  assert.equal(annots?.size() ?? 0, 0, "removed free text leaves no widget behind");
});

test("free text cannot hijack or delete a real form field", async () => {
  const { pdf } = await applyPdfEdits(await formPdf(), {
    texts: [{ name: "single", page: 0, xRatio: 0, yRatio: 0, text: "" }],
  });
  assert.ok((await readPdfFields(pdf)).some((f) => f.name === "single"));
});
