// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { extractPdfText, PdfTextError } from "../lib/pdf-text";

test("PDF text includes saved text, checkbox, radio and choice values without changing bytes", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  page.drawText("Antrag Kulturabend", { x: 30, y: 780 });
  const form = pdf.getForm();
  const applicant = form.createTextField("Antragsteller");
  applicant.setText("Anna Beispiel");
  applicant.addToPage(page, { y: 600 });
  const amount = form.createTextField("Betrag");
  amount.setText("123,45 Euro");
  amount.addToPage(page, { y: 500 });
  const checked = form.createCheckBox("Bestaetigt");
  checked.addToPage(page, { y: 400 });
  checked.check();
  const unchecked = form.createCheckBox("WeitereFoerderung");
  unchecked.addToPage(page, { y: 350 });
  const radio = form.createRadioGroup("Entscheidung");
  radio.addOptionToPage("Ja", page, { y: 300 });
  radio.addOptionToPage("Nein", page, { y: 250 });
  radio.select("Ja");
  const choice = form.createDropdown("Ort");
  choice.addOptions(["Koethen", "Dessau"]);
  choice.select("Koethen");
  choice.addToPage(page, { y: 200 });
  pdf.addPage().drawText("Zweite Seite", { x: 30, y: 600 });
  pdf.addPage(); // Represents a page with no extractable text layer.
  const bytes = await pdf.save();
  const hash = () => createHash("sha256").update(bytes).digest("hex");
  const before = hash();
  const result = await extractPdfText(bytes, 1, 1);
  assert.equal(hash(), before);
  assert.equal(result.totalPages, 3);
  assert.equal(result.nextPage, 2);
  assert.equal(result.truncated, false);
  assert.match(result.text, /Antrag Kulturabend/);
  assert.match(result.text, /Antragsteller: Anna Beispiel/);
  assert.match(result.text, /Betrag: 123,45 Euro/);
  const fields = Object.fromEntries(
    result.pages[0].formFields.map((field) => [field.name, field.value]),
  );
  assert.equal(fields.Bestaetigt, "Yes");
  assert.equal(fields.WeitereFoerderung, "Off");
  // Preserve PDF export values for radios; these can differ from their display label.
  assert.ok(fields.Entscheidung && fields.Entscheidung !== "Off");
  assert.equal(fields.Ort, "Koethen");
  const rest = await extractPdfText(bytes, 2, 2);
  assert.equal(rest.nextPage, null);
  assert.match(rest.pages[0].text, /Zweite Seite/);
  assert.equal(rest.pages[1].hasText, false);
  assert.match(rest.warnings.join(" "), /OCR/);
  await assert.rejects(
    extractPdfText(bytes, 4),
    (error: unknown) => error instanceof PdfTextError && error.status === 400,
  );
});

test("malformed PDFs and invalid page requests produce explicit errors", async () => {
  await assert.rejects(
    extractPdfText(Buffer.from("not a PDF")),
    (error: unknown) => error instanceof PdfTextError && error.status === 422,
  );
  await assert.rejects(
    extractPdfText(new Uint8Array(), 0),
    (error: unknown) => error instanceof PdfTextError && error.status === 400,
  );
  await assert.rejects(
    extractPdfText(new Uint8Array(), 1, 21),
    (error: unknown) => error instanceof PdfTextError && error.status === 400,
  );
});
