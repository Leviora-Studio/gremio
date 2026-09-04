// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { renderProtocolPdf } from "../lib/protocol-pdf-renderer";

const options = { skip: !process.env.PROTOCOL_PDF_PYTHON && "Set PROTOCOL_PDF_PYTHON to test the installed PDF runtime" };
test("real renderer reads YAML metadata and preserves editable signature dates", options, async () => {
  const pdf = await renderProtocolPdf({ markdown: '---\ntitle: "YAML title"\nauthor: "Test author"\nsitzungsleitung: Anna\nprotokollfuehrung: Ben\n---\n# Sitzung\n\n## TOP 1\nText mit **Fettdruck**, Umlauten äöü und `Code`.\n', sourceName: "test.md", logo: null, images: {} });
  const document = await PDFDocument.load(pdf);
  assert.equal(document.getTitle(), "YAML title");
  assert.equal(document.getAuthor(), "Test author");
  assert.deepEqual(document.getForm().getFields().map(field => field.getName()).sort(), ["datum_protokollfuehrung", "datum_sitzungsleitung"]);
  assert.equal(document.getPageCount(), 1);
});

test("real renderer disables signatures from YAML and blocks server/network image reads", options, async () => {
  const input = { markdown: '---\nunterschriften: false\n---\n# Ohne Unterschriften\n', sourceName: "test.md", logo: null, images: {} };
  assert.equal((await PDFDocument.load(await renderProtocolPdf(input))).getForm().getFields().length, 0);
  for (const url of ["file:///etc/passwd", "http://127.0.0.1:3000/private", "https://example.invalid/tracker.png"]) await assert.rejects(renderProtocolPdf({ ...input, markdown: `# Test\n![image](${url})` }), /PDF-Erzeugung fehlgeschlagen/);
});
